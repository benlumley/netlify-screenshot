const test = require('node:test')
const assert = require('node:assert/strict')

// The lifecycle module hard-requires puppeteer-core, so plant a fake in the
// require cache before loading it. PUPPETEER_EXECUTABLE_PATH short-circuits
// the @sparticuz/chromium executable download.
process.env.PUPPETEER_EXECUTABLE_PATH = '/fake/chrome'

const launched = []

const makeFakeBrowser = () => {
    const browser = {
        alive: true,
        isConnected: () => browser.alive,
        close: async () => {
            browser.alive = false
        },
        disconnect: () => {},
        process: () => null,
    }
    launched.push(browser)
    return browser
}

const puppeteerPath = require.resolve('puppeteer-core')
require.cache[puppeteerPath] = {
    id: puppeteerPath,
    filename: puppeteerPath,
    loaded: true,
    exports: { launch: async () => makeFakeBrowser() },
}

const { getBrowser, finishCapture } = require('./browser')

const fakePage = () => ({ closed: false, close: async function () { this.closed = true } })

test('browser lifecycle', async (t) => {
    await t.test('reuses the same instance across successful captures', async () => {
        const first = await getBrowser()
        const page = fakePage()
        await finishCapture(first, { page })
        assert.equal(page.closed, true)

        const second = await getBrowser()
        assert.equal(second, first)
        assert.equal(launched.length, 1)
    })

    await t.test('recycles after maxCaptures and skips the page close', async () => {
        const browser = await getBrowser()
        const page = fakePage()
        await finishCapture(browser, { page })

        assert.equal(browser.alive, false)
        assert.equal(page.closed, false)

        const fresh = await getBrowser()
        assert.notEqual(fresh, browser)
    })

    await t.test('discards the browser after a failed capture', async () => {
        const browser = await getBrowser()
        await finishCapture(browser, { failed: true, page: fakePage() })

        assert.equal(browser.alive, false)

        const fresh = await getBrowser()
        assert.notEqual(fresh, browser)
        assert.equal(fresh.alive, true)
    })

    await t.test('leaves the pool alone when no browser was taken', async () => {
        const pooled = await getBrowser()
        await finishCapture(pooled, {})

        // e.g. the favicon guard returns before getBrowser() — the pooled
        // browser must survive untouched and keep its capture count.
        await finishCapture(undefined, {})
        await finishCapture(undefined, { failed: true })

        assert.equal(pooled.alive, true)
        const reused = await getBrowser()
        assert.equal(reused, pooled)
    })

    await t.test('replaces a disconnected browser and closes its process', async () => {
        const browser = await getBrowser()
        browser.alive = false

        const fresh = await getBrowser()
        assert.notEqual(fresh, browser)
        assert.equal(fresh.alive, true)
    })
})
