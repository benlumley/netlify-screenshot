import test from 'node:test'
import assert from 'node:assert/strict'

import { errorResponse, preflightResponse } from './capture.mjs'

test('errorResponse: lets the portal read the failure cross-origin', () => {
    const response = errorResponse(new Error('boom'))

    assert.equal(response.status, 500)
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*')
})

test('errorResponse: reports a TimeoutError as a 504', async () => {
    const error = new Error('Waiting failed')
    error.name = 'TimeoutError'
    const response = errorResponse(error)

    assert.equal(response.status, 504)
    assert.equal((await response.json()).error, 'Screenshot timed out')
})

test('preflightResponse: answers OPTIONS with the CORS allowances', () => {
    const response = preflightResponse(new Request('https://ss.example/screenshot/data.html', { method: 'OPTIONS' }))

    assert.equal(response.status, 204)
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*')
    assert.match(response.headers.get('Access-Control-Allow-Methods'), /GET/)
})

test('preflightResponse: lets GET through to the render', () => {
    assert.equal(preflightResponse(new Request('https://ss.example/screenshot/data.html')), null)
})
