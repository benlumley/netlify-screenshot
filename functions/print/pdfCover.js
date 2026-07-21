// Pure, Chromium-free helpers for the cover-page feature.
// Kept separate from the handler so the URL/filename/merge logic is unit-testable.

const DEFAULT_ALLOWED_HOSTS = ['assets.iiag.online']

// Prod allows only the assets host. Extra hosts can be permitted via the
// COVER_ALLOWED_HOSTS env var (comma-separated) for local/preview testing —
// never weaken the default in prod.
const allowedHosts = () => {
    const extra = (process.env.COVER_ALLOWED_HOSTS || '')
        .split(',')
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean)

    return [...DEFAULT_ALLOWED_HOSTS, ...extra]
}

// SSRF guard: only https and an allowlisted host may be fetched server-side.
const isAllowedCoverUrl = (urlString, hosts = allowedHosts()) => {
    try {
        const url = new URL(urlString)

        return url.protocol === 'https:' && hosts.includes(url.hostname.toLowerCase())
    } catch (error) {
        return false
    }
}

// Derive a meaningful download filename from the (already stripped) request path,
// e.g. "/locations/nga" -> "2024-IIAG-profile-nga.pdf". Groups live under
// /locations/<slug> too, so they also get the profile name. Anything else
// (e.g. the Data page) keeps the generic name.
const deriveFilename = (reqPath, fallback = '2024-iiag.pdf') => {
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

    return type === 'locations' ? `2024-IIAG-profile-${slug}.pdf` : `2024-IIAG-measure-${slug}.pdf`
}

// Prepend the cover PDF's pages in front of the rendered PDF's pages.
// pdf-lib is required lazily so a coverless request never loads it.
// Cover pages are normalised to the rendered page's dimensions so the merged
// file has a uniform page size (covers should be authored A4 portrait).
const mergeCover = async (renderedPdfBuffer, coverBuffer) => {
    const { PDFDocument } = require('pdf-lib')

    const rendered = await PDFDocument.load(renderedPdfBuffer)
    const cover = await PDFDocument.load(coverBuffer)
    const out = await PDFDocument.create()

    const { width, height } = rendered.getPage(0).getSize()

    const coverPages = await out.copyPages(cover, cover.getPageIndices())
    coverPages.forEach((page) => {
        const size = page.getSize()
        if (Math.abs(size.width - width) > 1 || Math.abs(size.height - height) > 1) {
            page.setSize(width, height)
        }
        out.addPage(page)
    })

    const renderedPages = await out.copyPages(rendered, rendered.getPageIndices())
    renderedPages.forEach((page) => out.addPage(page))

    return Buffer.from(await out.save())
}

module.exports = { allowedHosts, isAllowedCoverUrl, deriveFilename, mergeCover }
