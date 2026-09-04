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

    return headers
}

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
                "Cache-Control": "no-store",
                "Content-Type": "application/json",
            },
        },
    )
}
