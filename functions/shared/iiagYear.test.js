const test = require('node:test')
const assert = require('node:assert/strict')

const { DEFAULT_IIAG_YEAR, iiagYear } = require('./iiagYear')

test('iiagYear: defaults to 2026 when the var is unset or blank', () => {
    assert.equal(DEFAULT_IIAG_YEAR, '2026')
    assert.equal(iiagYear({}), '2026')
    assert.equal(iiagYear({ IIAG_YEAR: '  ' }), '2026')
})

test('iiagYear: uses the env var when set', () => {
    assert.equal(iiagYear({ IIAG_YEAR: '2028' }), '2028')
    assert.equal(iiagYear({ IIAG_YEAR: ' 2028 ' }), '2028')
})

test('iiagYear: warns and falls back when the value is unsafe for a header', (t) => {
    const warn = t.mock.method(console, 'warn', () => {})

    assert.equal(iiagYear({ IIAG_YEAR: '2028"; x=y' }), '2026')
    assert.equal(warn.mock.callCount(), 1)
})
