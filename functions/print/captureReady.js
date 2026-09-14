// Decides whether the captured element's content has finished rendering.
//
// This runs in TWO places, so keep it fully self-contained — it may only use
// the global `document` and standard JS, with no references to module scope:
//   1. Serialized into the browser by puppeteer's `page.waitForFunction`.
//   2. In Node unit tests, against a jsdom document assigned to `global.document`.
// `requireImages` gates on every image having loaded — the PDF (print) path
// needs it; the PNG (screenshot) path historically does not, so it passes false.
function captureReadyCheck(captureSelector, requireImages) {
    const captureElement = document.querySelector(captureSelector)

    if (!captureElement) {
        return false
    }

    // Still loading if a loader spinner is present.
    if (captureElement.querySelector('img[src*="loader.gif"]')) {
        return false
    }

    // Wait for every image in the frame to have loaded (print path only).
    if (requireImages) {
        const images = Array.from(captureElement.querySelectorAll('img'))
        const imagesLoaded = images.every((image) => image.complete && image.naturalWidth > 0)

        if (!imagesLoaded) {
            return false
        }
    }

    // Data-page frames wrap content in this specific container — preserve the
    // original readiness logic exactly for them (skip the title, then look for a
    // rendered chart/table or substantial text in the remaining children).
    const contentContainer = captureElement.querySelector('.uk-container.uk-margin-top.uk-margin-bottom')
    if (contentContainer) {
        return Array.from(contentContainer.children).slice(1).some((element) => {
            const text = element.innerText?.trim() || ''
            const chart = element.querySelector('canvas, svg, table')

            return text.length > 20 || Boolean(chart)
        })
    }

    // In-place detail-page <main> frames have no such container. Before React
    // mounts, the measure template already contains legacy markup — empty
    // <canvas> placeholders, header-only .top-ten-table grids and a tab bar —
    // so "a canvas/table exists" (and even "the grid exists") was true on a
    // page with no data yet, and slower Lambda runs printed exactly that. Data
    // rows (.fromjs cells) only ever come from the React tables, and every
    // detail page type renders a Scores/Trends grid, so require rows plus a
    // chart canvas. The spinner gate above then covers the later loading
    // phases (Drivers of Change waits on a web worker).
    return (
        Boolean(captureElement.querySelector('canvas')) &&
        Boolean(captureElement.querySelector('.top-ten-table .fromjs'))
    )
}

// A cheap fingerprint of the captured element, used to wait until the page has
// STOPPED changing after captureReadyCheck first passes. The detail pages load
// in phases: the first charts draw, then a later state update drops them back
// to loading spinners and rebuilds everything a second later. A fixed settle
// delay printed that intermediate state on slower runs. Same constraints as
// captureReadyCheck: self-contained, serialized into the browser.
function frameFingerprint(captureSelector) {
    const captureElement = document.querySelector(captureSelector)

    if (!captureElement) {
        return ''
    }

    const count = (selector) => captureElement.querySelectorAll(selector).length

    return [
        count('canvas'),
        count('img[src*="loader.gif"]'),
        count('table'),
        count('.top-ten-table .fromjs'),
        captureElement.querySelectorAll('*').length,
    ].join('|')
}

// True when a fingerprint describes a frame with no loader spinners.
const hasNoSpinner = (fingerprint) => String(fingerprint).split('|')[1] === '0'

module.exports = { captureReadyCheck, frameFingerprint, hasNoSpinner }
