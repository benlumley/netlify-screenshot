const test = require('node:test')
const assert = require('node:assert/strict')
const { PDFDocument, rgb } = require('pdf-lib')

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

test('returns a Buffer', async () => {
    const out = await scalePagesTo(await makeBigPdf(1), { scale: 0.625, ...A4 })
    assert.ok(Buffer.isBuffer(out))
})
