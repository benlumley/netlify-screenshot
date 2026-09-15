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
// `PDFDocument` is injected by the caller (print.mjs imports pdf-lib statically):
// the v2 function bundler only ships node_modules it can trace from static
// imports, and a `require('pdf-lib')` inside a CJS helper is not one of them —
// it was missing at runtime ("Cannot find module 'pdf-lib'").
const scalePagesTo = async (pdfBuffer, { scale, width, height, PDFDocument }) => {
    const doc = await PDFDocument.load(pdfBuffer)
    const scaledPatterns = new Map()
    doc.getPages().forEach((page) => {
        page.scaleContent(scale, scale)
        scalePatterns(doc, page, scale, scaledPatterns)
        page.scaleAnnotations(scale, scale)
        page.setSize(width, height)
    })

    return Buffer.from(await doc.save())
}

// Patterns — Chromium draws CSS gradients (e.g. the map key's colour bar) as
// tiling patterns — are positioned in the page's default coordinate space,
// which the `cm` that scaleContent prepends doesn't reach. Left alone they stay
// full size, and the gradient prints as a fragment of an oversized tile. Point
// each page-level pattern entry at a copy with its matrix scaled to match. A
// copy, not an in-place edit: the same pattern object can also be painted from
// inside a form XObject, whose patterns are relative to the form and already
// scaled by the content transform. `copies` maps every pattern seen — and each
// copy to itself — to the copy's ref, so pages that share Resources are only
// scaled once. Names and arrays come from doc.context.obj() so this still needs
// nothing required from pdf-lib.
const scalePatterns = (doc, page, scale, copies) => {
    const patterns = page.node.Resources()?.lookup(doc.context.obj('Pattern'))
    if (!patterns || typeof patterns.entries !== 'function') {
        return
    }

    const matrixKey = doc.context.obj('Matrix')
    for (const [name, entry] of patterns.entries()) {
        const pattern = doc.context.lookup(entry)
        if (!pattern) {
            continue
        }
        if (!copies.has(pattern)) {
            const copyRef = scaledCopy(doc, pattern, scale, matrixKey)
            copies.set(pattern, copyRef)
            if (copyRef) {
                copies.set(doc.context.lookup(copyRef), copyRef)
            }
        }
        const copyRef = copies.get(pattern)
        if (copyRef) {
            patterns.set(name, copyRef)
        }
    }
}

// Registers a copy of `pattern` with its matrix multiplied by `scale`, or
// returns null — leaving the pattern as it is — for anything unexpected, so an
// odd pattern degrades one gradient rather than failing the request.
const scaledCopy = (doc, pattern, scale, matrixKey) => {
    // Tiling patterns are streams (their dictionary is `.dict`); shading
    // patterns are plain dictionaries, whose own `.dict` is an internal Map.
    const isStream = typeof pattern.dict?.lookup === 'function'
    const dict = isStream ? pattern.dict : pattern
    if (typeof dict.lookup !== 'function' || typeof pattern.clone !== 'function') {
        return null
    }

    const matrix = dict.lookup(matrixKey)
    const values = matrix === undefined
        ? [1, 0, 0, 1, 0, 0]
        : matrix.asArray?.().map((value) => doc.context.lookup(value)?.asNumber?.())
    if (!values || values.length !== 6 || values.some((value) => !Number.isFinite(value))) {
        return null
    }

    const copy = pattern.clone(doc.context)
    const copyDict = isStream ? copy.dict : copy
    copyDict.set(matrixKey, doc.context.obj(values.map((value) => value * scale)))
    return doc.context.register(copy)
}

module.exports = { scalePagesTo }
