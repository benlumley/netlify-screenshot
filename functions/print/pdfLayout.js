// Page geometry for the generated PDFs.

// 29pt on every side, per the design guide for the profile booklets (InDesign
// "29 px" = 29pt). Puppeteer has no pt unit, hence inches. Explicit A4 because
// Chrome's "A4" preset is 0.1% oversize.
const pageMarginPt = 29
const a4 = { widthMm: 210, heightMm: 297, widthPt: (210 / 25.4) * 72, heightPt: (297 / 25.4) * 72 }

// CSS px (96 per inch) across A4 inside the two margins: ~716px.
const a4ContentWidthPx = ((a4.widthPt - 2 * pageMarginPt) / 72) * 96

const isDetailPage = (path) => /(^|\/)(locations|measures)\//.test(path)

// Each PDF is laid out at the width its page renders at, then shrunk so that
// width fills A4 inside the margins: width x scale = ~716px.
// - The measure/location/group profile PDFs render at 1146px x 0.625, 1.25x the
//   Data page's type and boxes, to match the printed report design.
// - The Data page renders at 1440px — the width its PNG export is captured at —
//   so its PDF lays out exactly like the PNG.
const renderSettings = (path) =>
    isDetailPage(path) ? { width: 1146, scale: 0.625 } : { width: 1440, scale: a4ContentWidthPx / 1440 }

// Chromium's printToPDF `scale` shrinks the layout but evaluates media queries
// against the unscaled paper width, so a scaled A4 print gets the site's narrow
// breakpoints (on the Data page, side-by-side tables stacked into one column).
// So every PDF prints at scale 1 onto paper 1/scale times A4 — layout and
// breakpoints then agree at the render width — and print.mjs shrinks the
// finished pages to A4 with pdf-lib (see pdfScale.js).
const pdfOptions = (scale) => {
    const margin = `${pageMarginPt / 72 / scale}in`
    return {
        width: `${a4.widthMm / scale}mm`,
        height: `${a4.heightMm / scale}mm`,
        scale: 1,
        margin: { top: margin, right: margin, bottom: margin, left: margin },
    }
}

module.exports = { a4, isDetailPage, pageMarginPt, pdfOptions, renderSettings }
