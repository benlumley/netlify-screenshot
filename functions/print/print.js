const chromium = require("@sparticuz/chromium");
const puppeteer = require("puppeteer-core");
const qs = require("qs")
const { isAllowedCoverUrl, deriveFilename, mergeCover } = require("./pdfCover")
const { captureReadyCheck } = require("./captureReady")

// Merged PDFs above this base64 size risk the synchronous Netlify response cap
// (~6MB); fall back to the coverless PDF rather than returning a 502.
const maxCoveredBase64 = 5.5 * 1024 * 1024

const width = 1440
const height = 1200

const maxage = 60 * 60 * 24 * 7
const navigationTimeout = 18000
const selectorTimeout = 10000
const closeTimeout = 1000
const lambdaReserve = 5000

const extraChromiumArgs = [
    '--autoplay-policy=user-gesture-required',
    '--disable-background-networking',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-breakpad',
    '--disable-client-side-phishing-detection',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-dev-shm-usage',
    '--disable-domain-reliability',
    '--disable-extensions',
    '--disable-features=AudioServiceOutOfProcess',
    '--disable-hang-monitor',
    '--disable-ipc-flooding-protection',
    '--disable-notifications',
    '--disable-offer-store-unmasked-wallet-cards',
    '--disable-popup-blocking',
    '--disable-print-preview',
    '--disable-prompt-on-repost',
    '--disable-renderer-backgrounding',
    '--disable-setuid-sandbox',
    '--disable-speech-api',
    '--disable-sync',
    '--disable-blink-features=AutomationControlled',
    '--hide-scrollbars',
    '--ignore-gpu-blacklist',
    '--disable-gpu',
    '--metrics-recording-only',
    '--mute-audio',
    '--no-default-browser-check',
    '--no-first-run',
    '--no-pings',
    '--no-sandbox',
    '--no-zygote',
    '--password-store=basic',
    '--use-gl=swiftshader',
    '--use-mock-keychain',
]
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

const executablePath = async () => process.env.PUPPETEER_EXECUTABLE_PATH || await chromium.executablePath()
const headlessMode = () => process.env.PUPPETEER_EXECUTABLE_PATH ? true : chromium.headless
const launchArgs = () => (
    process.env.PUPPETEER_EXECUTABLE_PATH
        ? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
        : [...chromium.args, ...extraChromiumArgs]
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

const waitForCaptureReady = async (page, selector, context) => {
    await page.waitForSelector(selector, { timeout: safeTimeout(context, selectorTimeout) })
    await page.waitForFunction(captureReadyCheck, { timeout: safeTimeout(context, selectorTimeout) }, selector, true)

    await page.evaluateHandle('document.fonts.ready')
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
    let browser

    try {
    const path = event.path.replace("/.netlify/functions", "").replace("/print", "").replace(".pdf", "")
    if (path.indexOf('favicon.ico') > -1) {
        return {
            statusCode: 404
        }
    }
    // `cover` is service-only (the PDF to prepend); never forward it to the app.
    const { cover: coverUrl, ...forwardedParams } = event.queryStringParameters || {}
    const queryStringParameters = {
        ...forwardedParams,
        takingss: 1,
        cookieAccept: 1,
        swn_dismiss: 1,
    }
    const filename = deriveFilename(path)
    const selector = queryStringParameters.view === 'table' ? '#mifDataTable' : '#screenshotPdfFrame'
    const url = `${process.env.BASE_URL}${path}${qs.stringify(queryStringParameters, { addQueryPrefix: true })}`
    // const url = `https://idp-test.mif.services${path}${qs.stringify(event.queryStringParameters, { addQueryPrefix: true })}`
    console.log(url);

    browser = await puppeteer.launch({
        args: launchArgs(),
        defaultViewport: chromium.defaultViewport,
        executablePath: await executablePath(),
        // executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        headless: headlessMode(),
    })

    logTime('browser launched')
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 2 })
    await page.setUserAgent(userAgent)
    await page.setExtraHTTPHeaders(requestHeaders())
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    })
    page.setDefaultNavigationTimeout(safeTimeout(context, navigationTimeout, 8000))
    page.setDefaultTimeout(safeTimeout(context, selectorTimeout))
    logTime('page ready')
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: safeTimeout(context, navigationTimeout, 8000) })
    logTime('dom loaded')
    console.log(selector);
    await waitForCaptureReady(page, selector, context)
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
  let responseBase64 = pdf.toString("base64")

  if (coverUrl) {
    try {
      if (!isAllowedCoverUrl(coverUrl)) {
        console.warn('cover rejected (not https/allowlisted):', coverUrl)
      } else {
        const coverResponse = await fetch(coverUrl)
        if (!coverResponse.ok) {
          throw new Error(`cover fetch failed: ${coverResponse.status}`)
        }
        const coverBuffer = Buffer.from(await coverResponse.arrayBuffer())
        const mergedBase64 = (await mergeCover(pdf, coverBuffer)).toString("base64")

        if (mergedBase64.length > maxCoveredBase64) {
          console.warn('merged pdf exceeds response cap; returning coverless')
        } else {
          responseBase64 = mergedBase64
          logTime('cover merged')
        }
      }
    } catch (error) {
      console.warn('cover merge failed; returning coverless:', error?.message || error)
    }
  }

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename=${filename}`,
        "Cache-Control": `public, max-age=${maxage}`,
    },
    body: responseBase64,
    isBase64Encoded: true,
  }
    } catch (error) {
        console.error(error)
        return errorResponse(error)
    } finally {
        await closeBrowser(browser)
    }
}
