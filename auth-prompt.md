You are a senior engineer auditing our Spotify PKCE token backend. Do not change code. Investigate and create a root-level file named `auth-investigation.md` containing your report.

## Context
- Backend: Node/Express, TypeScript, PKCE-only (no client secret).
- Endpoints: 
  - POST /auth/spotify/token  (exchanges { code, code_verifier })
  - POST /auth/spotify/refresh (refreshes with { refresh_token })
- Env includes: SPOTIFY_CLIENT_ID, SPOTIFY_REDIRECT_URI=com.slideshowbuddy://callback, CORS_ORIGIN includes capacitor://localhost.
- Symptom: 
  - First play after linking playlist works from the app.
  - Subsequent playback attempts fail on the client with an auth error; after disconnect/re-auth, a **404** happens during playback (client). 
  - Render logs often showed no requests before we widened CORS; now behavior is mostly working with occasional failures.
- Goal: confirm backend is not contributing (e.g., wrong redirect_uri during exchange, refresh failures, rate limiting, or returning misleading statuses).

## Tasks (investigate only, be opinionated)
1) **Endpoint contracts**  
   - Verify request/response shapes for `/auth/spotify/token` and `/auth/spotify/refresh` and document the expected fields and error responses.  
   - Ensure both endpoints always include meaningful status codes and JSON bodies on error.

2) **Redirect URI & PKCE consistency**  
   - Confirm the redirect URI used during token exchange exactly matches `com.slideshowbuddy://callback`.  
   - Confirm PKCE is enforced (code_verifier required) and passed through to Spotify as intended.

3) **Refresh flow**  
   - Examine the handling when Spotify omits a new refresh token (should keep the old one).  
   - Validate that expirations are not enforced server-side (frontend should manage), and that refresh returns are stable and unambiguous.

4) **CORS / Preflight**  
   - Confirm multiple origins are allowed including `capacitor://localhost`, and that OPTIONS preflight is handled for both endpoints.  
   - Verify headers/methods align with the client usage.

5) **Rate limiting & proxies**  
   - Check that `trust proxy` is set and the rate limiter isn’t mistakenly throttling via shared proxy IPs.  
   - Note current limits and any potential false positives after quick re-auth loops.

6) **Logging & diagnostics**  
   - Audit current logging. Identify where to log safely (without leaking tokens) to capture: request path, sanitized body, correlation id, Spotify response status/error.  
   - Propose a minimal structured logging format and where to place it to help correlate with the client.

7) **HTTP status accuracy**  
   - Ensure the server never returns 404 in “success path” flows (token exchange/refresh).  
   - If a route mismatch or static middleware might serve 404s, note it and when that could occur.

8) **Ranked hypotheses (server-side)**  
   - Provide a ranked list for any backend contribution to the client’s later 404, e.g.: refresh endpoint intermittent failure, CORS edge case with preflight, rate limit 429 masquerading client-side, or wrong path/base URL used by the app at times. Tie each to code locations and evidence.

9) **Actionable next steps**  
   - Recommend the smallest logging additions (what/where) to conclusively validate behavior during a failing reproduction.  
   - Suggest how to add a temporary correlation id (from client) to stitch logs across client/server (only describe—don’t implement).

## Deliverable
Create `auth-investigation.md` at the repo root with:
- Summary (one paragraph)
- Endpoint overview and observed configs
- Reproduction + what to watch in logs
- Observations with file paths
- Ranked hypotheses with evidence
- Proposed logs/metrics to add
- Next steps checklist