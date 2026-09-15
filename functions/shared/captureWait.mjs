import { safeTimeout } from "./capture.mjs"
import { captureImagesLoaded, captureSignalCheck, frameFingerprint } from "../print/captureReady.js"

// Readiness waits shared by the print and screenshot handlers: the front end's
// explicit capture-ready signal, with each handler's own DOM heuristic as the
// fallback for builds that don't raise it.

export const selectorTimeout = 10000
export const readyTimeout = 22000
export const readyReserve = 7000
export const settleInterval = 500
export const settleAttempts = 16

// How long, after the capture frame appears, a signalling page gets to raise
// data-capture-ready before we fall back to the DOM heuristic. The front end
// deploys separately, so older builds never raise it. Waiting costs an older
// build nothing when its page takes longer than this to render (the heuristic
// then passes at once — the page kept rendering, and the heuristic's deadline
// is absolute), and at most this much when it renders faster. On ss-test
// (Sept 2026) the detail-page heuristic first passed 3.0–3.6s after dom loaded
// on typical runs, and the page is only fully rendered after that (Drivers of
// Change waits on a web worker, ~1s more with Chrome 123 locally), so a
// signalling build lands around 4–5s: 4s would miss most signals, while 6s
// costs an older build ~2.5s on a typical print. A signalling build slower than
// this simply captures via the heuristic (and logs that the signal was late).
export const signalGrace = 6000

// The export frame: what both handlers wait on and capture, and the element the
// app raises data-capture-ready on. Under takingss it holds the whole export —
// header, title, content (every table, on the Data page's table views) and
// footer — which is also all the print path's page shows.
export const captureSelector = '#screenshotPdfFrame'

// Pages whose front end implements the capture-ready contract: the
// measure/location/group detail pages and the Data page (every view). Other
// pages never signal, so they skip the grace period.
export const signalsCaptureReady = (path) => (
    /(^|\/)(locations|measures)\//.test(path) || /(^|\/)data\.html$/.test(path)
)

// Resolves true once the signal is raised, false if it isn't within `timeout`.
const waitForCaptureSignal = async (page, timeout) => {
    try {
        await page.waitForFunction(captureSignalCheck, { timeout }, captureSelector)
        return true
    } catch (error) {
        if (error?.name === 'TimeoutError') {
            return false
        }
        throw error
    }
}

// The app has declared the page rendered, so only a short confirmation is
// needed: fonts loaded, the frame unchanged across one interval with the signal
// still raised, and (when required) every image in it loaded — the signal
// doesn't cover image downloads. Otherwise compare again; falls through to
// capture when the budget runs low. If the app cleared the signal (back to
// loading), wait for it again — and fail with a timeout, like the heuristics'
// own readiness gates, rather than capture a page the app says is loading.
const settleOnSignal = async (page, { requireImages, startedAt }) => {
    for (let attempt = 0; attempt < settleAttempts; attempt += 1) {
        await page.evaluateHandle('document.fonts.ready')
        const previous = await page.evaluate(frameFingerprint, captureSelector)
        // safeTimeout never returns less than 1000, so ask for more than that:
        // it only comes back as 1000 once under ~1s is left before the reserve.
        if (safeTimeout(startedAt, settleInterval + 1000, readyReserve) <= 1000) {
            return
        }
        await page.waitForTimeout(settleInterval)
        const current = await page.evaluate(frameFingerprint, captureSelector)
        if (!await page.evaluate(captureSignalCheck, captureSelector)) {
            await page.waitForFunction(captureSignalCheck, { timeout: safeTimeout(startedAt, readyTimeout, readyReserve) }, captureSelector)
        } else if (current === previous && (!requireImages || await page.evaluate(captureImagesLoaded, captureSelector))) {
            return
        }
    }
}

// Waits until the capture frame is ready and returns which path decided it:
// 'signal' or 'heuristic'. `signals` is false for pages that never signal;
// `waitForHeuristic(page, captureSelector, startedAt)` is the handler's own
// fallback wait, run unchanged.
export const waitForCaptureReady = async (page, { signals, requireImages, startedAt, waitForHeuristic }) => {
    await page.waitForSelector(captureSelector, { timeout: safeTimeout(startedAt, selectorTimeout) })

    // End the grace at least 1s before the heuristic's deadline (skipping it
    // when there isn't that much left), so falling back never extends it.
    const graceTimeout = safeTimeout(startedAt, signalGrace + 1000, readyReserve) - 1000
    if (signals && graceTimeout > 0 && await waitForCaptureSignal(page, graceTimeout)) {
        await settleOnSignal(page, { requireImages, startedAt })
        return 'signal'
    }

    await waitForHeuristic(page, captureSelector, startedAt)
    if (signals && await page.evaluate(captureSignalCheck, captureSelector)) {
        // The build does signal, just later than signalGrace — worth knowing
        // when tuning it.
        console.log('capture signal raised after the grace period')
    }
    return 'heuristic'
}
