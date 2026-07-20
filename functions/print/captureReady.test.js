const test = require('node:test')
const assert = require('node:assert/strict')
const { JSDOM } = require('jsdom')

const { captureReadyCheck } = require('./captureReady')

// The predicate reads the global `document`; point it at a jsdom document.
const setDom = (html) => {
    const dom = new JSDOM(`<!DOCTYPE html><body>${html}</body>`)
    global.document = dom.window.document
    return dom.window.document
}

const define = (el, prop, value) => Object.defineProperty(el, prop, { value, configurable: true })

test('false when the frame element is absent', () => {
    setDom('<div>no frame here</div>')
    assert.equal(captureReadyCheck('#frame', true), false)
})

test('false while a loader spinner is present', () => {
    setDom('<div id="frame"><img src="/img/loader.gif"><canvas></canvas></div>')
    assert.equal(captureReadyCheck('#frame', true), false)
})

test('print requires images loaded; screenshot does not', () => {
    // an <img> that has not loaded (naturalWidth 0)
    setDom('<div id="frame"><img src="/flag.png"><canvas></canvas></div>')
    assert.equal(captureReadyCheck('#frame', true), false) // print: blocked on the image
    assert.equal(captureReadyCheck('#frame', false), true) // screenshot: image gate skipped, canvas present
})

test('print ready once every image has loaded', () => {
    const doc = setDom('<div id="frame"><img src="/flag.png"><canvas></canvas></div>')
    const img = doc.querySelector('img')
    define(img, 'complete', true)
    define(img, 'naturalWidth', 24)
    assert.equal(captureReadyCheck('#frame', true), true)
})

// --- Data-page container path (original behaviour) ---
test('data container: ready when a non-title child holds a chart', () => {
    setDom(
        '<div id="frame"><div class="uk-container uk-margin-top uk-margin-bottom"><h3>Title</h3><div><canvas></canvas></div></div></div>',
    )
    assert.equal(captureReadyCheck('#frame', true), true)
})

test('data container: not ready when only the title is present', () => {
    setDom('<div id="frame"><div class="uk-container uk-margin-top uk-margin-bottom"><h3>Title</h3></div></div>')
    assert.equal(captureReadyCheck('#frame', true), false)
})

test('data container: ready on substantial text in a non-title child', () => {
    const doc = setDom(
        '<div id="frame"><div class="uk-container uk-margin-top uk-margin-bottom"><h3>t</h3><div id="c"></div></div></div>',
    )
    define(doc.getElementById('c'), 'innerText', 'x'.repeat(30))
    assert.equal(captureReadyCheck('#frame', true), true)
})

// --- In-place detail-page <main> fallback (no such container) ---
test('detail fallback: ready when a chart/table is present anywhere', () => {
    setDom('<div id="frame"><header>chrome</header><table></table></div>')
    assert.equal(captureReadyCheck('#frame', true), true)
})

test('detail fallback: not ready with no chart and little text', () => {
    setDom('<div id="frame"><div>hi</div></div>')
    assert.equal(captureReadyCheck('#frame', true), false)
})
