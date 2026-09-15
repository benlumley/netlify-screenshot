const test = require('node:test')
const assert = require('node:assert/strict')

const { a4, isDetailPage, pdfOptions, renderSettings } = require('./pdfLayout')

// The CSS px width Chromium lays the page out at for these print options:
// paper width minus the left and right margins, at 96px per inch.
const printLayoutWidthPx = ({ width, margin }) => {
    const paperIn = parseFloat(width) / 25.4
    return (paperIn - parseFloat(margin.left) - parseFloat(margin.right)) * 96
}

test('isDetailPage matches the measure/location/group profile paths only', () => {
    assert.equal(isDetailPage('/locations/ao.html'), true)
    assert.equal(isDetailPage('/fr/measures/governance.html'), true)
    assert.equal(isDetailPage('/data.html'), false)
    assert.equal(isDetailPage('/pt/data.html'), false)
})

test('every page prints at scale 1 onto paper 1/scale times A4', () => {
    for (const path of ['/locations/ao.html', '/data.html']) {
        const { scale } = renderSettings(path)
        const options = pdfOptions(scale)
        assert.equal(options.scale, 1, path)
        assert.ok(Math.abs(parseFloat(options.width) * scale - a4.widthMm) < 1e-9, path)
        assert.ok(Math.abs(parseFloat(options.height) * scale - a4.heightMm) < 1e-9, path)
    }
})

test('the print layout width equals the render width, so breakpoints match the screen', () => {
    for (const path of ['/locations/ao.html', '/data.html']) {
        const { width, scale } = renderSettings(path)
        assert.ok(Math.abs(printLayoutWidthPx(pdfOptions(scale)) - width) < 1, `${path}: ${printLayoutWidthPx(pdfOptions(scale))} vs ${width}`)
    }
})

test('the Data page lays out at 1440px, the width its PNG is captured at', () => {
    assert.equal(renderSettings('/data.html').width, 1440)
})

test('detail-page print options are unchanged: 1146px at 0.625 on 336mm paper', () => {
    const { width, scale } = renderSettings('/measures/governance.html')
    assert.deepEqual({ width, scale }, { width: 1146, scale: 0.625 })
    // Pinned to the strings the detail pages were already printing with.
    const margin = '0.6444444444444445in'
    assert.deepEqual(pdfOptions(scale), {
        width: '336mm',
        height: '475.2mm',
        scale: 1,
        margin: { top: margin, right: margin, bottom: margin, left: margin },
    })
})
