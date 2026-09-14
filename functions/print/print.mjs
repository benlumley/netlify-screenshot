import qs from "qs"
import { launchBrowser, closeBrowser } from "../shared/chromium.mjs"
import { safeTimeout, requestHeaders, errorResponse } from "../shared/capture.mjs"
import { isAllowedCoverUrl, deriveFilename, mergeCover } from "./pdfCover.js"
import { scalePagesTo } from "./pdfScale.js"
// Static import on purpose: the bundler traces node_modules from these, not
// from `require()` calls inside the CJS helpers (see pdfScale.js).
import { PDFDocument } from "pdf-lib"
import { captureReadyCheck, frameFingerprint, hasNoSpinner } from "./captureReady.js"
import { httpCredentials } from "../shared/httpAuth.js"

// Runtime API v2 function — the modern shape is required for the memory/vCPU
// configuration below to take effect (v1 handler functions silently keep the
// 1024MB default).
export const config = {
    memory: "4gb",
}

// Merged PDFs above this size risk the synchronous Netlify response cap
// (~6MB); fall back to the coverless PDF rather than returning a 502.
// The 0.75 keeps the cap byte-equivalent to the v1 handler's 5.5MB base64
// limit (base64 inflates by 4/3) — deliberately unchanged in the v2 port.
const maxCoveredBytes = 5.5 * 1024 * 1024 * 0.75

// Abort the cover fetch if it stalls, so a slow asset host degrades to the
// coverless PDF instead of hanging the whole function into a Lambda timeout.
const coverFetchTimeout = 8000

const height = 1200

// 29pt on every side, per the design guide for the profile booklets (InDesign
// "29 px" = 29pt). Puppeteer has no pt unit, hence inches. Explicit A4 because
// Chrome's "A4" preset is 0.1% oversize.
const pageMarginPt = 29
const a4 = { widthMm: 210, heightMm: 297, widthPt: (210 / 25.4) * 72, heightPt: (297 / 25.4) * 72 }

// The measure/location/group profile PDFs render 1.25x larger than the
// Data-page export so their type and boxes match the printed report design:
// 1146px x 0.625 = 716px = A4 width minus the two 29pt margins, so the content
// still fills the page exactly. The Data page keeps its original 1440 x 0.5.
const isDetailPage = (path) => /(^|\/)(locations|measures)\//.test(path)
const renderSettings = (path) =>
    isDetailPage(path) ? { width: 1146, scale: 0.625 } : { width: 1440, scale: 0.5 }

// Chromium's printToPDF `scale` shrinks the layout but evaluates media queries
// against the unscaled paper width, so a scaled A4 print gets the site's mobile
// breakpoints. For the detail pages we instead print at scale 1 onto paper
// 1/scale times A4 (so layout and breakpoints agree at 1146px) and shrink the
// finished pages to A4 with pdf-lib (see pdfScale.js). The Data page keeps the
// plain scaled print it has always had.
const pdfOptions = (path, scale) => {
    if (isDetailPage(path)) {
        const margin = `${pageMarginPt / 72 / scale}in`
        return {
            width: `${a4.widthMm / scale}mm`,
            height: `${a4.heightMm / scale}mm`,
            scale: 1,
            margin: { top: margin, right: margin, bottom: margin, left: margin },
        }
    }
    const margin = `${pageMarginPt / 72}in`
    return {
        width: `${a4.widthMm}mm`,
        height: `${a4.heightMm}mm`,
        scale,
        margin: { top: margin, right: margin, bottom: margin, left: margin },
    }
}

const maxage = 60 * 60 * 24 * 7
const navigationTimeout = 18000
const selectorTimeout = 10000
const readyTimeout = 22000
const settleInterval = 500
const settleAttempts = 16
const readyReserve = 7000

const userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'

