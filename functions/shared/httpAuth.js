// Basic-auth credentials for the target site, shared by the print and
// screenshot handlers. A half-configured pair is treated as "no auth" but
// warned about, so a typo'd env var doesn't silently turn into a 401.
const httpCredentials = (env = process.env) => {
    const { HTTP_AUTH_USER: username, HTTP_AUTH_PASS: password } = env

    if (username && password) {
        return { username, password }
    }

    if (username || password) {
        console.warn('Only one of HTTP_AUTH_USER/HTTP_AUTH_PASS is set; basic auth disabled')
    }

    return null
}

module.exports = { httpCredentials }
