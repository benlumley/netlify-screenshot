// Request-shaping helpers shared by the print and screenshot handlers.

// The v2 runtime has no getRemainingTimeInMillis; track the budget from the
// observed 26s synchronous limit instead.
const lambdaBudget = 26000
const lambdaReserve = 5000

export const safeTimeout = (startedAt, preferred, reserve = lambdaReserve) => (
    Math.max(1000, Math.min(preferred, lambdaBudget - (Date.now() - startedAt) - reserve))
)

export const requestHeaders = () => {
    const headers = {
        'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8',
    }

    if (process.env.BUILD_BYPASS_KEY) {
        headers['X-IDP-Build-Key'] = process.env.BUILD_BYPASS_KEY
    }

    // Cloudflare WAF skip rule for these functions on the non-live targets
    // (front end and API); kept separate from the build key so each can be
    // rotated on its own.
    if (process.env.IDP_NETLIFY_KEY) {
        headers['X-IDP-Netlify-Key'] = process.env.IDP_NETLIFY_KEY
    }

    return headers
}

// A WAF block page (403) loads like any other page, so without this the
// capture just times out waiting for a frame that never renders.
export const assertTargetResponse = (response) => {
    if (!response || response.ok()) {
        return
    }

    const status = response.status()
    const hint = status === 401 || status === 407
        ? 'check HTTP_AUTH_USER/HTTP_AUTH_PASS'
        : 'check the Cloudflare WAF rule and IDP_NETLIFY_KEY'

    throw new Error(`Target returned ${status} for ${response.url()} — ${hint}`)
}

// Lets the portal fetch the capture itself (to show progress and surface
// errors) rather than navigating a tab to it. Public, credential-less GETs, so
// a wildcard origin is enough; plain GETs don't preflight (preflightResponse
// covers callers that add headers).
export const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers": "Content-Disposition",
}

// Answers a CORS preflight without launching Chrome. Plain portal fetches
// never preflight, but a caller adding a header would otherwise run (and
// discard) a full render just to be refused.
export const preflightResponse = (req) => (
    req.method === 'OPTIONS'
        ? new Response(null, {
            status: 204,
            headers: {
                ...corsHeaders,
                "Access-Control-Allow-Methods": "GET, OPTIONS",
                "Access-Control-Allow-Headers": "*",
                "Access-Control-Max-Age": "86400",
            },
        })
        : null
)

export const errorResponse = (error) => {
    const isTimeout = error?.name === 'TimeoutError'

    return new Response(
        JSON.stringify({
            error: isTimeout ? 'Screenshot timed out' : 'Screenshot failed',
            message: error?.message || String(error),
        }),
        {
            status: isTimeout ? 504 : 500,
            headers: {
                ...corsHeaders,
                "Cache-Control": "no-store",
                "Content-Type": "application/json",
            },
        },
    )
}
