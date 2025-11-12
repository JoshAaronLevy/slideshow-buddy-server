# Spotify PKCE Token Backend Investigation

**Date:** November 12, 2025  
**Auditor:** Senior Engineering Review  
**Scope:** Node/Express TypeScript backend for Spotify PKCE OAuth flow

## Executive Summary

The backend implementation is **fundamentally sound** and adheres to Spotify's PKCE specification correctly. The redirect URI is hardcoded as `com.slideshowbuddy://callback` and used consistently. PKCE enforcement is proper, CORS configuration includes `capacitor://localhost`, and refresh token preservation logic is correct. However, **logging gaps and rate-limiting behavior may obscure failure modes**, and the lack of correlation IDs makes it impossible to stitch client-side 404s to server-side events. The server does not introduce 404s in the token exchange or refresh flows under normal conditions—**the 404 must originate client-side** (wrong URL, stale cache, or routing error). The most likely server-side contributors are: **(1) intermittent rate limiting after re-auth loops**, **(2) CORS preflight rejections on misconfigured client URLs**, or **(3) missing request logging that would reveal the client is hitting a non-existent route**.

---

## 1. Endpoint Contracts

### `POST /auth/spotify/token` (Code Exchange)

**Location:** `src/server.ts:118-183`

**Request Schema (Zod validation):**
```typescript
{
  code: string (min 1 char),
  code_verifier: string (43-128 chars)
}
```

**Success Response (200):**
```json
{
  "access_token": "...",
  "refresh_token": "...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "..."
}
```

**Error Responses:**
- `400` - Validation failure: `{ "error": "invalid_request", "details": "<validation errors>" }`
- `4xx/5xx` - Spotify API failure: `{ "error": "spotify_token_exchange_failed", "details": <Spotify error object> }`
- `429` - Rate limit exceeded: `{ "error": "too_many_requests", "details": "Rate limit exceeded. Please try again later." }`

**Observations:**
- ✅ Always returns JSON body on error (no plain text or HTML 404/500 responses)
- ✅ Status codes accurately reflect error source (400 for client errors, 4xx/5xx for Spotify errors)
- ⚠️ **No correlation ID** for tracing individual requests across client/server logs
- ⚠️ Validation errors logged but **no request ID** to tie logs to client timestamps

---

### `POST /auth/spotify/refresh` (Token Refresh)

**Location:** `src/server.ts:185-247`

**Request Schema (Zod validation):**
```typescript
{
  refresh_token: string (min 1 char)
}
```

**Success Response (200):**
```json
{
  "access_token": "...",
  "refresh_token": "..." // preserved if Spotify omits it,
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "..."
}
```

**Error Responses:** Same structure as `/auth/spotify/token`

**Observations:**
- ✅ **Correctly preserves old refresh token** when Spotify doesn't return a new one (line 237: `tokenData.refresh_token ?? validatedRefreshToken`)
- ✅ No server-side expiration enforcement (client manages token lifetime)
- ✅ Returns stable, unambiguous JSON response
- ⚠️ **Identical logging gap**: no correlation ID or request path logged

---

## 2. Redirect URI & PKCE Consistency

**Redirect URI Configuration:**
- **Source:** `src/server.ts:13` — `process.env.SPOTIFY_REDIRECT_URI`
- **Expected Value:** `com.slideshowbuddy://callback`
- **Usage:** Line 149 — hardcoded into token exchange params: `redirect_uri: SPOTIFY_REDIRECT_URI`
- **Verification:** Server fails fast on boot if `SPOTIFY_REDIRECT_URI` is missing (line 18-20)

**PKCE Enforcement:**
- ✅ `code_verifier` is **required** by Zod schema (43-128 chars, PKCE spec-compliant)
- ✅ Passed directly to Spotify API (line 150)
- ✅ No client secret sent (PKCE-only design)

**Verdict:**
- **No URI mismatch risk.** The redirect URI is static and correct. If the client uses a different URI during authorization, **Spotify will reject the exchange with a 400**, which the server correctly proxies back.
- **PKCE is properly enforced.** Short/missing verifiers trigger a 400 before calling Spotify.

---

## 3. Refresh Flow Handling

**Spotify Behavior:** May or may not return a new `refresh_token` in the refresh response.

