const test = require('node:test')
const assert = require('node:assert/strict')
const { PDFDocument } = require('pdf-lib')

const { isAllowedCoverUrl, deriveFilename, mergeCover } = require('./pdfCover')

const A4 = [595.28, 841.89]

const makePdf = async (pageCount, size = A4) => {
    const doc = await PDFDocument.create()
    for (let i = 0; i < pageCount; i += 1) {
        doc.addPage(size)
    }
    return Buffer.from(await doc.save())
}

test('isAllowedCoverUrl: allows https on the assets host', () => {
    assert.equal(isAllowedCoverUrl('https://assets.iiag.online/2024/covers/x.pdf'), true)
})

test('isAllowedCoverUrl: rejects http, other hosts, and junk', () => {
    assert.equal(isAllowedCoverUrl('http://assets.iiag.online/x.pdf'), false)
    assert.equal(isAllowedCoverUrl('https://evil.example.com/x.pdf'), false)
    assert.equal(isAllowedCoverUrl('not-a-url'), false)
    assert.equal(isAllowedCoverUrl(''), false)
})

test('isAllowedCoverUrl: honours an extra allowlisted host', () => {
    assert.equal(
        isAllowedCoverUrl('https://localhost:8888/cover.pdf', ['assets.iiag.online', 'localhost']),
        true,
    )
})

test('deriveFilename: locations and groups get the profile name', () => {
    assert.equal(deriveFilename('/locations/nga'), '2024-IIAG-profile-nga.pdf')
    assert.equal(deriveFilename('/locations/east-africa'), '2024-IIAG-profile-east-africa.pdf')
})

test('deriveFilename: measures get the measure name', () => {
    assert.equal(deriveFilename('/measures/rol'), '2024-IIAG-measure-rol.pdf')
})

test('deriveFilename: strips the .html extension', () => {
    assert.equal(deriveFilename('/locations/nga.html'), '2024-IIAG-profile-nga.pdf')
    assert.equal(deriveFilename('/measures/rol.html'), '2024-IIAG-measure-rol.pdf')
})

test('deriveFilename: handles a language prefix', () => {
    assert.equal(deriveFilename('/fr/locations/nga.html'), '2024-IIAG-profile-nga.pdf')
    assert.equal(deriveFilename('/pt/measures/rol.html'), '2024-IIAG-measure-rol.pdf')
})

test('deriveFilename: unknown paths keep the generic fallback; slug sanitised', () => {
    assert.equal(deriveFilename('/data.html'), '2024-iiag.pdf')
    assert.equal(deriveFilename(''), '2024-iiag.pdf')
    assert.equal(deriveFilename('/measures/a!@#'), '2024-IIAG-measure-a.pdf')
})

test('mergeCover: cover pages come first, then rendered pages', async () => {
    const cover = await makePdf(1)
    const rendered = await makePdf(2)

    const merged = await mergeCover(rendered, cover)
    const mergedDoc = await PDFDocument.load(merged)

    assert.equal(mergedDoc.getPageCount(), 3)
})

test('mergeCover: normalises a differently-sized cover to the rendered page size', async () => {
    const cover = await makePdf(1, [200, 300]) // wrong size on purpose
    const rendered = await makePdf(1, A4)

    const merged = await mergeCover(rendered, cover)
    const mergedDoc = await PDFDocument.load(merged)

    const first = mergedDoc.getPage(0).getSize()
    assert.ok(Math.abs(first.width - A4[0]) < 1)
    assert.ok(Math.abs(first.height - A4[1]) < 1)
})
