import qs from "qs"
import { launchBrowser, closeBrowser } from "../shared/chromium.mjs"
import { safeTimeout, requestHeaders, errorResponse, corsHeaders, preflightResponse } from "../shared/capture.mjs"
import { assembleBooklet, bookletPageUrls, deriveFilename } from "./pdfBooklet.js"
import { scalePagesTo } from "./pdfScale.js"
import { a4, isDetailPage, pdfOptions, renderSettings } from "./pdfLayout.js"
// Static import on purpose: the bundler traces node_modules from these, not
// from `require()` calls inside the CJS helpers (see pdfScale.js).
import { PDFDocument } from "pdf-lib"
import { captureReadyCheck, captureSignalCheck, frameFingerprint, hasNoSpinner } from "./captureReady.js"
import {
    readyReserve,
    readyTimeout,
    selectorTimeout,
    settleAttempts,
    settleInterval,
    signalsCaptureReady,
    waitForCaptureReady,
} from "../shared/captureWait.mjs"
import { httpCredentials } from "../shared/httpAuth.js"

// Runtime API v2 function — the modern shape is required for the memory/vCPU
// configuration below to take effect (v1 handler functions silently keep the
// 1024MB default).
export const config = {
    memory: "4gb",
}

// Booklets above this size risk the synchronous Netlify response cap
// (~6MB); fall back to the content-only PDF rather than returning a 502.
// The 0.75 keeps the cap byte-equivalent to the v1 handler's 5.5MB base64
// limit (base64 inflates by 4/3) — deliberately unchanged in the v2 port.
const maxCoveredBytes = 5.5 * 1024 * 1024 * 0.75

// Each wait while rendering the booklet's cover/back pages is bounded by this
// (and by the remaining Lambda budget), so a slow or broken page degrades to
// the content-only PDF instead of hanging the function into a Lambda timeout.
const bookletPageTimeout = 8000

// The profile name printed on the cover; longer values are cut to this.
const maxTitleLength = 200

// The app authors the cover and back pages at A4 with their own padding, so
// they print edge to edge at scale 1 — no pdfScale pass (they have no
// breakpoints to protect).
const bookletPdfOptions = {
    width: `${a4.widthMm}mm`,
    height: `${a4.heightMm}mm`,
    margin: { top: '0', right: '0', bottom: '0', left: '0' },
    scale: 1,
    printBackground: true,
}

const height = 1200

const maxage = 60 * 60 * 24 * 7
const navigationTimeout = 18000

const userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'

// The fallback for front-end builds that don't raise the capture-ready signal
// (see waitForCaptureReady in shared/captureWait.mjs).
const waitForHeuristicReady = async (page, selector, startedAt) => {
    // The detail pages index ten years of level-5 data before rendering,
    // which far outlasts 10s on Lambda CPU — give the readiness wait all
    // the remaining budget minus the reserve needed to produce the PDF.
    await page.waitForFunction(captureReadyCheck, { timeout: safeTimeout(startedAt, readyTimeout, readyReserve) }, selector, true)

    await page.evaluateHandle('document.fonts.ready')

    // Then wait for the frame to STOP changing. The detail pages load in phases
    // (first charts draw, then a later state update drops everything back to
    // spinners and rebuilds it), so a fixed delay printed the intermediate state
    // on slower runs. Two identical fingerprints 500ms apart with no spinner,
    // and the readiness predicate still true, means the page has settled.
    // Bounded by the remaining Lambda budget; falls through to print if it
    // never settles rather than failing the request.
    let previous = await page.evaluate(frameFingerprint, selector)
    for (let attempt = 0; attempt < settleAttempts; attempt += 1) {
        if (safeTimeout(startedAt, settleInterval, readyReserve) <= 1000) {
            break
        }
        await page.waitForTimeout(settleInterval)
        const current = await page.evaluate(frameFingerprint, selector)
        const ready = await page.evaluate(captureReadyCheck, selector, true)
        if (current === previous && hasNoSpinner(current) && ready) {
            break
        }
        previous = current
    }
}

// Resolves to `promise`'s value, or to `fallback` once `ms` has passed — so steps
// without their own timeout (opening/closing a tab) can't hold the response.
const withinBudget = (promise, ms, fallback) => {
    let timer
    return Promise.race([
        promise,
        new Promise((resolve) => { timer = setTimeout(() => resolve(fallback), ms) }),
    ]).finally(() => clearTimeout(timer))
}

