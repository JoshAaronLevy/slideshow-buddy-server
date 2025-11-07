# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2025-11-06

### Added
- Comprehensive logging for Spotify OAuth endpoints with `[SpotifyAuth]` prefix
- Detailed request logging for token exchange endpoint (sanitized parameters)
- Detailed request logging for token refresh endpoint (sanitized parameters)
- Validation result logging (success and failure cases)
- Spotify API call logging with request parameters (client ID sanitized)
- Success response logging with token presence indicators (not values)
- Enhanced error logging with full Spotify API error details
- CORS preflight request logging for debugging mobile app requests
- Startup configuration logging showing redirect URI and CORS settings
- Security: All logs sanitize sensitive data (tokens/codes show only preview or length)

## [1.0.0] - 2025-11-06

### Added
- Initial production-ready release
- TypeScript + Express backend with ES2022 modules
- PKCE-only Spotify OAuth flow (no client secret)
- `POST /auth/spotify/token` endpoint for authorization code exchange
- `POST /auth/spotify/refresh` endpoint for token refresh
- `GET /healthz` health check endpoint
- Zod validation for all request bodies (code_verifier length enforcement)
- Security middleware: Helmet with cross-origin resource policy
- Rate limiting: 60 requests/minute per IP on auth endpoints
- CORS configuration for development and production
- Morgan logging in development mode
- Comprehensive error handling with structured error responses
- Docker support with Node 20 Alpine image
- Render deployment configuration and documentation
- Environment variable validation on startup
- Complete API documentation with cURL examples