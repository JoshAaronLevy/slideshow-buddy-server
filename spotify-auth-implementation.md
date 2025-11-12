# Spotify Auth Backend Implementation Plan

**Based on:** `auth-investigation.md`  
**Date:** November 12, 2025  
**Strategy:** Incremental observability improvements → deploy → validate → iterate

---

## Overview

This plan breaks the investigation recommendations into 4 stages, prioritized by impact and risk. Each stage is independently deployable and adds specific diagnostic capabilities without changing core auth logic.

**Approval Process:** Review each stage, then reply "Proceed with stage N" to begin implementation.

---

## Stage 1: Critical Observability (Highest Priority)

**Goal:** Capture missing 404s and unhandled routes that are currently silent in production.

**Impact:** Immediately reveals if clients are hitting wrong paths (top hypothesis from investigation).

**Risk:** Very low (only adds logging, no behavior changes)

**References:** `auth-investigation.md` Sections 7, 10.3

### Tasks
1. Add 404 catch-all route handler before global error handler
   - Returns JSON response: `{ "error": "not_found", "details": "..." }`
   - Logs: method, path, origin, userAgent, ip
   - Location: `src/server.ts` before line 249 (global error handler)

2. Update global error handler to include request path in logs
   - Add path/method to existing error log
   - Location: `src/server.ts:249-254`

### Deliverables
- 404s return consistent JSON (not HTML)
- All unmatched routes logged in production
- Deploy to Render → monitor logs during next failure

### Files Modified
- `src/server.ts` (2 additions: 404 handler, enhanced error logging)

---

## Stage 2: Rate Limit Transparency

**Goal:** Identify if rate limiting is causing intermittent failures during re-auth loops.

**Impact:** Validates/eliminates Hypothesis 2 (40% probability).

**Risk:** Very low (only adds logging to existing rate limiter)

**References:** `auth-investigation.md` Sections 5, 8 (Hypothesis 2), 10.4

### Tasks
1. Add custom rate limit handler with logging
   - Logs: ip, path, origin when limit exceeded
   - Preserves existing 429 JSON response
   - Location: `src/server.ts:72-78` (rate limiter config)

2. Add rate limit headers to success responses
   - Already enabled via `standardHeaders: true`, but verify in logs
   - Client can use `RateLimit-*` headers to back off proactively

### Deliverables
- Rate limit hits logged with IP/origin
- Can correlate 429 responses with client failures
- Data to decide if limit needs adjustment

### Files Modified
- `src/server.ts` (rate limiter config update)

---

## Stage 3: CORS Diagnostics

**Goal:** Capture CORS preflight rejections that may be failing silently.

**Impact:** Validates/eliminates Hypothesis 3 (30% probability).

**Risk:** Low (adds logging, no CORS policy changes)

**References:** `auth-investigation.md` Sections 4, 8 (Hypothesis 3), 10.5

### Tasks
1. Add logging to CORS rejection path
   - Logs: rejected origin, allowed origins list
   - Location: `src/server.ts:40-57` (CORS config callback)

2. Enhance preflight logging
   - Add correlation between preflight and actual request
   - Log response headers sent back (Access-Control-Allow-*)
   - Location: `src/server.ts:63-70` (OPTIONS handler)

3. Add CORS config validation on boot
   - Log parsed `CORS_ORIGIN` value and count
   - Warn if empty (would reject all origins)
   - Location: `src/server.ts` startup section

### Deliverables
- CORS rejections visible in logs
- Can verify if Capacitor app sends unexpected origin variants
- Immediate alert if CORS_ORIGIN misconfigured

### Files Modified
- `src/server.ts` (CORS config, preflight handler, startup validation)

---

## Stage 4: Correlation IDs & Request Tracing

**Goal:** Enable end-to-end request tracing across client and server logs.

**Impact:** Allows stitching client-side 404 errors to server-side events (or absence thereof).

**Risk:** Low-medium (adds middleware, but non-intrusive)

**References:** `auth-investigation.md` Sections 6, 10.1, 10.2

### Tasks
1. Add correlation ID middleware
   - Reads `X-Correlation-ID` header from client (if provided)
   - Generates UUID if not provided
   - Attaches to `req` object as `req.correlationId`
   - Returns in response headers: `X-Correlation-ID`
   - Location: `src/server.ts` early in middleware chain (after body parsing)

