// The IIAG edition year stamped on download filenames (e.g. 2026-iiag.png),
// set per site via the IIAG_YEAR env var so a new edition doesn't need a code
// change. The value lands in a Content-Disposition header, so anything other
// than letters, digits and hyphens is rejected in favour of the default.
const DEFAULT_IIAG_YEAR = '2026'

const iiagYear = (env = process.env) => {
    const year = (env.IIAG_YEAR || '').trim()

    if (!year) {
        return DEFAULT_IIAG_YEAR
    }

    if (!/^[A-Za-z0-9-]+$/.test(year)) {
        console.warn(`Ignoring invalid IIAG_YEAR "${year}"; using ${DEFAULT_IIAG_YEAR}`)
        return DEFAULT_IIAG_YEAR
    }

    return year
}

module.exports = { DEFAULT_IIAG_YEAR, iiagYear }
