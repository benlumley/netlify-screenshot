const chromium = require("@sparticuz/chromium")
const puppeteer = require("puppeteer-core")

// Shared browser plumbing for the print and screenshot handlers, which
// previously carried byte-identical copies of the launch configuration and
// teardown logic. Each invocation launches a fresh browser and closes it in
// the handler's finally.

const closeTimeout = 1000

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

const launchBrowser = async () => puppeteer.launch({
    args: launchArgs(),
    defaultViewport: chromium.defaultViewport,
    executablePath: await executablePath(),
    headless: headlessMode(),
})

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

module.exports = { launchBrowser, closeBrowser }
