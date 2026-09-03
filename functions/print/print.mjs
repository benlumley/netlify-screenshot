import qs from "qs"
import chromium from "@sparticuz/chromium-min"
import puppeteer from "puppeteer-core"
import { isAllowedCoverUrl, deriveFilename, mergeCover } from "./pdfCover.js"
import { captureReadyCheck } from "./captureReady.js"
import { httpCredentials } from "../shared/httpAuth.js"

// Runtime API v2 function — the modern shape is required for the memory/vCPU
// configuration below to take effect (v1 handler functions silently keep the
// 1024MB default).
export const config = {
    memory: "4gb",
}

// chromium-min ships no binary (the v2 bundler can't carry @sparticuz/chromium's
// pack); the matching pack is downloaded on cold start and cached in /tmp.
const chromiumPackUrl = process.env.CHROMIUM_PACK_URL
    || 'https://github.com/Sparticuz/chromium/releases/download/v123.0.1/chromium-v123.0.1-pack.tar'

const closeTimeout = 1000

const launchBrowser = async () => puppeteer.launch({
    args: process.env.PUPPETEER_EXECUTABLE_PATH
        ? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
        : chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || await chromium.executablePath(chromiumPackUrl),
    headless: process.env.PUPPETEER_EXECUTABLE_PATH ? true : chromium.headless,
})

const timeout = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const closeBrowser = async (browser) => {
    if (!browser) {
        return
    }

    let closed = false

    try {
        await Promise.race([
            browser.close().then(() => {
                closed = true
            }),
            timeout(closeTimeout),
        ])
    } catch (error) {
        console.error('Failed to close browser', error)
    }

    if (closed) {
        return
    }

    try {
        browser.disconnect()
    } catch (error) {
        console.error('Failed to disconnect browser', error)
    }

    try {
        browser.process()?.kill('SIGKILL')
    } catch (error) {
        console.error('Failed to kill browser process', error)
    }
}

// Merged PDFs above this size risk the synchronous Netlify response cap
// (~6MB); fall back to the coverless PDF rather than returning a 502.
const maxCoveredBytes = 5.5 * 1024 * 1024 * 0.75

// Abort the cover fetch if it stalls, so a slow asset host degrades to the
// coverless PDF instead of hanging the whole function into a Lambda timeout.
const coverFetchTimeout = 8000

const width = 1440
const height = 1200

const maxage = 60 * 60 * 24 * 7
const navigationTimeout = 18000
const selectorTimeout = 10000
const readyTimeout = 22000
const readyReserve = 7000
const lambdaReserve = 5000

// The v2 runtime has no getRemainingTimeInMillis; track the budget from the
// observed 26s synchronous limit instead.
const lambdaBudget = 26000

const userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'

const safeTimeout = (startedAt, preferred, reserve = lambdaReserve) => (
    Math.max(1000, Math.min(preferred, lambdaBudget - (Date.now() - startedAt) - reserve))
)

const requestHeaders = () => {
    const headers = {
        'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8',
    }

    if (process.env.BUILD_BYPASS_KEY) {
        headers['X-IDP-Build-Key'] = process.env.BUILD_BYPASS_KEY
    }

    return headers
}

const waitForCaptureReady = async (page, selector, startedAt) => {
    await page.waitForSelector(selector, { timeout: safeTimeout(startedAt, selectorTimeout) })
    // The detail pages index ten years of level-5 data before rendering,
    // which far outlasts 10s on Lambda CPU — give the readiness wait all
    // the remaining budget minus the reserve needed to produce the PDF.
    await page.waitForFunction(captureReadyCheck, { timeout: safeTimeout(startedAt, readyTimeout, readyReserve) }, selector, true)

    await page.evaluateHandle('document.fonts.ready')
    await page.waitForTimeout(500)
}

const errorResponse = (error) => {
    const isTimeout = error?.name === 'TimeoutError'

    return new Response(
        JSON.stringify({
            error: isTimeout ? 'Screenshot timed out' : 'Screenshot failed',
            message: error?.message || String(error),
        }),
        {
            status: isTimeout ? 504 : 500,
            headers: {
                "Cache-Control": "no-store",
                "Content-Type": "application/json",
            },
        },
    )
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
    const pdf = await page.pdf({
    format: "A4",
    printBackground: true,
    scale: 0.5,
    margin: {
      top: 20,
      right: 40,
      bottom: 20,
      left: 40,
    },
  })

  logTime('pdf created')

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
          const merged = await mergeCover(pdf, coverBuffer)

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
