import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

import { captureSelector, signalsCaptureReady, waitForCaptureReady } from './captureWait.mjs'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const setDom = (html) => {
    const dom = new JSDOM(`<!DOCTYPE html><body>${html}</body>`)
    global.document = dom.window.document
    return dom.window.document
}

const define = (el, prop, value) => Object.defineProperty(el, prop, { value, configurable: true })

// Polls like puppeteer's waitFor* and rejects with a TimeoutError-named error.
const poll = async (check, timeout) => {
    const deadline = Date.now() + timeout
    for (;;) {
        const value = check()
        if (value) {
            return value
        }
        if (Date.now() >= deadline) {
            throw Object.assign(new Error(`Waiting failed: ${timeout}ms exceeded`), { name: 'TimeoutError' })
        }
        await sleep(20)
    }
}

// A stand-in for puppeteer's Page: the browser-side predicates run directly
// against the jsdom document.
const fakePage = (overrides = {}) => ({
    waitForSelector: (selector, { timeout }) => poll(() => document.querySelector(selector), timeout),
    waitForFunction: (fn, { timeout }, ...args) => poll(() => fn(...args), timeout),
    evaluate: async (fn, ...args) => fn(...args),
    evaluateHandle: async () => {},
    waitForTimeout: sleep,
    ...overrides,
})

// Records whether the handler's fallback ran, and for which selector.
const heuristicSpy = () => {
    const spy = async (page, selector) => {
        spy.calls.push(selector)
    }
    spy.calls = []
    return spy
}

// With this much of the Lambda budget already used, the grace period is cut to
// 1.5s (it ends 1s before the heuristic's deadline) — keeps fallback tests fast.
const lateStart = () => Date.now() - 16500

const frame = (attrs = '', content = '<canvas></canvas>') => `<main id="screenshotPdfFrame" ${attrs}>${content}</main>`

test('captures the export frame', () => {
    assert.equal(captureSelector, '#screenshotPdfFrame')
})

test('signalsCaptureReady: detail pages and the Data page signal', () => {
    for (const path of ['/locations/ao.html', '/fr/locations/ao.html', '/measures/governance.html', '/data.html', '/pt/data.html']) {
        assert.equal(signalsCaptureReady(path), true, path)
    }
})

test('signalsCaptureReady: other pages never signal', () => {
    for (const path of ['/', '/index.html', '/embed.html', '/database.html', '/metadata.html', '/locations.html']) {
        assert.equal(signalsCaptureReady(path), false, path)
    }
})

test('signal raised: returns "signal" without running the heuristic', async () => {
    setDom(frame('data-capture-ready="true"'))
    const heuristic = heuristicSpy()
    const via = await waitForCaptureReady(fakePage(), {
        signals: true, requireImages: true, startedAt: Date.now(), waitForHeuristic: heuristic,
    })
    assert.equal(via, 'signal')
    assert.deepEqual(heuristic.calls, [])
})

test('no signal within the grace period: falls back to the heuristic on the frame', async () => {
    setDom(frame())
    const heuristic = heuristicSpy()
    const began = Date.now()
    const via = await waitForCaptureReady(fakePage(), {
        signals: true, requireImages: true, startedAt: lateStart(), waitForHeuristic: heuristic,
    })
    assert.equal(via, 'heuristic')
    assert.deepEqual(heuristic.calls, [captureSelector])
    assert.ok(Date.now() - began >= 1400, 'waited out the grace period first')
})

test('pages that never signal go straight to the heuristic', async () => {
    setDom(frame())
    const heuristic = heuristicSpy()
    const began = Date.now()
    const via = await waitForCaptureReady(fakePage(), {
        signals: false, requireImages: true, startedAt: Date.now(), waitForHeuristic: heuristic,
    })
    assert.equal(via, 'heuristic')
    assert.deepEqual(heuristic.calls, [captureSelector])
    assert.ok(Date.now() - began < 300, 'no grace period')
})

test('signal cleared during the settle: waits for it to be raised again', async () => {
    const doc = setDom(frame('data-capture-ready="true"'))
    const el = doc.querySelector(captureSelector)
    setTimeout(() => el.removeAttribute('data-capture-ready'), 100)
    setTimeout(() => {
        el.appendChild(doc.createElement('table'))
        el.setAttribute('data-capture-ready', 'true')
    }, 1200)
    const began = Date.now()
    const via = await waitForCaptureReady(fakePage(), {
        signals: true, requireImages: false, startedAt: Date.now(), waitForHeuristic: heuristicSpy(),
    })
    assert.equal(via, 'signal')
    assert.ok(Date.now() - began >= 1200, 'did not capture while the app was loading')
})

test('signal raised but an image still loading: print waits for it, the PNG path does not', async () => {
    const doc = setDom(frame('data-capture-ready="true"', '<img src="/flag.png">'))
    const img = doc.querySelector('img')
    setTimeout(() => {
        define(img, 'complete', true)
        define(img, 'naturalWidth', 24)
    }, 1300)

    let began = Date.now()
    await waitForCaptureReady(fakePage(), {
        signals: true, requireImages: false, startedAt: Date.now(), waitForHeuristic: heuristicSpy(),
    })
    assert.ok(Date.now() - began < 1000, 'PNG path does not gate on images')

    began = Date.now()
    const via = await waitForCaptureReady(fakePage(), {
        signals: true, requireImages: true, startedAt: Date.now(), waitForHeuristic: heuristicSpy(),
    })
    assert.equal(via, 'signal')
    assert.equal(img.naturalWidth, 24, 'printed only after the image loaded')
})

test('errors other than a timeout during the signal wait propagate', async () => {
    setDom(frame())
    const page = fakePage({
        waitForFunction: async () => {
            throw new Error('Execution context was destroyed')
        },
    })
    await assert.rejects(
        waitForCaptureReady(page, {
            signals: true, requireImages: true, startedAt: Date.now(), waitForHeuristic: heuristicSpy(),
        }),
        /Execution context was destroyed/,
    )
})