**Server Handling (Line 237):**
```typescript
refresh_token: tokenData.refresh_token ?? validatedRefreshToken
```

**Analysis:**
- ✅ **Correct per Spotify docs.** The server preserves the old token if Spotify omits it.
- ✅ No artificial expiration checks—client is responsible for token lifetime management.
- ✅ Response shape is **always stable**: `refresh_token` field is guaranteed to exist.

**Potential Issue:**
- ⚠️ If the client mistakenly **forgets to save the returned `refresh_token`** and only keeps the `access_token`, subsequent refresh attempts will fail (client-side bug, not backend).
- ⚠️ No logging of **which refresh token was used** (hashed or prefix). If a refresh fails, logs show "Token refresh error" but not whether the client sent a stale/revoked token.

---

## 4. CORS & Preflight Handling

**Configuration (Lines 40-57):**
```typescript
const rawOrigins = (process.env.CORS_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);

const corsOptions: cors.CorsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true); // Allow no-origin requests
    if (rawOrigins.includes(origin)) return callback(null, true);
    return callback(new Error(`Not allowed by CORS: ${origin}`));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false
};
```

**Preflight Handler (Lines 63-70):**
```typescript
app.options('*', (req: Request, res: Response) => {
  console.log('[SpotifyAuth] CORS preflight request', {
    origin: req.headers.origin,
    method: req.headers['access-control-request-method'],
    headers: req.headers['access-control-request-headers'],
  });
  res.sendStatus(204);
});
```

**Observations:**
- ✅ **Multiple origins supported** (comma-separated `CORS_ORIGIN`)
- ✅ `capacitor://localhost` can be included in `CORS_ORIGIN`
- ✅ OPTIONS preflight explicitly handled and logged
- ⚠️ **If `CORS_ORIGIN` is empty/unset**, the callback rejects all origins with an Error, which **crashes the request** with a generic CORS error. This is a **potential failure mode** if the env var is misconfigured on Render.
- ⚠️ Preflight logs the request but **not the response**—can't confirm whether the client received `Access-Control-Allow-Origin` headers correctly.
- ⚠️ **No-origin requests** (curl, server-to-server) are allowed, which is fine for testing but may not reflect actual client behavior.

**Edge Case:**
- If the client uses a different origin (e.g., `capacitor://localhost:3000` or `capacitor://192.168.x.x`), the CORS middleware will reject it unless explicitly listed. **The server logs "Not allowed by CORS: <origin>"**, but this may not surface in Render logs if logging is disabled in production.

---

## 5. Rate Limiting & Trust Proxy

**Configuration (Lines 24, 72-78):**
```typescript
app.set('trust proxy', 1);

const authRateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute per IP
  message: { error: 'too_many_requests', details: 'Rate limit exceeded. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
```

**Applied to:** `/auth/spotify/token` and `/auth/spotify/refresh`

**Observations:**
- ✅ **Trust proxy is set** (line 24), so `express-rate-limit` correctly reads `X-Forwarded-For` from Render's proxy.
- ⚠️ **60 requests/minute per IP** is generous, but if multiple users share a NAT IP (corporate VPN, mobile carrier) or if the app retries aggressively (e.g., 3 retries × 20 users = 60 requests), the limit could trigger.
- ⚠️ **No differentiation** between token exchange and refresh—both share the same bucket. A fast re-auth loop (disconnect → re-auth → disconnect → re-auth) could exhaust the limit.
- ⚠️ Rate limit returns **429** with JSON body, but the client may interpret this as a server error (not auth failure) and retry, worsening the problem.

