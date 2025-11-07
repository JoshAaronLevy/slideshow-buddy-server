import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import axios from 'axios';
import { z } from 'zod';

// Validate required environment variables on boot
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI;
const PORT = process.env.PORT || '8080';
const CORS_ORIGIN = process.env.CORS_ORIGIN;

if (!SPOTIFY_CLIENT_ID) {
  throw new Error('Missing required env var: SPOTIFY_CLIENT_ID');
}
if (!SPOTIFY_REDIRECT_URI) {
  throw new Error('Missing required env var: SPOTIFY_REDIRECT_URI');
}

const app = express();

// Trust Render proxy
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

// Logging (only in development)
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

// CORS configuration
const corsOptions = CORS_ORIGIN
  ? {
      origin: CORS_ORIGIN.split(',').map(o => o.trim()),
      credentials: true
    }
  : { origin: true }; // Allow all origins in dev if not specified

app.use(cors(corsOptions));

// Body parsing
app.use(express.json());

// CORS preflight logging
app.options('*', (req: Request, res: Response) => {
  console.log('[SpotifyAuth] CORS preflight request', {
    origin: req.headers.origin,
    method: req.headers['access-control-request-method'],
    headers: req.headers['access-control-request-headers'],
  });
  res.sendStatus(204);
});

// Rate limiting for auth endpoints
const authRateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute per IP
  message: { error: 'too_many_requests', details: 'Rate limit exceeded. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Helper function to call Spotify token endpoint
async function spotifyToken(params: URLSearchParams): Promise<any> {
  const response = await axios.post(
    'https://accounts.spotify.com/api/token',
    params.toString(),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }
  );
  return response.data;
}

// Health check endpoint
app.get('/healthz', (_req: Request, res: Response) => {
  res.json({ ok: true });
});

// Zod schemas for request validation
const tokenRequestSchema = z.object({
  code: z.string().min(1, 'code is required'),
  code_verifier: z.string()
    .min(43, 'code_verifier must be at least 43 characters')
    .max(128, 'code_verifier must be at most 128 characters'),
});

const refreshRequestSchema = z.object({
  refresh_token: z.string().min(1, 'refresh_token is required'),
});

