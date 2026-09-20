/**
 * HTTP client — native (Android / iOS).
 *
 * On a phone there is no origin and no CORS, so this is the platform's own
 * fetch, unchanged. The desktop build swaps in httpClient.web.ts via Metro's
 * platform extensions.
 *
 * Every network call in the app goes through this one function (services/api.ts
 * and services/realtime.ts are the only two call sites), which is what makes
 * the desktop swap a two-file change rather than an audit.
 */

export const httpFetch: typeof fetch = (input, init) => fetch(input, init);
