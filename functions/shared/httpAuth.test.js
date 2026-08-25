const test = require('node:test')
const assert = require('node:assert/strict')

const { httpCredentials } = require('./httpAuth')

test('httpCredentials: returns the pair when both vars are set', () => {
    assert.deepEqual(
        httpCredentials({ HTTP_AUTH_USER: 'user', HTTP_AUTH_PASS: 'pass' }),
        { username: 'user', password: 'pass' },
    )
})

test('httpCredentials: returns null when neither var is set', () => {
    assert.equal(httpCredentials({}), null)
})

test('httpCredentials: warns and returns null when only the user is set', (t) => {
    const warn = t.mock.method(console, 'warn', () => {})

    assert.equal(httpCredentials({ HTTP_AUTH_USER: 'user' }), null)
    assert.equal(warn.mock.callCount(), 1)
})

test('httpCredentials: warns and returns null when only the password is set', (t) => {
    const warn = t.mock.method(console, 'warn', () => {})

    assert.equal(httpCredentials({ HTTP_AUTH_PASS: 'pass' }), null)
    assert.equal(warn.mock.callCount(), 1)
})
