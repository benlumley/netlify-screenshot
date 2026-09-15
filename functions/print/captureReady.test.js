const test = require('node:test')
const assert = require('node:assert/strict')
const { JSDOM } = require('jsdom')

const { captureReadyCheck, frameFingerprint, hasNoSpinner, captureSignalCheck, captureImagesLoaded } = require('./captureReady')

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
    setDom('<div id="frame"><img src="/img/loader.gif"><canvas></canvas><div class="top-ten-table"><div class="fromjs">x</div></div></div>')
    assert.equal(captureReadyCheck('#frame', true), false)
})

test('print requires images loaded; screenshot does not', () => {
    // an <img> that has not loaded (naturalWidth 0)
    setDom('<div id="frame"><img src="/flag.png"><canvas></canvas><div class="top-ten-table"><div class="fromjs">x</div></div></div>')
    assert.equal(captureReadyCheck('#frame', true), false) // print: blocked on the image
    assert.equal(captureReadyCheck('#frame', false), true) // screenshot: image gate skipped, content present
})

test('print ready once every image has loaded', () => {
    const doc = setDom('<div id="frame"><img src="/flag.png"><canvas></canvas><div class="top-ten-table"><div class="fromjs">x</div></div></div>')
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
test('detail fallback: ready once a chart canvas AND the Scores/Trends grid are present', () => {
    setDom('<div id="frame"><header>chrome</header><canvas></canvas><div class="top-ten-table"><div class="fromjs">x</div></div></div>')
    assert.equal(captureReadyCheck('#frame', true), true)
})

test('detail fallback: empty first-phase canvases without the grid are not ready', () => {
    setDom('<div id="frame"><canvas></canvas><canvas></canvas></div>')
    assert.equal(captureReadyCheck('#frame', true), false)
})

test("detail fallback: the template's header-only grid and tab bar are not ready", () => {
    setDom(
        '<div id="frame"><canvas></canvas><canvas></canvas><ul class="nav nav-tabs"></ul><div class="top-ten-table"><div class="top-ten-table-header">Score</div></div></div>',
    )
    assert.equal(captureReadyCheck('#frame', true), false)
})

test('detail fallback: a stray svg/table alone is not ready', () => {
    setDom('<div id="frame"><svg></svg><table></table></div>')
    assert.equal(captureReadyCheck('#frame', true), false)
})

test('detail fallback: not ready with no chart and little text', () => {
    setDom('<div id="frame"><div>hi</div></div>')
    assert.equal(captureReadyCheck('#frame', true), false)
})

test('detail fallback: chrome/hero text alone does not mark it ready (chart must render)', () => {
    const doc = setDom('<div id="frame"><div id="hero"></div></div>')
    define(doc.getElementById('hero'), 'innerText', 'x'.repeat(200))
    assert.equal(captureReadyCheck('#frame', true), false)
})

// --- frameFingerprint / hasNoSpinner ---
test('fingerprint: empty when the frame is absent', () => {
    setDom('<div>nothing</div>')
    assert.equal(frameFingerprint('#frame'), '')
})

test('fingerprint: counts canvases, spinners, tables and total elements', () => {
    setDom('<div id="frame"><canvas></canvas><canvas></canvas><img src="/x/loader.gif"><table></table><div class="top-ten-table"><div class="fromjs">x</div></div></div>')
    assert.equal(frameFingerprint('#frame'), '2|1|1|1|6')
})

test('fingerprint: changes when the frame re-renders', () => {
    const doc = setDom('<div id="frame"><canvas></canvas></div>')
    const before = frameFingerprint('#frame')
    doc.getElementById('frame').appendChild(doc.createElement('table'))
    assert.notEqual(frameFingerprint('#frame'), before)
})

test('hasNoSpinner reads the spinner count', () => {
    assert.equal(hasNoSpinner('3|0|2|4|500'), true)
    assert.equal(hasNoSpinner('0|1|0|0|39'), false)
    assert.equal(hasNoSpinner(''), false)
})

// --- captureSignalCheck (explicit front-end contract) ---
test('signal: false when the frame element is absent', () => {
    setDom('<div data-capture-ready="true">not the frame</div>')
    assert.equal(captureSignalCheck('#frame'), false)
})

test('signal: false when the app has not set the attribute', () => {
    // Fully rendered by the heuristic's standards, but no signal (older front end).
    setDom('<div id="frame"><canvas></canvas><div class="top-ten-table"><div class="fromjs">x</div></div></div>')
    assert.equal(captureSignalCheck('#frame'), false)
})

test('signal: true once the frame carries data-capture-ready="true"', () => {
    setDom('<div id="frame" data-capture-ready="true"></div>')
    assert.equal(captureSignalCheck('#frame'), true)
})

test('signal: only the exact value "true" counts', () => {
    const doc = setDom('<div id="frame" data-capture-ready="false"></div>')
    assert.equal(captureSignalCheck('#frame'), false)
    doc.getElementById('frame').setAttribute('data-capture-ready', '')
    assert.equal(captureSignalCheck('#frame'), false)
})

test('signal: a descendant carrying the attribute does not count', () => {
    setDom('<div id="frame"><div data-capture-ready="true"></div></div>')
    assert.equal(captureSignalCheck('#frame'), false)
})

test('signal: false again once the app clears it on returning to loading', () => {
    const doc = setDom('<div id="frame"></div>')
    const frame = doc.getElementById('frame')
    frame.setAttribute('data-capture-ready', 'true')
    assert.equal(captureSignalCheck('#frame'), true)
    frame.removeAttribute('data-capture-ready')
    assert.equal(captureSignalCheck('#frame'), false)
})

test('signal: Data table view — raised on the frame, not the captured #mifDataTable inside it', () => {
    setDom('<div id="screenshotPdfFrame" data-capture-ready="true"><div class="uk-container"><table id="mifDataTable"></table></div></div>')
    assert.equal(captureSignalCheck('#screenshotPdfFrame'), true)
    assert.equal(captureSignalCheck('#mifDataTable'), false) // why the signal is checked on the frame
})

// --- captureImagesLoaded ---
test('images: false when the element is absent', () => {
    setDom('<div>nothing</div>')
    assert.equal(captureImagesLoaded('#frame'), false)
})

test('images: true with no images', () => {
    setDom('<div id="frame"><canvas></canvas></div>')
    assert.equal(captureImagesLoaded('#frame'), true)
})

test('images: false until every image has loaded', () => {
    const doc = setDom('<div id="frame"><img src="/a.png"><img src="/b.png"></div>')
    const [a, b] = doc.querySelectorAll('img')
    define(a, 'complete', true)
    define(a, 'naturalWidth', 10)
    assert.equal(captureImagesLoaded('#frame'), false)
    define(b, 'complete', true)
    define(b, 'naturalWidth', 0) // complete but broken
    assert.equal(captureImagesLoaded('#frame'), false)
    define(b, 'naturalWidth', 10)
    assert.equal(captureImagesLoaded('#frame'), true)
})
