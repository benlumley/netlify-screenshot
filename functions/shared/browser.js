const chromium = require("@sparticuz/chromium")
const puppeteer = require("puppeteer-core")

// Shared browser lifecycle for the print and screenshot handlers.
//
// The browser is kept alive between warm Lambda invocations (both handlers set
// callbackWaitsForEmptyEventLoop = false) so Chrome's HTTP cache survives —
// the app bundle and the per-year API responses are identical for every
// capture, which cuts several seconds off each warm capture. The browser is
// recycled after maxCaptures successful uses to bound memory growth (Chrome's
// memory is out-of-process, so a count is the only practical limit), and
// discarded outright after any failed capture so a wedged instance can't
// poison later invocations.

const closeTimeout = 1000
// Each reused capture adds ~100MB of Chrome memory (observed 743 -> 855 ->
// 942MB) against the 1024MB Lambda, so recycle early — the cache win arrives
// by the second capture anyway.
const maxCaptures = 2

let browserPromise = null
let captureCount = 0

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

const timeout = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const executablePath = async () => process.env.PUPPETEER_EXECUTABLE_PATH || await chromium.executablePath()
const headlessMode = () => process.env.PUPPETEER_EXECUTABLE_PATH ? true : chromium.headless
const launchArgs = () => (
    process.env.PUPPETEER_EXECUTABLE_PATH
        ? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
        : [...chromium.args, ...extraChromiumArgs]
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

const launch = async () => puppeteer.launch({
    args: launchArgs(),
    defaultViewport: chromium.defaultViewport,
    executablePath: await executablePath(),
    headless: headlessMode(),
})

const getBrowser = async () => {
    if (browserPromise) {
        try {
            const browser = await browserPromise
            if (browser.isConnected()) {
                console.log(`browser reused (capture ${captureCount + 1})`)
                return browser
            }
            // The connection died but the process may live on — kill it
            // rather than orphaning it next to the replacement.
            await closeBrowser(browser)
        } catch (error) {
            console.warn('previous browser unusable; relaunching:', error?.message || error)
        }
        browserPromise = null
    }

    captureCount = 0
    browserPromise = launch()
    return browserPromise
}

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

const finishCapture = async (browser, { failed, page } = {}) => {
    // The invocation never took a browser (e.g. the favicon guard returned
    // early, which the catch-all redirect makes a real path) — the pool
    // wasn't used, so it must be left alone.
    if (!browser) {
        return
    }

    if (failed || captureCount + 1 >= maxCaptures) {
        if (!failed) {
            console.log(`browser recycled after ${captureCount + 1} captures`)
        }
        // The browser is going away — closing the page first is wasted budget.
        browserPromise = null
        captureCount = 0
        await closeBrowser(browser)
        return
    }

    captureCount += 1
    await closePage(page)
}

module.exports = { getBrowser, finishCapture }
