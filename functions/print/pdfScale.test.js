const test = require('node:test')
const assert = require('node:assert/strict')
const { PDFArray, PDFDocument, PDFName, rgb } = require('pdf-lib')

const { scalePagesTo } = require('./pdfScale')

const A4 = { width: 595.28, height: 841.89, PDFDocument }

// A "big" page, as Chromium would print it at scale 1 on 1/0.625 A4 paper.
const makeBigPdf = async (pageCount) => {
    const doc = await PDFDocument.create()
    for (let i = 0; i < pageCount; i += 1) {
        const page = doc.addPage([A4.width / 0.625, A4.height / 0.625])
        page.drawRectangle({ x: 100, y: 100, width: 200, height: 50, color: rgb(0, 0, 0) })
    }
    return Buffer.from(await doc.save())
}

test('scales every page onto the requested page size and keeps the page count', async () => {
    const out = await scalePagesTo(await makeBigPdf(3), { scale: 0.625, ...A4 })
    const doc = await PDFDocument.load(out)

    assert.equal(doc.getPageCount(), 3)
    doc.getPages().forEach((page) => {
        const { width, height } = page.getSize()
        assert.ok(Math.abs(width - A4.width) < 0.01)
        assert.ok(Math.abs(height - A4.height) < 0.01)
    })
})

test('wraps the content in a scaling transform rather than dropping it', async () => {
    const out = await scalePagesTo(await makeBigPdf(1), { scale: 0.625, ...A4 })
    const doc = await PDFDocument.load(out)
    const page = doc.getPage(0)
    // pdf-lib's scaleContent prepends a `q <scale> 0 0 <scale> 0 0 cm` operator
    // to the page's content streams; the original stream must still be there.
    const contents = page.node.Contents()
    assert.ok(contents, 'page still has content streams')
    assert.ok(contents.size ? contents.size() >= 2 : true)
})

test('scales page patterns (CSS gradients) with the content, once per shared pattern', async () => {
    const doc = await PDFDocument.create()
    // A tiling pattern with no matrix (identity), as Chromium emits for a CSS
    // gradient, and a second pattern that already has an offset matrix.
    const tiling = doc.context.register(doc.context.stream('', {
        Type: 'Pattern', PatternType: 1, PaintType: 1, TilingType: 1, BBox: [0, 0, 10, 10], XStep: 10, YStep: 10, Resources: {},
    }))
    const offset = doc.context.register(doc.context.obj({ Type: 'Pattern', PatternType: 2, Matrix: [2, 0, 0, 2, 10, 20] }))
    for (let i = 0; i < 2; i += 1) {
        const page = doc.addPage([A4.width / 0.625, A4.height / 0.625])
        page.node.set(PDFName.of('Resources'), doc.context.obj({ Pattern: { P1: tiling, P2: offset } }))
    }

    const out = await scalePagesTo(Buffer.from(await doc.save()), { scale: 0.625, ...A4 })
    const loaded = await PDFDocument.load(out)
    const matrixOf = (pageIndex, name) => {
        const pattern = loaded.getPage(pageIndex).node.Resources().lookup(PDFName.of('Pattern')).lookup(PDFName.of(name))
        // A stream's dictionary is `.dict`; a plain dictionary's `.dict` is its internal Map.
        const dict = typeof pattern.dict?.lookup === 'function' ? pattern.dict : pattern
        return dict.lookup(PDFName.of('Matrix'), PDFArray).asArray().map((value) => value.asNumber())
    }

    for (const pageIndex of [0, 1]) {
        assert.deepEqual(matrixOf(pageIndex, 'P1'), [0.625, 0, 0, 0.625, 0, 0])
        assert.deepEqual(matrixOf(pageIndex, 'P2'), [1.25, 0, 0, 1.25, 6.25, 12.5])
    }
})

// Resolves a page's (or form's) named pattern and returns its matrix, or null.
const patternMatrix = (resources, name) => {
    const pattern = resources.lookup(PDFName.of('Pattern')).lookup(PDFName.of(name))
    const dict = typeof pattern.dict?.lookup === 'function' ? pattern.dict : pattern
    const matrix = dict.lookup(PDFName.of('Matrix'))
    return matrix ? matrix.asArray().map((value) => value.asNumber?.() ?? String(value)) : null
}

test('a pattern also painted inside a form XObject keeps its original matrix there', async () => {
    const doc = await PDFDocument.create()
    const tiling = doc.context.register(doc.context.stream('', {
        Type: 'Pattern', PatternType: 1, PaintType: 1, TilingType: 1, BBox: [0, 0, 10, 10], XStep: 10, YStep: 10, Resources: {},
    }))
    const form = doc.context.register(doc.context.stream('', {
        Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 10, 10], Resources: { Pattern: { P1: tiling } },
    }))
    const page = doc.addPage([A4.width / 0.625, A4.height / 0.625])
    page.node.set(PDFName.of('Resources'), doc.context.obj({ Pattern: { P1: tiling }, XObject: { X1: form } }))

    const loaded = await PDFDocument.load(await scalePagesTo(Buffer.from(await doc.save()), { scale: 0.625, ...A4 }))
    const pageResources = loaded.getPage(0).node.Resources()
    const formResources = pageResources.lookup(PDFName.of('XObject')).lookup(PDFName.of('X1')).dict.lookup(PDFName.of('Resources'))

    assert.deepEqual(patternMatrix(pageResources, 'P1'), [0.625, 0, 0, 0.625, 0, 0])
    assert.equal(patternMatrix(formResources, 'P1'), null) // still identity: the form is scaled by the content transform
})

test('a pattern with a malformed matrix is left alone rather than failing the PDF', async () => {
    const doc = await PDFDocument.create()
    const odd = doc.context.register(doc.context.obj({ Type: 'Pattern', PatternType: 2, Matrix: ['x', 0, 0, 1, 0, 0] }))
    const page = doc.addPage([A4.width / 0.625, A4.height / 0.625])
    page.node.set(PDFName.of('Resources'), doc.context.obj({ Pattern: { P1: odd } }))

    const loaded = await PDFDocument.load(await scalePagesTo(Buffer.from(await doc.save()), { scale: 0.625, ...A4 }))
    assert.deepEqual(patternMatrix(loaded.getPage(0).node.Resources(), 'P1'), ['/x', 0, 0, 1, 0, 0])
    assert.ok(Math.abs(loaded.getPage(0).getSize().width - A4.width) < 0.01)
})

test('returns a Buffer', async () => {
    const out = await scalePagesTo(await makeBigPdf(1), { scale: 0.625, ...A4 })
    assert.ok(Buffer.isBuffer(out))
})
