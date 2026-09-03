import chromium from "@sparticuz/chromium-min"
import puppeteer from "puppeteer-core"

// Browser launch/teardown for the runtime-API-v2 functions. chromium-min
// ships no binary (the v2 bundler can't carry @sparticuz/chromium's pack);
// the matching pack is downloaded on cold start and cached in /tmp.
const chromiumPackUrl = process.env.CHROMIUM_PACK_URL
    || 'https://github.com/Sparticuz/chromium/releases/download/v123.0.1/chromium-v123.0.1-pack.tar'

const closeTimeout = 1000

const timeout = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export const launchBrowser = async () => puppeteer.launch({
    args: process.env.PUPPETEER_EXECUTABLE_PATH
        ? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
        : chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || await chromium.executablePath(chromiumPackUrl),
    headless: process.env.PUPPETEER_EXECUTABLE_PATH ? true : chromium.headless,
})

export const closeBrowser = async (browser) => {
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
