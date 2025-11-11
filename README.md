# Slideshow Buddy Server

PKCE-only Spotify OAuth backend for the Slideshow Buddy iOS app. Built with TypeScript + Express, secured and ready to deploy on Render.

## Features

- **PKCE-only OAuth flow** (no client secret)
- **Authorization Code exchange** with PKCE verification
- **Token refresh** with automatic refresh token preservation
- **Security**: Helmet, CORS, rate limiting
- **Validation**: Zod schemas for all requests
- **Logging**: Morgan (dev mode)
- **Production-ready**: TypeScript, error handling, health checks

## Getting Started

### Prerequisites

- Node.js 20+
- Spotify Developer Account with an app configured
- iOS redirect URI whitelisted: `com.slideshowbuddy://callback`

### Installation

```bash
npm install
```

### Environment Variables

Copy `.env.example` to `.env` and fill in your Spotify credentials:

```bash
cp .env.example .env
```

Required variables:
- `PORT` - Server port (default: 8080)
- `SPOTIFY_CLIENT_ID` - Your Spotify app client ID
- `SPOTIFY_REDIRECT_URI` - iOS custom scheme redirect (e.g., `com.slideshowbuddy://callback`)
- `CORS_ORIGIN` - Optional: Comma-separated list of allowed origins for web debugging (defaults to allow all)

### Capacitor Mobile Apps

If using Capacitor mobile apps, set `CORS_ORIGIN` to include `capacitor://localhost` along with your web origins:

```
CORS_ORIGIN=capacitor://localhost,http://localhost:5173,https://localhost:5173
```

This allows requests from:
- iOS Capacitor apps (`capacitor://localhost`)
- Local web development servers (`http://localhost:5173`, `https://localhost:5173`)

### Development

Start the development server with hot reload:

```bash
npm run dev
```

### Build

Compile TypeScript to JavaScript:

```bash
npm run build
```

### Production

Start the production server:

```bash
npm start
```

## API Endpoints

### Health Check

```
GET /healthz
```

Returns:
```json
{ "ok": true }
```

### Exchange Authorization Code for Tokens

```
POST /auth/spotify/token
```

**Body:**
```json
{
  "code": "authorization_code_from_spotify",
  "code_verifier": "your_pkce_code_verifier"
}
```

**Success Response (200):**
```json
{
  "access_token": "...",
  "refresh_token": "...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "user-read-private user-read-email"
}
```

**Error Response (400/500):**
```json
{
  "error": "spotify_token_exchange_failed",
  "details": { ... }
}
```

### Refresh Access Token

```
POST /auth/spotify/refresh
```

**Body:**
```json
{
  "refresh_token": "your_refresh_token"
}
```

**Success Response (200):**
```json
{
  "access_token": "...",
  "refresh_token": "...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "user-read-private user-read-email"
}
```

**Error Response (400/500):**
```json
{
  "error": "spotify_refresh_failed",
  "details": { ... }
}
```

## cURL Examples

### Exchange authorization code:

```bash
curl -X POST http://localhost:8080/auth/spotify/token \
  -H "Content-Type: application/json" \
  -d '{"code":"<CODE_FROM_REDIRECT>","code_verifier":"<SAME_VERIFIER_USED>"}'
```

### Refresh access token:

```bash
curl -X POST http://localhost:8080/auth/spotify/refresh \
  -H "Content-Type: application/json" \
  -d '{"refresh_token":"<YOUR_REFRESH_TOKEN>"}'
```

## Docker

Build and run with Docker:

```bash
docker build -t slideshow-buddy-server .
docker run -p 8080:8080 --env-file .env slideshow-buddy-server
```

## Deploying to Render

### Setup

1. Create a new **Web Service** in Render
2. Connect your GitHub repository
3. Configure the service:

   - **Name**: `slideshow-buddy-server`
   - **Environment**: `Node`
   - **Region**: Choose closest to your users
   - **Branch**: `main` (or `dev`)
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`

### Environment Variables

Add the following environment variables in Render dashboard:

| Key | Value | Notes |
|-----|-------|-------|
| `SPOTIFY_CLIENT_ID` | Your Spotify client ID | Required |
| `SPOTIFY_REDIRECT_URI` | `com.slideshowbuddy://callback` | Required |
| `NODE_ENV` | `production` | Optional |
| `CORS_ORIGIN` | Leave empty or set specific origins | Optional |

### Deploy

1. Push your code to GitHub
2. Render will automatically build and deploy
3. Your API will be available at: `https://your-service-name.onrender.com`
4. Test with: `curl https://your-service-name.onrender.com/healthz`

### Post-Deployment

- Update your iOS app to point to the Render URL
- Monitor logs in Render dashboard
- Set up auto-deploy on push (optional)

## Security Notes

- **PKCE-only**: This server does NOT use client secrets (intentional for mobile apps)
- **Rate limiting**: 60 requests/minute per IP on auth endpoints
- **CORS**: Configured for iOS app (mobile apps ignore CORS); CORS_ORIGIN for web debugging only
- **Helmet**: Security headers enabled
- **Environment**: Never commit `.env` file; use Render's environment variables

## License

ISC
