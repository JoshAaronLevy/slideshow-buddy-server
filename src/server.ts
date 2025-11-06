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
    // Validate request body
    const validationResult = tokenRequestSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        error: 'invalid_request',
        details: validationResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')
      });
    }

    const { code, code_verifier } = validationResult.data;

    // Build Spotify token request params
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: SPOTIFY_REDIRECT_URI,
      client_id: SPOTIFY_CLIENT_ID,
      code_verifier,
    });

    // Exchange code for tokens
    const tokenData = await spotifyToken(params);

    // Return token response
    res.json({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      token_type: tokenData.token_type,
      expires_in: tokenData.expires_in,
      scope: tokenData.scope,
    });
  } catch (error: any) {
    console.error('Spotify token exchange error:', error.response?.data || error.message);
    
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
    // Validate request body
    const validationResult = refreshRequestSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        error: 'invalid_request',
        details: validationResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')
      });
    }

    const { refresh_token } = validationResult.data;

    // Build Spotify refresh request params
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token,
      client_id: SPOTIFY_CLIENT_ID,
    });

    // Refresh token
    const tokenData = await spotifyToken(params);

    // Return token response (preserve old refresh_token if Spotify doesn't send a new one)
    res.json({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token ?? refresh_token,
      token_type: tokenData.token_type,
      expires_in: tokenData.expires_in,
      scope: tokenData.scope,
    });
  } catch (error: any) {
    console.error('Spotify refresh error:', error.response?.data || error.message);
    
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
});
