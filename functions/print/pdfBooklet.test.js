const test = require('node:test')
const assert = require('node:assert/strict')
const { PDFDocument, PDFName, PDFString } = require('pdf-lib')

const { assembleBooklet, bookletPageUrls, deriveFilename, languagePrefix } = require('./pdfBooklet')

const A4 = [595.28, 841.89]

const Mark = PDFName.of('TestMark')

// Each page carries a TestMark entry ("<label>-<n>") in its page dict, which
// copyPages keeps, so the booklet's page order can be read back. Blank pages
// added by the assembly carry none.
const makePdf = async (pageCount, label, size = A4) => {
    const doc = await PDFDocument.create()
    for (let i = 0; i < pageCount; i += 1) {
        doc.addPage(size).node.set(Mark, PDFString.of(`${label}-${i + 1}`))
    }
    return Buffer.from(await doc.save())
}

const pageMarks = async (buffer) => {
    const doc = await PDFDocument.load(buffer)
    return doc.getPages().map((page) => page.node.get(Mark)?.decodeText() ?? 'blank')
}

const booklet = async (contentPages, { cover = makePdf(1, 'cover'), back = makePdf(1, 'back'), size } = {}) => (
    assembleBooklet(await makePdf(contentPages, 'content', size), { cover: await cover, back: await back, PDFDocument })
)

test('deriveFilename: locations and groups get the profile name', () => {
    assert.equal(deriveFilename('/locations/nga', '2026'), '2026-IIAG-profile-nga.pdf')
    assert.equal(deriveFilename('/locations/east-africa', '2026'), '2026-IIAG-profile-east-africa.pdf')
})

test('deriveFilename: measures get the measure name', () => {
    assert.equal(deriveFilename('/measures/rol', '2026'), '2026-IIAG-measure-rol.pdf')
})

test('deriveFilename: strips the .html extension', () => {
    assert.equal(deriveFilename('/locations/nga.html', '2026'), '2026-IIAG-profile-nga.pdf')
    assert.equal(deriveFilename('/measures/rol.html', '2026'), '2026-IIAG-measure-rol.pdf')
})

test('deriveFilename: handles a language prefix', () => {
    assert.equal(deriveFilename('/fr/locations/nga.html', '2026'), '2026-IIAG-profile-nga.pdf')
    assert.equal(deriveFilename('/pt/measures/rol.html', '2026'), '2026-IIAG-measure-rol.pdf')
})

test('deriveFilename: unknown paths keep the generic fallback; slug sanitised', () => {
    assert.equal(deriveFilename('/data.html', '2026'), '2026-iiag.pdf')
    assert.equal(deriveFilename('', '2026'), '2026-iiag.pdf')
    assert.equal(deriveFilename('/measures/a!@#', '2026'), '2026-IIAG-measure-a.pdf')
})

test('deriveFilename: stamps the given year on every name', () => {
    assert.equal(deriveFilename('/locations/nga', '2028'), '2028-IIAG-profile-nga.pdf')
    assert.equal(deriveFilename('/measures/rol', '2028'), '2028-IIAG-measure-rol.pdf')
    assert.equal(deriveFilename('/data.html', '2028'), '2028-iiag.pdf')
})

test('deriveFilename: defaults the year from IIAG_YEAR', (t) => {
    const original = process.env.IIAG_YEAR
    t.after(() => {
        if (original === undefined) {
            delete process.env.IIAG_YEAR
        } else {
            process.env.IIAG_YEAR = original
        }
    })

    process.env.IIAG_YEAR = '2030'
    assert.equal(deriveFilename('/locations/nga'), '2030-IIAG-profile-nga.pdf')

    delete process.env.IIAG_YEAR
    assert.equal(deriveFilename('/data.html'), '2026-iiag.pdf')
})

test('languagePrefix: takes the language segment before locations/measures', () => {
    assert.equal(languagePrefix('/fr/locations/ao.html'), 'fr/')
    assert.equal(languagePrefix('/ar/locations/east-africa.html'), 'ar/')
    assert.equal(languagePrefix('/pt/measures/rol.html'), 'pt/')
    assert.equal(languagePrefix('/pt/measures/rol'), 'pt/')
})

