import qs from "qs"
import { launchBrowser, closeBrowser } from "../shared/chromium.mjs"
import { safeTimeout, requestHeaders, errorResponse } from "../shared/capture.mjs"
import { captureReadyCheck } from "../print/captureReady.js"
import { httpCredentials } from "../shared/httpAuth.js"

// Runtime API v2 function — the modern shape is required for the memory/vCPU
// configuration below to take effect (v1 handler functions silently keep the
// 1024MB default).
export const config = {
    memory: "4gb",
}

const width = 1440
const height = 1200
const maxage = 60 * 60 * 24 * 7
const navigationTimeout = 18000
const selectorTimeout = 10000
const readyTimeout = 22000
const readyReserve = 7000

const userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'

const waitForCaptureReady = async (page, selector, startedAt) => {
    await page.waitForSelector(selector, { timeout: safeTimeout(startedAt, selectorTimeout) })
    // The detail pages index ten years of level-5 data before rendering,
    // which far outlasts 10s on Lambda CPU — give the readiness wait all
    // the remaining budget minus the reserve needed to capture the PNG.
    await page.waitForFunction(captureReadyCheck, { timeout: safeTimeout(startedAt, readyTimeout, readyReserve) }, selector, false)

    await page.waitForTimeout(500)
}

export default async (req) => {
    const startedAt = Date.now()
    const logTime = (label) => console.log(`${label}: ${Date.now() - startedAt}ms`)
    let browser

    try {
    const requestUrl = new URL(req.url)
    const path = requestUrl.pathname.replace("/.netlify/functions", "").replace("/screenshot", "").replace(".png", "")
    if (path.indexOf('favicon.ico') > -1) {
        return new Response(null, { status: 404 })
    }
    const queryStringParameters = {
        ...Object.fromEntries(requestUrl.searchParams),
        takingss: 1,
        cookieAccept: 1,
        swn_dismiss: 1,
    }
    const selector = queryStringParameters.view === 'table' ? '#mifDataTable' : '#screenshotPdfFrame'
    const url = `${process.env.BASE_URL}${path}${qs.stringify(queryStringParameters, { addQueryPrefix: true })}`

    browser = await launchBrowser()

    logTime('browser launched')
    const page = await browser.newPage();
    const credentials = httpCredentials()
    if (credentials) {
        await page.authenticate(credentials)
    }
    await page.setViewport({ width, height, deviceScaleFactor: 1 })
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
    await waitForCaptureReady(page, selector, startedAt)
    logTime('capture ready')
    const frame = await page.$(selector);
    const screenshot = await frame.screenshot({
        type: 'png',
        omitBackground: true,
    })
    logTime('screenshot created')

    return new Response(screenshot, {
        status: 200,
        headers: {
            "Cache-Control": `public, max-age=${maxage}`,
            "Content-Type": "image/png",
            "Content-Disposition": "attachment; filename=2024-iiag.png",
            "Expires": new Date(Date.now() + maxage * 1000).toUTCString(),
        },
    })
    } catch (error) {
        console.error(error)
        return errorResponse(error)
    } finally {
        await closeBrowser(browser)
    }
}