const waitForCaptureReady = async (page, selector, startedAt) => {
    await page.waitForSelector(selector, { timeout: safeTimeout(startedAt, selectorTimeout) })
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

export default async (req) => {
    const startedAt = Date.now()
    const logTime = (label) => console.log(`${label}: ${Date.now() - startedAt}ms`)
    let browser

    try {
    const requestUrl = new URL(req.url)
    const path = requestUrl.pathname.replace("/.netlify/functions", "").replace("/print", "").replace(".pdf", "")
    if (path.indexOf('favicon.ico') > -1) {
        return new Response(null, { status: 404 })
    }
    // `cover` is service-only (the PDF to prepend); never forward it to the app.
    const { cover: coverUrl, ...forwardedParams } = Object.fromEntries(requestUrl.searchParams)
    const queryStringParameters = {
        ...forwardedParams,
        takingss: 1,
        cookieAccept: 1,
        swn_dismiss: 1,
    }
    const filename = deriveFilename(path)
    const selector = queryStringParameters.view === 'table' ? '#mifDataTable' : '#screenshotPdfFrame'
    const url = `${process.env.BASE_URL}${path}${qs.stringify(queryStringParameters, { addQueryPrefix: true })}`
    console.log(url);

    browser = await launchBrowser()

    logTime('browser launched')
    const page = await browser.newPage();
    const credentials = httpCredentials()
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
    page.setDefaultNavigationTimeout(safeTimeout(startedAt, navigationTimeout, 8000))
    page.setDefaultTimeout(safeTimeout(startedAt, selectorTimeout))
    logTime('page ready')
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: safeTimeout(startedAt, navigationTimeout, 8000) })
    if (response && (response.status() === 401 || response.status() === 407)) {
        throw new Error(`Target returned ${response.status()} — check HTTP_AUTH_USER/HTTP_AUTH_PASS`)
    }
    logTime('dom loaded')
    console.log(selector);
    await waitForCaptureReady(page, selector, startedAt)
    logTime('capture ready')

    await page.emulateMediaType('screen');
    let pdf = await page.pdf({ printBackground: true, ...pdfOptions(path, scale) })
    logTime('pdf created')

    if (isDetailPage(path)) {
        pdf = await scalePagesTo(pdf, { scale, width: a4.widthPt, height: a4.heightPt, PDFDocument })
        logTime('pdf scaled to A4')
    }

  // Prepend the cover if one was requested. Any failure here degrades to the
  // coverless PDF (Principle 4) — it must never turn into a hard error, so the
  // fetch/merge and pdf-lib require are isolated in their own try/catch.
  let responseBody = pdf

  if (coverUrl) {
    try {
      if (!isAllowedCoverUrl(coverUrl)) {
        console.warn('cover rejected (not https/allowlisted):', coverUrl)
      } else {
        // `redirect: 'error'` keeps the SSRF allowlist honest — a 3xx from an
        // allowlisted host can't bounce the fetch to an unvalidated URL. The
        // abort timeout bounds a slow download so it degrades to coverless.
        const controller = new AbortController()
        const coverTimeout = setTimeout(() => controller.abort(), safeTimeout(startedAt, coverFetchTimeout))
        try {
          const coverResponse = await fetch(coverUrl, { redirect: 'error', signal: controller.signal })
          if (!coverResponse.ok) {
            throw new Error(`cover fetch failed: ${coverResponse.status}`)
          }
          const coverBuffer = Buffer.from(await coverResponse.arrayBuffer())
          const merged = await mergeCover(pdf, coverBuffer, { PDFDocument })

          if (merged.length > maxCoveredBytes) {
            console.warn('merged pdf exceeds response cap; returning coverless')
          } else {
            responseBody = merged
            logTime('cover merged')
          }
        } finally {
          clearTimeout(coverTimeout)
        }
      }
    } catch (error) {
      console.warn('cover merge failed; returning coverless:', error?.message || error)
    }
  }

  return new Response(responseBody, {
    status: 200,
    headers: {
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