// Prints one of the app's booklet pages (cover or back) in its own tab of the
// shared browser. Resolves to null on any failure — the caller then returns the
// content-only PDF — so it never rejects into the main flow.
const renderBookletPage = async (browser, url, { credentials, startedAt }) => {
    let page
    try {
        page = await browser.newPage()
        if (credentials) {
            await page.authenticate(credentials)
        }
        await page.setUserAgent(userAgent)
        await page.setExtraHTTPHeaders(requestHeaders())
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: safeTimeout(startedAt, bookletPageTimeout) })
        if (!response?.ok()) {
            throw new Error(`returned ${response ? response.status() : 'no response'}`)
        }
        // Same contract as the detail pages' signal: only data-capture-ready="true"
        // on <html> means ready, not the attribute's mere presence.
        await page.waitForFunction(captureSignalCheck, { timeout: safeTimeout(startedAt, bookletPageTimeout) }, 'html')

        return await page.pdf({ ...bookletPdfOptions, timeout: safeTimeout(startedAt, bookletPageTimeout) })
    } catch (error) {
        console.warn(`booklet page failed (${url}):`, error?.message || error)
        return null
    } finally {
        await page?.close().catch(() => {})
    }
}

export default async (req) => {
    const preflight = preflightResponse(req)
    if (preflight) {
        return preflight
    }

    const startedAt = Date.now()
    const logTime = (label) => console.log(`${label}: ${Date.now() - startedAt}ms`)
    let browser

    try {
    const requestUrl = new URL(req.url)
    const path = requestUrl.pathname.replace("/.netlify/functions", "").replace("/print", "").replace(".pdf", "")
    if (path.indexOf('favicon.ico') > -1) {
        return new Response(null, { status: 404 })
    }
    // `title` is service-only (the name for the booklet cover); never forward it to
    // the app. Nor the retired `cover` param, from callers not yet updated.
    const { title: rawTitle = '', cover: _retiredCover, ...forwardedParams } = Object.fromEntries(requestUrl.searchParams)
    const title = Array.from(rawTitle).slice(0, maxTitleLength).join('')
    const queryStringParameters = {
        ...forwardedParams,
        takingss: 1,
        cookieAccept: 1,
        swn_dismiss: 1,
    }
    const filename = deriveFilename(path)
    const url = `${process.env.BASE_URL}${path}${qs.stringify(queryStringParameters, { addQueryPrefix: true })}`
    console.log(url);

    browser = await launchBrowser()

    logTime('browser launched')
    const credentials = httpCredentials()

    // The detail pages print as booklets. Their cover and back render in tabs of
    // their own alongside the profile page, so they cost no extra wall time
    // against the Lambda budget.
    let bookletPages = null
    if (isDetailPage(path)) {
        const { cover, back } = bookletPageUrls({ baseUrl: process.env.BASE_URL, path, title })
        bookletPages = Promise.all([
            renderBookletPage(browser, cover, { credentials, startedAt }),
            renderBookletPage(browser, back, { credentials, startedAt }),
        ])
    }

    const page = await browser.newPage();
    if (credentials) {
        await page.authenticate(credentials)
    }
    const { width, scale } = renderSettings(path)
    await page.setViewport({ width, height, deviceScaleFactor: 2 })
    await page.setUserAgent(userAgent)
    await page.setExtraHTTPHeaders(requestHeaders())
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    })

    // TEMPORARY (font-debug branch): record when the first chart canvas appears
    // and whether the Arabic face was usable at that exact moment.
    await page.evaluateOnNewDocument(() => {
        window.__fontProbe = { canvasAt: null, arabicUsableAtCanvas: null, facesAtCanvas: null, arabicFirstUsableAt: null }
        const arabic = 'الأمن وسيادة القانون'
        const poll = setInterval(() => {
            if (window.__fontProbe.arabicFirstUsableAt === null && document.fonts.check('500 16px noto-sans-arabic', arabic)) {
                window.__fontProbe.arabicFirstUsableAt = Math.round(performance.now())
            }
        }, 25)
        const start = () => {
            const observer = new MutationObserver(() => {
                if (window.__fontProbe.canvasAt === null && document.querySelector('canvas')) {
                    window.__fontProbe.canvasAt = Math.round(performance.now())
                    window.__fontProbe.arabicUsableAtCanvas = document.fonts.check('500 16px noto-sans-arabic', arabic)
                    window.__fontProbe.facesAtCanvas = Array.from(document.fonts).filter((f) => f.family.includes('noto')).map((f) => `${f.weight}/${f.status}`)
                    clearInterval(poll)
                }
            })
            observer.observe(document.body, { childList: true, subtree: true })
        }
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', start)
        } else {
            start()
        }
    })
    page.setDefaultNavigationTimeout(safeTimeout(startedAt, navigationTimeout, 8000))
    page.setDefaultTimeout(safeTimeout(startedAt, selectorTimeout))
    logTime('page ready')
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: safeTimeout(startedAt, navigationTimeout, 8000) })
    if (response && (response.status() === 401 || response.status() === 407)) {
        throw new Error(`Target returned ${response.status()} — check HTTP_AUTH_USER/HTTP_AUTH_PASS`)
    }
    logTime('dom loaded')
    const readyVia = await waitForCaptureReady(page, {
        signals: signalsCaptureReady(path),
        requireImages: true,
        startedAt,
        waitForHeuristic: waitForHeuristicReady,
    })
    logTime(`capture ready (${readyVia})`)

    // TEMPORARY (font-debug branch, do not merge): report what the printing
    // browser can actually see, so the Arabic chart-label failure can be
    // diagnosed in the environment where it happens.
    if (requestUrl.searchParams.get('fontdebug') === '1') {
        const debug = await page.evaluate(() => {
            const ctx = document.createElement('canvas').getContext('2d')
            const width = (font, text) => { ctx.font = font; return Math.round(ctx.measureText(text).width * 100) / 100 }
            const arabic = 'الأمن وسيادة القانون'
            return {
                dir: document.documentElement.getAttribute('dir'),
                baseFontVar: getComputedStyle(document.body).getPropertyValue('--base-font'),
                faces: Array.from(document.fonts).map((f) => `${f.family}/${f.weight}/${f.status}`),
                checkArabic: document.fonts.check('500 16px noto-sans-arabic', arabic),
                checkStack: document.fonts.check('500 16px museo-sans, noto-sans-arabic, sans-serif', arabic),
                widthArabicOnly: width('500 16px noto-sans-arabic', arabic),
                widthSiteStack: width('500 16px museo-sans, noto-sans-arabic, sans-serif', arabic),
                widthMuseoOnly: width('500 16px museo-sans', arabic),
                widthSystemSans: width('500 16px sans-serif', arabic),
                widthLatin: width('500 16px museo-sans, noto-sans-arabic, sans-serif', 'Governance'),
                preloads: Array.from(document.querySelectorAll('link[rel="preload"]')).map((l) => l.getAttribute('href')),
                probe: window.__fontProbe,
                canvases: Array.from(document.querySelectorAll('canvas')).map((c) => ({
                    w: c.width, h: c.height, cssW: Math.round(c.getBoundingClientRect().width), cssH: Math.round(c.getBoundingClientRect().height),
                })),
                // The sub-category radar, as the printing browser has drawn it.
                radar: (() => {
                    const c = document.querySelectorAll('canvas')[2]
                    try { return c ? c.toDataURL('image/png') : null } catch (e) { return `error: ${e.message}` }
                })(),
            }
        })
        return new Response(JSON.stringify(debug, null, 1), {
            status: 200,
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        })
    }

    await page.emulateMediaType('screen');
    const printed = await page.pdf({ printBackground: true, ...pdfOptions(scale) })
    logTime('pdf created')

    const pdf = await scalePagesTo(printed, { scale, width: a4.widthPt, height: a4.heightPt, PDFDocument })
    logTime('pdf scaled to A4')

  // Wrap the detail pages in their booklet. Any failure here degrades to the
  // content-only PDF — it must never turn into a hard error.
  let responseBody = pdf

  if (bookletPages) {
    try {
      const [cover, back] = await withinBudget(bookletPages, safeTimeout(startedAt, bookletPageTimeout, 2000), [null, null])
      if (!cover || !back) {
        console.warn('booklet cover/back unavailable; returning content only')
      } else {
        const booklet = await assembleBooklet(pdf, { cover, back, PDFDocument })

        if (booklet.length > maxCoveredBytes) {
          console.warn('booklet pdf exceeds response cap; returning content only')
        } else {
          responseBody = booklet
          logTime('booklet assembled')
        }
      }
    } catch (error) {
      console.warn('booklet assembly failed; returning content only:', error?.message || error)
    }
  }

  return new Response(responseBody, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename=${filename}`,
      "Cache-Control": `public, max-age=${maxage}`,
    },
  })
    } catch (error) {
        console.error(error)
        return errorResponse(error)
    } finally {
        await closeBrowser(browser)
    }
}
