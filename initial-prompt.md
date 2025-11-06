You are a senior Node/Express engineer. Convert this brand-new repo (`slideshow-buddy-server`) into a production-ready **PKCE-only Spotify OAuth backend** using **TypeScript + Express**, secured and ready to deploy on **Render**. This service will be called by an Ionic React + Capacitor iOS app (“Slideshow Buddy”). Make changes idempotently (update existing files rather than replacing them wholesale when possible). **Do NOT write tests.**

## Context & Goals
- Mobile app uses **Authorization Code with PKCE** (no client secret).
- iOS redirect uses a custom scheme: `com.slideshowbuddy://callback`.
- Spotify dashboard has this redirect whitelisted.
- The mobile app will call:
  - `POST /auth/spotify/token` to exchange `{ code, code_verifier }`
  - `POST /auth/spotify/refresh` to refresh `{ refresh_token }`
- We want: TypeScript, zod validation, helmet, rate limiting, CORS (for web debug), morgan logs, dotenv, axios.
- Deploy on **Render (Web Service)** with HTTPS.

## Requirements (do all of this)
### 1) Package + TypeScript
- Replace package.json fields for TS dev:
  - dependencies: `express`, `cors`, `dotenv`, `axios`, `zod`, `helmet`, `express-rate-limit`, `morgan`
  - devDependencies: `typescript`, `tsx`, `@types/express`, `@types/cors`, `@types/morgan`
  - scripts:
    - `"dev": "tsx watch src/server.ts"`
    - `"build": "tsc"`
    - `"start": "node dist/server.js"`
- Add `tsconfig.json` with:
  ```json
  {
    "compilerOptions": {
      "target": "ES2022",
      "lib": ["ES2022"],
      "module": "ES2022",
      "moduleResolution": "Bundler",
      "outDir": "dist",
      "strict": true,
      "esModuleInterop": true,
      "skipLibCheck": true
    },
    "include": ["src"]
  }
  ```

* Remove the empty `index.js` or leave it ignored. Entry point is `src/server.ts`.

### 2) Environment files

* Create `.env.example` (no secrets) with:

  ```
  PORT=8080
  SPOTIFY_CLIENT_ID=your_spotify_client_id
  SPOTIFY_REDIRECT_URI=com.slideshowbuddy://callback
  # For browser debugging only (native iOS ignores CORS):
  CORS_ORIGIN=http://localhost:5173
  ```
* Ensure `.gitignore` includes: `node_modules`, `dist`, `.env`, `.DS_Store`.

### 3) Implement server: `src/server.ts`

* At top: `import 'dotenv/config'`.

* Create an Express app with:

  * `app.set('trust proxy', 1)` (Render proxies)
  * `helmet()` with `crossOriginResourcePolicy: { policy: 'cross-origin' }`
  * `morgan('dev')` when `NODE_ENV !== 'production'`
  * `cors()` configured with `CORS_ORIGIN` env (single string or comma-separated list). If not set, allow all (dev convenience).
  * `express.json()`

* Validate env on boot: throw if missing `SPOTIFY_CLIENT_ID` or `SPOTIFY_REDIRECT_URI`.

* Helper `spotifyToken(params: URLSearchParams)` that POSTs to `https://accounts.spotify.com/api/token` with `Content-Type: application/x-www-form-urlencoded` using axios.

* **Routes**:

  1. `GET /healthz` → `{ ok: true }`
  2. `POST /auth/spotify/token`

     * zod body schema: `{ code: string; code_verifier: string }` (enforce verifier length 43–128)
     * Build params:

       * `grant_type=authorization_code`
       * `code`
       * `redirect_uri = SPOTIFY_REDIRECT_URI`
       * `client_id = SPOTIFY_CLIENT_ID`
       * `code_verifier`
     * Call Spotify token endpoint.
     * Return `{ access_token, refresh_token, token_type, expires_in, scope }`.
     * On error, forward status + JSON `{ error: 'spotify_token_exchange_failed', details: <spotify error or message> }`.
     * **Important**: This backend is **PKCE-only**. Reject requests missing `code_verifier` with 400.
  3. `POST /auth/spotify/refresh`

     * zod body schema: `{ refresh_token: string }`
     * Build params:

       * `grant_type=refresh_token`
       * `refresh_token`
       * `client_id = SPOTIFY_CLIENT_ID`
     * Call Spotify token endpoint.
     * Return `{ access_token, refresh_token: resp.refresh_token ?? request.refresh_token, token_type, expires_in, scope }`.
     * On error, forward status + JSON `{ error: 'spotify_refresh_failed', details: <spotify error or message> }`.

* **Rate limiting**:

  * Apply `express-rate-limit` to `/auth/*`: e.g., 60 req / minute per IP (sane defaults).

* **Error handling**:

  * Add a final error handler that logs and returns `{ error: 'internal_error' }` with 500 for uncaught errors.

### 4) README.md (append, don’t replace)

Add a “Getting Started” section with:

* Install: `npm i`
* Dev: `npm run dev`
* Build: `npm run build`
* Start: `npm start`
* Env vars required (copy from `.env.example`)
* Endpoints:

  * `GET /healthz`
  * `POST /auth/spotify/token` (body: `{ code, code_verifier }`)
  * `POST /auth/spotify/refresh` (body: `{ refresh_token }`)
* cURL examples (put these in README and also echo them in your response to me):

  ```
  curl -X POST http://localhost:8080/auth/spotify/token \
    -H "Content-Type: application/json" \
    -d '{"code":"<CODE_FROM_REDIRECT>","code_verifier":"<SAME_VERIFIER_USED>"}'

  curl -X POST http://localhost:8080/auth/spotify/refresh \
    -H "Content-Type: application/json" \
    -d '{"refresh_token":"<YOUR_REFRESH_TOKEN>"}'
  ```

### 5) Docker (for parity)

* Add `.dockerignore` with: `node_modules`, `dist`, `.git`, `.env`, `.DS_Store`
* Add `Dockerfile` (node:20-alpine) that:

  * copies package.json/package-lock.json
  * runs `npm ci`
  * copies source
  * runs `npm run build`
  * uses `node dist/server.js` as CMD
  * exposes `PORT`

### 6) Acceptance Criteria

* TypeScript compiles cleanly (`npm run build`).
* `npm run dev` boots on `PORT` (default 8080).
* `GET /healthz` returns `{ ok: true }`.
* `/auth/spotify/token` requires `code` and `code_verifier`, returns tokens on success, structured error on failure.
* `/auth/spotify/refresh` returns a new `access_token` (and keeps the old refresh token if Spotify omits a new one).
* Helmet, CORS, and rate limiting are enabled.
* **No client secret** anywhere (PKCE-only).
* Ready for Render with:

  * Build Command: `npm install && npm run build`
  * Start Command: `npm start`

### 7) Final Output

At the end of your work, print:

* A short summary of files created/modified.
* Exact next steps to run locally.
* Exact Render deploy checklist (including env vars).
* The cURL examples again.

Now implement everything above exactly and idempotently.