// POST /auth/spotify/token - Exchange authorization code for tokens (PKCE)
app.post('/auth/spotify/token', authRateLimiter, async (req: Request, res: Response) => {
  try {
    const { code, code_verifier } = req.body;
    
    console.log('[SpotifyAuth] Token exchange request received', {
      hasCode: !!code,
      codeLength: code?.length,
      codePreview: code ? `${code.substring(0, 6)}...${code.substring(code.length - 6)}` : undefined,
      hasCodeVerifier: !!code_verifier,
      verifierLength: code_verifier?.length,
      origin: req.headers.origin,
      userAgent: req.headers['user-agent'],
    });
    
    // Validate request body
    const validationResult = tokenRequestSchema.safeParse(req.body);
    if (!validationResult.success) {
      console.log('[SpotifyAuth] Token exchange validation failed', {
        errors: validationResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`),
      });
      return res.status(400).json({
        error: 'invalid_request',
        details: validationResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')
      });
    }

    console.log('[SpotifyAuth] Token exchange validation passed');

    const { code: validatedCode, code_verifier: validatedCodeVerifier } = validationResult.data;

    // Build Spotify token request params
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code: validatedCode,
      redirect_uri: SPOTIFY_REDIRECT_URI,
      client_id: SPOTIFY_CLIENT_ID,
      code_verifier: validatedCodeVerifier,
    });

    console.log('[SpotifyAuth] Calling Spotify token API', {
      grantType: 'authorization_code',
      redirectUri: SPOTIFY_REDIRECT_URI,
      clientId: `${SPOTIFY_CLIENT_ID.substring(0, 8)}...`,
    });

    // Exchange code for tokens
    const tokenData = await spotifyToken(params);

    console.log('[SpotifyAuth] Token exchange successful', {
      hasAccessToken: !!tokenData.access_token,
      hasRefreshToken: !!tokenData.refresh_token,
      tokenType: tokenData.token_type,
      expiresIn: tokenData.expires_in,
      scope: tokenData.scope,
    });

    // Return token response
    res.json({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      token_type: tokenData.token_type,
      expires_in: tokenData.expires_in,
      scope: tokenData.scope,
    });
  } catch (error: any) {
    console.error('[SpotifyAuth] Token exchange error', {
      status: error.response?.status,
      statusText: error.response?.statusText,
      error: error.response?.data?.error,
      errorDescription: error.response?.data?.error_description,
      message: error.message,
      fullResponse: error.response?.data,
    });
    
    const status = error.response?.status || 500;
    const details = error.response?.data || { message: error.message };

    res.status(status).json({
      error: 'spotify_token_exchange_failed',
      details,
    });
  }
});

// POST /auth/spotify/refresh - Refresh access token
app.post('/auth/spotify/refresh', authRateLimiter, async (req: Request, res: Response) => {
  try {
    const { refresh_token } = req.body;
    
    console.log('[SpotifyAuth] Token refresh request received', {
      hasRefreshToken: !!refresh_token,
      tokenLength: refresh_token?.length,
      tokenPreview: refresh_token ? `${refresh_token.substring(0, 6)}...${refresh_token.substring(refresh_token.length - 6)}` : undefined,
      origin: req.headers.origin,
      userAgent: req.headers['user-agent'],
    });
    
    // Validate request body
    const validationResult = refreshRequestSchema.safeParse(req.body);
    if (!validationResult.success) {
      console.log('[SpotifyAuth] Token refresh validation failed', {
        errors: validationResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`),
      });
      return res.status(400).json({
        error: 'invalid_request',
        details: validationResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')
      });
    }

    console.log('[SpotifyAuth] Token refresh validation passed');

    const { refresh_token: validatedRefreshToken } = validationResult.data;

    // Build Spotify refresh request params
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: validatedRefreshToken,
      client_id: SPOTIFY_CLIENT_ID,
    });

    console.log('[SpotifyAuth] Calling Spotify refresh API', {
      grantType: 'refresh_token',
      clientId: `${SPOTIFY_CLIENT_ID.substring(0, 8)}...`,
    });

    // Refresh token
    const tokenData = await spotifyToken(params);

    console.log('[SpotifyAuth] Token refresh successful', {
      hasAccessToken: !!tokenData.access_token,
      hasNewRefreshToken: !!tokenData.refresh_token,
      willPreserveOldRefreshToken: !tokenData.refresh_token,
      tokenType: tokenData.token_type,
      expiresIn: tokenData.expires_in,
      scope: tokenData.scope,
    });

    // Return token response (preserve old refresh_token if Spotify doesn't send a new one)
    res.json({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token ?? validatedRefreshToken,
      token_type: tokenData.token_type,
      expires_in: tokenData.expires_in,
      scope: tokenData.scope,
    });
  } catch (error: any) {
    console.error('[SpotifyAuth] Token refresh error', {
      status: error.response?.status,
      statusText: error.response?.statusText,
      error: error.response?.data?.error,
      errorDescription: error.response?.data?.error_description,
      message: error.message,
      fullResponse: error.response?.data,
    });
    
    const status = error.response?.status || 500;
    const details = error.response?.data || { message: error.message };

    res.status(status).json({
      error: 'spotify_refresh_failed',
      details,
    });
  }
});

// Global error handler
app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    error: 'internal_error',
    details: process.env.NODE_ENV !== 'production' ? error.message : 'An unexpected error occurred',
  });
});

// Start server
app.listen(parseInt(PORT, 10), () => {
  console.log(`🚀 Slideshow Buddy Server running on port ${PORT}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🎵 Spotify Client ID: ${SPOTIFY_CLIENT_ID.substring(0, 8)}...`);
  console.log(`🔄 Redirect URI: ${SPOTIFY_REDIRECT_URI}`);
  console.log('[SpotifyAuth] Spotify OAuth configuration loaded', {
    clientId: `${SPOTIFY_CLIENT_ID.substring(0, 8)}...`,
    redirectUri: SPOTIFY_REDIRECT_URI,
    corsOrigin: CORS_ORIGIN || 'all origins (development mode)',
  });
});
