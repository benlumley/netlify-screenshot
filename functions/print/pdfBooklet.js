// Pure, Chromium-free helpers for the profile booklet (cover, blank, content,
// optional blank, back). Kept separate from the handler so the URL/filename/
// assembly logic is unit-testable.

const { iiagYear } = require('../shared/iiagYear')

// Derive a meaningful download filename from the (already stripped) request path,
// e.g. "/locations/nga" -> "2026-IIAG-profile-nga.pdf". Groups live under
// /locations/<slug> too, so they also get the profile name. Anything else
// (e.g. the Data page) keeps the generic name. The year comes from IIAG_YEAR.
const deriveFilename = (reqPath, year = iiagYear()) => {
    const fallback = `${year}-iiag.pdf`
    const parts = String(reqPath || '')
        .replace(/^\/+|\/+$/g, '')
        .split('/')
        .filter(Boolean)

    // The path may carry a language prefix (e.g. /fr/locations/nga.html), so find
    // the type segment rather than assuming it's first.
    const typeIndex = parts.findIndex((part) => part === 'locations' || part === 'measures')
    if (typeIndex === -1 || typeIndex === parts.length - 1) {
        return fallback
    }

    const type = parts[typeIndex]
    const slug = parts[parts.length - 1]
        .replace(/\.(pdf|html)$/i, '')
        .replace(/[^a-zA-Z0-9-]/g, '')
        .toLowerCase()

    if (!slug) {
        return fallback
    }

    return type === 'locations' ? `${year}-IIAG-profile-${slug}.pdf` : `${year}-IIAG-measure-${slug}.pdf`
}

// The app's language path for the request, taken from the path segment before
// locations/measures, parsed as deriveFilename does:
// "/fr/locations/ao.html" -> "fr/", "/locations/ao.html" -> "". Only a language-code-shaped segment counts, so nothing else from the request
// path can be spliced into the cover/back URLs.
const languagePrefix = (reqPath) => {
    const parts = String(reqPath || '')
        .replace(/^\/+|\/+$/g, '')
        .split('/')
        .filter(Boolean)
    const typeIndex = parts.findIndex((part) => part === 'locations' || part === 'measures')
    const segment = typeIndex > 0 ? parts[typeIndex - 1] : ''

    return /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i.test(segment) ? `${segment}/` : ''
}

// The app's cover and back-cover pages for the request's language. The app bakes
// the language into each page, so the service only picks the path and forwards
// the profile name; the title param is left off when there is no name.
const bookletPageUrls = ({ baseUrl, path, title }) => {
    const root = `${String(baseUrl || '').replace(/\/+$/, '')}/${languagePrefix(path)}`
    const query = title ? `?${new URLSearchParams({ title })}` : ''

    return {
        cover: `${root}print-cover.html${query}`,
        back: `${root}print-back.html`,
    }
}

// Normalise a copied page to the content page size, so the booklet has a uniform
// page size. The cover and back are printed at 210x297mm, which Chromium makes
// 595.92x841.92pt against the content's exact A4 595.28x841.89pt: resizing the
// box trims ~0.2mm off the right edge, where scaling the content would leave
// page-level patterns (CSS gradients) unscaled — see pdfScale.js.
const fitTo = (page, width, height) => {
    const size = page.getSize()
    if (Math.abs(size.width - width) > 0.01 || Math.abs(size.height - height) > 0.01) {
        page.setSize(width, height)
    }

    return page
}

// Assemble the printed booklet: cover, blank inside cover, the N content pages,
// a blank when N is even, and the back cover — so the total is always even and
// the back lands on the outside. Only the first page of the cover and back PDFs
// is used. `PDFDocument` is injected by the caller (see pdfScale.js for why a
// lazy require here does not survive the function bundler).
const assembleBooklet = async (contentPdf, { cover, back, PDFDocument }) => {
    const content = await PDFDocument.load(contentPdf)
    const coverDoc = await PDFDocument.load(cover)
    const backDoc = await PDFDocument.load(back)
    const out = await PDFDocument.create()

    const { width, height } = content.getPage(0).getSize()
    const [coverPage] = await out.copyPages(coverDoc, [0])
    const [backPage] = await out.copyPages(backDoc, [0])
    const contentPages = await out.copyPages(content, content.getPageIndices())

    out.addPage(fitTo(coverPage, width, height))
    out.addPage([width, height])
    contentPages.forEach((page) => out.addPage(page))
    if (contentPages.length % 2 === 0) {
        out.addPage([width, height])
    }
    out.addPage(fitTo(backPage, width, height))

    return Buffer.from(await out.save())
}

module.exports = { assembleBooklet, bookletPageUrls, deriveFilename, languagePrefix }
