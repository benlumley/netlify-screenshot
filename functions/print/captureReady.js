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

    // In-place detail-page <main> frames have no such container — look for a
    // rendered chart/table (or substantial text) anywhere in the frame.
    const chart = captureElement.querySelector('canvas, svg, table')
    const text = captureElement.innerText?.trim() || ''

    return Boolean(chart) || text.length > 40
}

module.exports = { captureReadyCheck }
