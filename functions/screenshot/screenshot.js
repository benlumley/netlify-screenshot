const qs = require("qs")
const { getBrowser, finishCapture } = require("../shared/browser")
const { captureReadyCheck } = require("../print/captureReady")
const { httpCredentials } = require("../shared/httpAuth")

const width = 1440
const height = 1200
const maxage = 60 * 60 * 24 * 7
const navigationTimeout = 18000
const selectorTimeout = 10000
const readyTimeout = 22000
const readyReserve = 7000
const closeTimeout = 1000
const lambdaReserve = 5000

const userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'

const timeout = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const remainingTime = (context) => (
    typeof context?.getRemainingTimeInMillis === 'function'
        ? context.getRemainingTimeInMillis()
        : 26000
)

const safeTimeout = (context, preferred, reserve = lambdaReserve) => (
    Math.max(1000, Math.min(preferred, remainingTime(context) - reserve))
)

// Close the page without letting a hung close eat into the Lambda budget.
const closePage = async (page) => {
    if (!page) {
        return
    }

    try {
        await Promise.race([page.close(), timeout(closeTimeout)])
    } catch (error) {
        console.error('Failed to close page', error)
    }
}

const requestHeaders = () => {
    const headers = {
        'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8',
    }

    if (process.env.BUILD_BYPASS_KEY) {
        headers['X-IDP-Build-Key'] = process.env.BUILD_BYPASS_KEY
    }

    return headers
}

const waitForCaptureReady = async (page, selector, context) => {
    await page.waitForSelector(selector, { timeout: safeTimeout(context, selectorTimeout) })
    // The detail pages index ten years of level-5 data before rendering,
    // which far outlasts 10s on Lambda CPU — give the readiness wait all
    // the remaining budget minus the reserve needed to capture the PNG.
    await page.waitForFunction(captureReadyCheck, { timeout: safeTimeout(context, readyTimeout, readyReserve) }, selector, false)

    await page.waitForTimeout(500)
}

const errorResponse = (error) => {
    const isTimeout = error?.name === 'TimeoutError'

    return {
        statusCode: isTimeout ? 504 : 500,
        headers: {
            "Cache-Control": "no-store",
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            error: isTimeout ? 'Screenshot timed out' : 'Screenshot failed',
            message: error?.message || String(error),
        }),
    }
}


exports.handler = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false

  const startedAt = Date.now()
  const logTime = (label) => console.log(`${label}: ${Date.now() - startedAt}ms`)
  console.log(`lambda budget: ${remainingTime(context)}ms`)
  let browser
  let page
  let failed = false

  try {
  const path = event.path.replace("/.netlify/functions", "").replace("/screenshot", "").replace(".png", "");
    if (path.indexOf('favicon.ico') > -1) {
        return {
            statusCode: 404
        }
    }
  const queryStringParameters = {
    ...(event.queryStringParameters || {}),
    takingss: 1,
    cookieAccept: 1,
    swn_dismiss: 1,
  }
  const selector = queryStringParameters.view === 'table' ? '#mifDataTable' : '#screenshotPdfFrame'
  const url = `${process.env.BASE_URL}${path}${qs.stringify(queryStringParameters, { addQueryPrefix: true })}`

  browser = await getBrowser()

  logTime('browser launched')
    page = await browser.newPage();
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
    page.setDefaultNavigationTimeout(safeTimeout(context, navigationTimeout, 8000))
    page.setDefaultTimeout(safeTimeout(context, selectorTimeout))
    logTime('page ready')
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: safeTimeout(context, navigationTimeout, 8000) })
    if (response && (response.status() === 401 || response.status() === 407)) {
        throw new Error(`Target returned ${response.status()} — check HTTP_AUTH_USER/HTTP_AUTH_PASS`)
    }
    logTime('dom loaded')
    await waitForCaptureReady(page, selector, context)
    logTime('capture ready')
  const frame = await page.$(selector);
  const screenshot = await frame.screenshot({
    type:'png',
    omitBackground: true
  })
    logTime('screenshot created')
//   const screenshot = await page.screenshot();

  return {
    statusCode: 200,
    headers: {
      "Cache-Control": `public, max-age=${maxage}`,
      "Content-Type": "image/png",
      "Content-Disposition": "attachment; filename=2024-iiag.png",
      "Expires": new Date(Date.now() + maxage * 1000).toUTCString(),
    },
    body: screenshot.toString("base64"),
    isBase64Encoded: true,
  }
  } catch (error) {
    failed = true
    console.error(error)
    return errorResponse(error)
  } finally {
    await closePage(page)
    await finishCapture(browser, { failed })
  }
}
