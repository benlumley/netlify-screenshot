const chromium = require("@sparticuz/chromium");
const puppeteer = require("puppeteer-core");
const qs = require("qs")

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

const logCaptureDiagnostics = async (page, selector, context) => {
    try {
        const diagnostics = await page.evaluate((captureSelector) => {
            const captureElement = document.querySelector(captureSelector)
            const bodyText = document.body?.innerText?.replace(/\s+/g, ' ').slice(0, 300)
            const contentContainer = captureElement?.querySelector('.uk-container.uk-margin-top.uk-margin-bottom')
            const loader = captureElement?.querySelector('img[src*="loader.gif"]')

            return {
                title: document.title,
                url: location.href,
                readyState: document.readyState,
                hasCaptureElement: Boolean(captureElement),
                hasContentContainer: Boolean(contentContainer),
                contentChildren: contentContainer?.children?.length || 0,
                hasLoader: Boolean(loader),
                bodyText,
            }
        }, selector)

        diagnostics.remainingTime = remainingTime(context)
        console.log('capture diagnostics', JSON.stringify(diagnostics))
    } catch (diagnosticError) {
        console.error('Failed to collect capture diagnostics', diagnosticError)
    }
}

const waitForCaptureReady = async (page, selector, context) => {
    try {
        await page.waitForSelector(selector, { timeout: safeTimeout(context, selectorTimeout) })
        await page.waitForFunction((captureSelector) => {
            const captureElement = document.querySelector(captureSelector)

            if (!captureElement) {
                return false
            }

            const loader = captureElement.querySelector('img[src*="loader.gif"]')

            if (loader) {
                return false
            }

            const contentContainer = captureElement.querySelector('.uk-container.uk-margin-top.uk-margin-bottom')
            const contentChildren = contentContainer
                ? Array.from(contentContainer.children).slice(1)
                : []
            const hasRenderedContent = contentChildren.some((element) => {
                const text = element.innerText?.trim() || ''
                const chart = element.querySelector('canvas, svg, table')

                return text.length > 20 || Boolean(chart)
            })

            return hasRenderedContent
        }, { timeout: safeTimeout(context, selectorTimeout) }, selector)

        await page.waitForTimeout(500)
    } catch (error) {
        await logCaptureDiagnostics(page, selector, context)
        throw error
    }
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
    swnDismiss: 1,
  }
  const selector = queryStringParameters.view === 'table' ? '#mifDataTable' : '#screenshotPdfFrame'
  const url = `${process.env.BASE_URL}${path}${qs.stringify(queryStringParameters, { addQueryPrefix: true })}`
  console.log(`BUILD_BYPASS_KEY configured: ${Boolean(process.env.BUILD_BYPASS_KEY)}`)

  browser = await puppeteer.launch({
    args: launchArgs(),
    defaultViewport: chromium.defaultViewport,
    executablePath: await executablePath(),
    headless: headlessMode(),
  })

  logTime('browser launched')
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 1 })
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
    console.error(error)
    return errorResponse(error)
  } finally {
    await closeBrowser(browser)
  }
}
