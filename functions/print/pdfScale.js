// Shrink every page of a rendered PDF by `scale` onto a fixed page size.
//
// Why: Chromium (at least up to the v123 pack the function runs) evaluates CSS
// media queries against the PAPER width during printToPDF, not against the
// scaled layout width. Printing A4 at scale 0.625 therefore lays the page out
// at 1146px but matches the <960px breakpoints, so the site's responsive rules
// collapse to the mobile layout (stacked cards, 2x2 donuts). Printing at
// scale 1 onto paper 1/scale wider keeps layout and breakpoints in agreement;
// this then scales the finished pages down to the real paper size. Text stays
// text and vectors stay vectors — it is a single transform per page.
//
// pdf-lib is required lazily so the Data-page path never loads it.
const scalePagesTo = async (pdfBuffer, { scale, width, height }) => {
    const { PDFDocument } = require('pdf-lib')

    const doc = await PDFDocument.load(pdfBuffer)
    doc.getPages().forEach((page) => {
        page.scaleContent(scale, scale)
        page.scaleAnnotations(scale, scale)
        page.setSize(width, height)
    })

    return Buffer.from(await doc.save())
}

module.exports = { scalePagesTo }