2. Add request start/end logging
   - Logs at start of token/refresh handlers
   - Includes: correlationId, method, path, origin, ip, timestamp
   - Location: `src/server.ts:118, 185` (top of auth handlers)

3. Include correlationId in all existing log statements
   - Update token exchange logs (lines 123, 133, 140, 154, 168)
   - Update refresh logs (lines 190, 200, 207, 220, 234)
   - Update error logs (lines 157, 223)
   - Update CORS/404 logs from previous stages

### Deliverables
- Every request has a unique ID
- Client can send correlation ID for explicit tracing
- Server logs include correlation ID in every statement
- Can grep logs by correlation ID to see full request lifecycle

### Files Modified
- `src/server.ts` (new middleware, updates to ~15 log statements)

### Client-Side Requirement
- Client should generate a UUID and send in `X-Correlation-ID` header
- Client should log the same ID when logging errors
- Implementation: 5 lines of code in client HTTP interceptor

---

## Stage 5: Structured Logging (Optional Enhancement)

**Goal:** Replace `console.log` with structured JSON logging for better log aggregation.

**Impact:** Easier to parse logs in monitoring tools (Datadog, LogDNA, etc.).

**Risk:** Medium (larger refactor, introduces new dependency)

**References:** `auth-investigation.md` Section 6

### Tasks
1. Add `pino` logger dependency
   - Install: `npm install pino pino-pretty`
   - Dev dependency for pretty printing: `pino-pretty`

2. Create logger utility
   - File: `src/utils/logger.ts`
   - Configured for production (JSON) and development (pretty)
   - Exports singleton logger instance

3. Replace all `console.log/error/warn` statements
   - Update ~25 log statements across `src/server.ts`
   - Use structured fields: `logger.info({ correlationId, path, ... }, 'Message')`

4. Add request logging middleware
   - Replace morgan with pino-http
   - Automatically logs all requests with correlation IDs

### Deliverables
- All logs output as JSON in production
- Consistent log structure across the app
- Better performance than console.log (pino is ~2x faster)
- Can pipe to log aggregation tools

### Files Modified
- `package.json` (new dependencies)
- `src/utils/logger.ts` (new file)
- `src/server.ts` (replace ~25 log statements)

**Note:** This is optional and can be done after Stages 1-4 prove successful. Consider only if you plan to add log aggregation/monitoring.

---

## Deployment Strategy

After each stage:

1. **Review code changes** (I'll show you the diffs)
2. **Approve for deployment**
3. **Deploy to Render** (automatic from `dev` branch push)
4. **Monitor logs** for 24-48 hours or until next failure occurs
5. **Evaluate results** before proceeding to next stage

**Rollback:** Each stage is additive (no breaking changes). Rollback = revert commit.

---

## Stage Approval Commands

Reply with:
- **"Proceed with stage 1"** → I'll implement 404 logging
- **"Proceed with stage 2"** → I'll implement rate limit logging
- **"Proceed with stage 3"** → I'll implement CORS diagnostics
- **"Proceed with stage 4"** → I'll implement correlation IDs
- **"Proceed with stage 5"** → I'll implement structured logging (optional)
- **"Proceed with stages 1-3"** → I'll batch the first 3 stages together
- **"Skip to stage N"** → I'll implement that stage specifically

---

## Recommended Path

**Conservative (validate incrementally):**
1. Stage 1 → deploy → wait for reproduction → evaluate
2. Stage 2 → deploy → wait → evaluate
3. Stage 3 → deploy → wait → evaluate
4. Stage 4 if still needed

**Aggressive (faster diagnosis):**
1. Stages 1-3 together → deploy → wait for reproduction
2. Stage 4 if needed

**My recommendation:** Start with Stage 1 only. It has the highest probability of revealing the issue (client URL mismatch = 90%). If Stage 1 logs show 404s, the investigation is over. If not, proceed to Stages 2-3.

---

## Questions?

Before proceeding, consider:
- Do you want to batch stages or do them one at a time?
- Is there a client-side deployment happening soon (to add correlation IDs)?
- Do you have access to Render logs in real-time during failures?
- Should I add any additional logging specific to your reproduction steps?

Reply with your approval command when ready.