test('languagePrefix: no prefix for English, the Data page, or non-language segments', () => {
    assert.equal(languagePrefix('/locations/ao.html'), '')
    assert.equal(languagePrefix('/measures/rol.html'), '')
    assert.equal(languagePrefix('/data.html'), '')
    assert.equal(languagePrefix('/fr/data.html'), '')
    assert.equal(languagePrefix(''), '')
    assert.equal(languagePrefix('/not_a-lang!/locations/ao.html'), '')
})

test('bookletPageUrls: English cover and back with the title encoded', () => {
    assert.deepEqual(
        bookletPageUrls({ baseUrl: 'https://example.com', path: '/locations/ao.html', title: 'Côte d’Ivoire & Co' }),
        {
            cover: 'https://example.com/print-cover.html?title=C%C3%B4te+d%E2%80%99Ivoire+%26+Co',
            back: 'https://example.com/print-back.html',
        },
    )
})

test('bookletPageUrls: language path from the request path', () => {
    assert.deepEqual(
        bookletPageUrls({ baseUrl: 'https://example.com/', path: '/pt/measures/rol.html', title: 'Estado de direito' }),
        {
            cover: 'https://example.com/pt/print-cover.html?title=Estado+de+direito',
            back: 'https://example.com/pt/print-back.html',
        },
    )
})

test('bookletPageUrls: omits the title param when empty', () => {
    assert.equal(bookletPageUrls({ baseUrl: 'https://example.com', path: '/fr/locations/ao.html', title: '' }).cover, 'https://example.com/fr/print-cover.html')
    assert.equal(bookletPageUrls({ baseUrl: 'https://example.com', path: '/locations/ao.html' }).cover, 'https://example.com/print-cover.html')
})

test('assembleBooklet: even content (4) gets a closing blank -> 8 pages', async () => {
    assert.deepEqual(await pageMarks(await booklet(4)), [
        'cover-1', 'blank', 'content-1', 'content-2', 'content-3', 'content-4', 'blank', 'back-1',
    ])
})

test('assembleBooklet: odd content (5) needs no extra blank -> 8 pages', async () => {
    assert.deepEqual(await pageMarks(await booklet(5)), [
        'cover-1', 'blank', 'content-1', 'content-2', 'content-3', 'content-4', 'content-5', 'back-1',
    ])
})

test('assembleBooklet: odd content (3) -> 6 pages', async () => {
    assert.deepEqual(await pageMarks(await booklet(3)), [
        'cover-1', 'blank', 'content-1', 'content-2', 'content-3', 'back-1',
    ])
})

test('assembleBooklet: blanks are sized to the content page', async () => {
    const size = [600, 850]
    const doc = await PDFDocument.load(await booklet(2, { size }))
    const sizes = doc.getPages().map((page) => page.getSize())

    assert.equal(sizes.length, 6)
    sizes.forEach(({ width, height }) => {
        assert.equal(width, size[0])
        assert.equal(height, size[1])
    })
})

test('assembleBooklet: uses only the first page of the cover and back', async () => {
    assert.deepEqual(await pageMarks(await booklet(1, { cover: makePdf(2, 'cover'), back: makePdf(3, 'back') })), [
        'cover-1', 'blank', 'content-1', 'back-1',
    ])
})

test('assembleBooklet: normalises a differently-sized cover and back to the content size', async () => {
    const doc = await PDFDocument.load(await booklet(1, { cover: makePdf(1, 'cover', [200, 300]), back: makePdf(1, 'back', [612, 792]) }))

    doc.getPages().forEach((page) => {
        const { width, height } = page.getSize()
        assert.ok(Math.abs(width - A4[0]) < 1)
        assert.ok(Math.abs(height - A4[1]) < 1)
    })
})

test("assembleBooklet: normalises Chromium's slightly oversize A4 cover and back", async () => {
    const chromiumA4 = [595.92, 841.92]
    const doc = await PDFDocument.load(await booklet(1, { cover: makePdf(1, 'cover', chromiumA4), back: makePdf(1, 'back', chromiumA4) }))

    doc.getPages().forEach((page) => {
        const { width, height } = page.getSize()
        assert.ok(Math.abs(width - A4[0]) < 0.01)
        assert.ok(Math.abs(height - A4[1]) < 0.01)
    })
})

test('assembleBooklet: rejects an unreadable cover', async () => {
    await assert.rejects(booklet(2, { cover: Promise.resolve(Buffer.from('not a pdf')) }))
})
