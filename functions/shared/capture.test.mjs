import test from 'node:test'
import assert from 'node:assert/strict'

import { errorResponse, preflightResponse, requestHeaders, assertTargetResponse } from './capture.mjs'

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

const withEnv = (t, vars) => {
    const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]))
    Object.assign(process.env, vars)
    t.after(() => {
        for (const [k, v] of Object.entries(saved)) {
            if (v === undefined) delete process.env[k]
            else process.env[k] = v
        }
    })
}

const fakeResponse = (status) => ({
    ok: () => status >= 200 && status < 300,
    status: () => status,
    url: () => 'https://target.example/page',
})

test('requestHeaders: sends X-IDP-Netlify-Key when IDP_NETLIFY_KEY is set', (t) => {
    withEnv(t, { IDP_NETLIFY_KEY: 'netlify-secret' })
    assert.equal(requestHeaders()['X-IDP-Netlify-Key'], 'netlify-secret')
})

test('requestHeaders: omits X-IDP-Netlify-Key when IDP_NETLIFY_KEY is unset', (t) => {
    withEnv(t, { IDP_NETLIFY_KEY: '' })
    assert.equal('X-IDP-Netlify-Key' in requestHeaders(), false)
})

test('assertTargetResponse: passes a 200 and a missing response', () => {
    assertTargetResponse(fakeResponse(200))
    assertTargetResponse(null)
})

test('assertTargetResponse: throws on a WAF 403 with the status and WAF hint', () => {
    assert.throws(() => assertTargetResponse(fakeResponse(403)), /Target returned 403 .*WAF/)
})

test('assertTargetResponse: points a 401 at the basic-auth vars', () => {
    assert.throws(() => assertTargetResponse(fakeResponse(401)), /401 .*HTTP_AUTH_USER/)
})