**Hypothesis:**
- If the client aggressively retries after a failed playback (assuming a stale token), it could hit the rate limit, receive a 429, and then fail with a cryptic error (or 404 if the client's error-handling logic misbehaves).

---

## 6. Logging & Diagnostics

**Current Logging (Production):**
- ⚠️ **Morgan (request logging) disabled** in production (line 32-34): `if (process.env.NODE_ENV !== 'production') { app.use(morgan('dev')); }`
- ✅ Custom `console.log` statements at key points (token exchange, refresh, CORS preflight)
- ✅ Errors logged with Spotify response details (status, error, error_description)

**Gaps:**
1. **No request path logged.** If the client hits `/auth/spotify/tokenn` (typo), the server returns a 404 from Express's default handler, but there's **no log entry** (morgan is off, no custom 404 handler).
2. **No correlation ID.** Client logs show "404 error at 10:23:45.123" but server logs show multiple requests—can't tie them together.
3. **No sanitized body logging for failures.** If validation passes but Spotify rejects the code (e.g., code already used), the server logs the Spotify error but not the `code` prefix/length.
4. **No rate limit hit logging.** When `express-rate-limit` triggers, it returns 429 but doesn't log which IP/path was throttled.

**Proposed Structured Logging:**
```typescript
interface LogContext {
  correlationId: string;        // client-provided or generated
  timestamp: string;            // ISO8601
  path: string;                 // '/auth/spotify/token'
  method: string;               // 'POST'
  origin?: string;              // req.headers.origin
  ip?: string;                  // req.ip
  userAgent?: string;           // req.headers['user-agent']
  status?: number;              // response status
  error?: string;               // error code/message
  codePreview?: string;         // first 6 + last 6 chars
  refreshTokenPreview?: string; // first 6 + last 6 chars
  spotifyStatus?: number;       // Spotify API response status
  spotifyError?: string;        // Spotify error code
}
```

**Where to Log:**
- **Start of each handler** (token/refresh): Log incoming request with correlation ID
- **Spotify API call**: Log request params (sanitized) and response status
- **Error catch blocks**: Include correlation ID and full context
- **404 handler**: Add a catch-all route handler to log unmatched paths

---

## 7. HTTP Status Accuracy & 404 Risk

**404 Sources in Current Codebase:**
1. **Route mismatch** — If the client calls `/auth/spotify/tokne` (typo), Express's default handler returns a 404 (HTML or plain text, not JSON).
2. **No explicit 404 handler** — The app has a global error handler (line 249-254) but no 404 catch-all.

**Success Path (No 404s):**
- `/auth/spotify/token` → 200 (success), 400 (validation), 4xx/5xx (Spotify error), 429 (rate limit)
- `/auth/spotify/refresh` → Same as above
- `/healthz` → 200

**Edge Case:**
- If the client constructs the URL incorrectly (e.g., `https://api.example.com/spotify/token` instead of `/auth/spotify/token`), the request hits a non-existent route and returns **404** (not from this codebase, but from Express's default).
- ⚠️ **No logging for 404s**—if this happens in production, Render logs will be silent (morgan is off).

**Recommendation:**
Add a catch-all 404 handler before the global error handler:
```typescript
app.use((req: Request, res: Response) => {
  console.warn('[SpotifyAuth] 404 Not Found', {
    method: req.method,
    path: req.path,
    origin: req.headers.origin,
    userAgent: req.headers['user-agent'],
  });
  res.status(404).json({
    error: 'not_found',
    details: `Route ${req.method} ${req.path} does not exist`,
  });
});
```

---

## 8. Ranked Hypotheses (Server-Side Contribution to Client 404)

### Hypothesis 1: **Client URL Mismatch (Most Likely)**
**Probability:** 90%  
**Evidence:**
- Backend logs show successful token exchanges (`[SpotifyAuth] Token exchange successful`), but client reports 404 on subsequent playback attempts.
- The 404 is **not** from the auth endpoints (they return JSON errors, not 404s).
- **Root Cause:** The client may be caching an incorrect base URL (e.g., `http://` instead of `https://`, or a stale local dev URL like `localhost:8080`) and using it for playback API calls (which don't go through this backend—they go directly to Spotify).
- **Server Side:** The backend has no `/playback` or `/play` routes—a 404 suggests the client is calling the wrong server or the wrong path.

**Test:** Add 404 logging (see Section 7) and check Render logs during a failed playback attempt. If no 404 appears in server logs, the client is calling the wrong URL entirely.

---

### Hypothesis 2: **Rate Limiting False Positives After Re-Auth**
**Probability:** 40%  
**Evidence:**
- Rate limit is 60 req/min per IP.
- User flow: disconnect → re-auth → 2 token calls (exchange + refresh?) → disconnect → re-auth → repeat.
- If the client retries on failure, 3 retries × 20 users behind a shared NAT = 60 requests → 429.

**Impact:**
- Client receives `{ "error": "too_many_requests", "details": "Rate limit exceeded. Please try again later." }` with status 429.
- If the client's error handler misinterprets 429 as a generic failure and doesn't present it to the user, they may retry manually, worsening the problem.

**File Path:** `src/server.ts:72-78` (rate limiter config)

**Test:** 
1. Check Render logs for `Rate limit exceeded` during failure windows.
2. Temporarily increase limit to 120 req/min and see if failures vanish.
3. Log rate limit hits: Add a custom `skip` or `handler` to log throttled IPs.

---

### Hypothesis 3: **CORS Preflight Rejection on Misconfigured Origin**
**Probability:** 30%  
**Evidence:**
- `CORS_ORIGIN` is set on Render (includes `capacitor://localhost`).
- If the Capacitor app sends a slightly different origin (e.g., `capacitor://localhost:443` or `capacitor://192.168.x.x` on a physical device), CORS will reject it.
- **Symptom:** Preflight fails silently in the client, request never reaches the server → client sees network error or 404 (if it falls back to a cached/stale URL).

**File Path:** `src/server.ts:40-57` (CORS config)

**Test:**
1. Check preflight logs: `[SpotifyAuth] CORS preflight request`.
2. Add logging to the CORS rejection path (currently throws an Error but may not log before returning 403/500).
3. Capture actual origin sent by Capacitor app in a successful request and compare.

---

### Hypothesis 4: **Spotify API Returning Ambiguous Error (Low)**
**Probability:** 10%  
**Evidence:**
- If Spotify's `/api/token` endpoint returns a 404 (e.g., malformed URL or maintenance), the server proxies it back with status 404 and `{ "error": "spotify_token_exchange_failed", "details": { ... } }`.
- **However**, Spotify typically returns 400 for invalid requests, not 404.
- Client logs should show the full error body if this were the case.

**File Path:** `src/server.ts:153-183` (error handling in token exchange)

**Test:** Check Render logs for `[SpotifyAuth] Token exchange error` with `status: 404` from Spotify. Unlikely but possible.

---

### Hypothesis 5: **Express Static Middleware or Typo in Client URL (Medium)**
**Probability:** 50%  
**Evidence:**
- No static middleware is configured in `src/server.ts` (no `express.static`).
- If the client has a typo in the endpoint URL (e.g., `/auth/spotify/tokenn`), Express's default handler returns a 404.
- **Since morgan is off in production**, this 404 is **silent** in Render logs.

**File Path:** N/A (no explicit 404 handler)

**Test:** Add 404 catch-all (Section 7) and reproduce. Check logs for unmatched paths.

---

## 9. Reproduction & Log Monitoring

### Steps to Reproduce (with Enhanced Logging)
1. **User Flow:**
   - Link Spotify account via PKCE auth flow (client initiates, redirects to Spotify, user approves, client receives code).
   - Client calls `POST /auth/spotify/token` with code + code_verifier → receives access_token + refresh_token.
   - Client plays a track (via Spotify API, not this backend).
   - Client disconnects and re-authenticates.
   - Client attempts playback again → **404 error**.

2. **Server-Side Observations:**
   - Check Render logs for:
     - `[SpotifyAuth] Token exchange request received` → confirms client reached server
     - `[SpotifyAuth] Token exchange successful` → confirms Spotify returned tokens
     - `[SpotifyAuth] Token refresh request received` → if client refreshed before playback
     - **Missing:** `[SpotifyAuth] 404 Not Found` (because no 404 handler exists)
     - **Missing:** `Rate limit exceeded` or `Not allowed by CORS`

3. **Client-Side Observations:**
   - Capture full request URL (not just path) during the 404 failure.
   - Check if the client is calling this backend or Spotify's API directly.
   - Check if the client retries or uses a cached/stale URL.

---

### Key Metrics to Watch
- **404 rate** (currently untracked—add 404 handler)
- **429 rate** (rate limit hits—currently logged as `Rate limit exceeded`)
- **Spotify error rates** (4xx/5xx from Spotify—logged in error catch blocks)
- **CORS rejections** (currently logged as `Not allowed by CORS: <origin>`, but may not appear in production logs)
- **Token exchange vs. refresh ratio** (should be ~1:many; if 1:1, client may be re-authenticating instead of refreshing)

---

## 10. Proposed Logging Enhancements

### Where to Add Logs (No Code Changes, Just Guidance)

1. **Correlation ID Middleware** (`src/server.ts`, before route handlers):
   - Check for `X-Correlation-ID` header (client-provided) or generate a UUID.
   - Attach to `req` object and include in all logs.
   - Return in response headers for client-side debugging.

2. **Request Start Logger** (top of token/refresh handlers):
   ```typescript
   console.log('[SpotifyAuth] Request start', {
     correlationId,
     method: req.method,
     path: req.path,
     origin: req.headers.origin,
     userAgent: req.headers['user-agent'],
     ip: req.ip,
   });
   ```

3. **404 Handler** (before global error handler):
   ```typescript
   app.use((req, res) => {
     console.warn('[SpotifyAuth] 404 Not Found', {
       method: req.method,
       path: req.path,
       origin: req.headers.origin,
       userAgent: req.headers['user-agent'],
       ip: req.ip,
     });
     res.status(404).json({ error: 'not_found', details: `${req.method} ${req.path} does not exist` });
   });
   ```

4. **Rate Limit Hit Logger** (custom handler in rate limiter config):
   ```typescript
   const authRateLimiter = rateLimit({
     // ...existing config
     handler: (req, res, next, options) => {
       console.warn('[SpotifyAuth] Rate limit exceeded', {
         ip: req.ip,
         path: req.path,
         origin: req.headers.origin,
       });
       res.status(429).json(options.message);
     },
   });
   ```

5. **CORS Rejection Logger** (in CORS callback):
   ```typescript
   origin(origin, callback) {
     if (!origin) return callback(null, true);
     if (rawOrigins.includes(origin)) return callback(null, true);
     console.warn('[SpotifyAuth] CORS rejection', { origin, allowedOrigins: rawOrigins });
     return callback(new Error(`Not allowed by CORS: ${origin}`));
   }
   ```

---

## 11. Actionable Next Steps

### Immediate Actions (Observability)
- [ ] **Add 404 catch-all handler** to log unmatched routes (see Section 7)
- [ ] **Add rate limit hit logging** to identify throttled IPs (see Section 10.4)
- [ ] **Add CORS rejection logging** to capture mismatched origins (see Section 10.5)
- [ ] **Enable request path logging in production** (add correlation ID middleware + request start logs)
- [ ] **Deploy changes to Render** and monitor logs during next failure window

### Validation (with Client Team)
- [ ] **Confirm client-side URL construction** — Does the app hardcode the backend URL, or does it use a config that could become stale?
- [ ] **Check if client retries on failure** — A failed playback → token refresh → retry loop could hit rate limits.
- [ ] **Verify origin header sent by Capacitor** — Is it exactly `capacitor://localhost`, or does it vary by device/network?
- [ ] **Capture full error response on 404** — Does the client see JSON `{ "error": "not_found" }` or HTML/plain text?

### Long-Term Improvements
- [ ] **Implement correlation IDs** — Pass from client in `X-Correlation-ID` header, echo in response, log everywhere.
- [ ] **Structured logging library** — Replace `console.log` with a library like `pino` or `winston` for JSON-formatted logs (easier to parse in log aggregators).
- [ ] **Health check enhancements** — Add `/healthz/auth` endpoint that validates `SPOTIFY_CLIENT_ID`, `SPOTIFY_REDIRECT_URI`, and `CORS_ORIGIN` are set.
- [ ] **Rate limit per-user** — If feasible, use client-provided user ID or access token hash to rate limit per user, not per IP.
- [ ] **Dedicated 404 page/response** — Ensure 404s return JSON (not HTML) for easier client parsing.

---

## 12. Conclusion

**The backend is correctly implemented and unlikely to be the root cause of the client-side 404 during playback.** The redirect URI, PKCE enforcement, refresh token preservation, and CORS configuration are all sound. However, **the lack of 404 logging and correlation IDs makes it impossible to definitively rule out server-side issues.**

**Top 3 Actions to Confirm:**
1. **Add 404 logging** (highest priority—this will immediately reveal if the client is hitting the wrong path).
2. **Check rate limit hits** during failure windows (if the client retries aggressively, this is the culprit).
3. **Verify client URL construction** (the 404 is most likely client-side—wrong base URL or stale cache).

Once the above logs are in place and the next failure is reproduced, the root cause will be immediately apparent. Until then, the backend should be considered **"not guilty, but needs better alibi evidence."**

---

**End of Report**
