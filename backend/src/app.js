import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config, validateConfig, PROJECT_ROOT, BACKEND_ROOT } from './config/env.js';
import { authenticate } from './middleware/auth.js';
import { csrfProtection, httpsRedirect, apiLimiter } from './middleware/security.js';
import { requestId, requestLogger, apiNotFound, errorHandler } from './middleware/error-handler.js';
import userRoutes from './routes/user.routes.js';
import adminRoutes from './routes/admin.routes.js';

const FRONTEND_DIR = path.join(PROJECT_ROOT, 'frontend');
const AI_SHARED_DIR = path.join(PROJECT_ROOT, 'ai');
const CHART_JS = path.join(BACKEND_ROOT, 'node_modules', 'chart.js', 'dist', 'chart.umd.js');
// MediaPipe Tasks Vision (face detection for the face-distance calibration), self-hosted from node_modules
const MEDIAPIPE_DIR = path.join(BACKEND_ROOT, 'node_modules', '@mediapipe', 'tasks-vision');

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  const supabaseOrigin = config.supabase.url ? new URL(config.supabase.url).origin : '';
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        // 'wasm-unsafe-eval' only lets the self-hosted MediaPipe WebAssembly compile; JS eval stays blocked.
        // 'inline-speculation-rules' only allows the JSON prerender rules added by app.js (no inline JS).
        'script-src': ["'self'", "'wasm-unsafe-eval'", "'inline-speculation-rules'"],
        'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
        'img-src': ["'self'", 'data:', 'blob:', supabaseOrigin, 'https://*.roboflow.com', 'https://storage.googleapis.com'].filter(Boolean),
        'media-src': ["'self'", 'blob:'],
        // Extra origins (e.g. the deployed backend) let a locally served frontend call a remote API.
        'connect-src': ["'self'", ...config.cspConnectSrc],
        'frame-ancestors': ["'none'"],
        'object-src': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
        ...(config.forceHttps ? {} : { 'upgrade-insecure-requests': null }),
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: config.forceHttps ? { maxAge: 31536000, includeSubDomains: true } : false,
  }));
  app.use((req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), payment=()');
    next();
  });

  app.use(httpsRedirect);
  app.use(requestId);
  app.use(cors({ origin: [config.frontendUrl], credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(cookieParser());

  // ---------------- API ----------------
  const api = express.Router();
  api.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  api.use(apiLimiter);
  api.use(requestLogger);
  api.use(csrfProtection);
  api.use(authenticate);
  api.get('/health', (req, res) => res.json({ success: true, data: { status: 'ok', time: new Date().toISOString() } }));
  api.use('/admin', adminRoutes);
  api.use('/', userRoutes);
  api.use(apiNotFound);
  app.use('/api', api);

  // ---------------- Static frontend ----------------
  if (config.serveFrontend) {
    app.get('/vendor/chart.js', (req, res, next) => {
      if (!fs.existsSync(CHART_JS)) return next();
      res.type('application/javascript').setHeader('Cache-Control', 'public, max-age=86400');
      return res.sendFile(CHART_JS);
    });
    app.use('/vendor/mediapipe', express.static(MEDIAPIPE_DIR, {
      index: false,
      maxAge: '1d',
      setHeaders: (res, file) => {
        if (file.endsWith('.mjs') || file.endsWith('.js')) res.type('application/javascript');
        if (file.endsWith('.wasm')) res.type('application/wasm');
      },
    }));
    // Pure, secret-free shared AI helpers (image-quality metrics, class map)
    app.use('/ai-shared', express.static(AI_SHARED_DIR, {
      index: false,
      setHeaders: (res, file) => { if (file.endsWith('.js')) res.type('application/javascript'); },
    }));
    app.use(express.static(FRONTEND_DIR, { extensions: ['html'], maxAge: config.isProd ? '1h' : 0 }));
    app.use((req, res) => res.status(404).sendFile(path.join(FRONTEND_DIR, 'pages', '404.html')));
  }

  app.use(errorHandler);
  return app;
}

/**
 * Default export for Vercel, which picks this module as the serverless entry and
 * requires a default-exported function. The app is built lazily on the first
 * request so importing createApp (src/server.js, tests) has no side effects.
 */
let vercelApp;
export default function handler(req, res) {
  if (!vercelApp) {
    const { errors } = validateConfig();
    if (errors.length) {
      throw new Error(`Configuration invalid: ${errors.join('; ')} — set these in the Vercel project's Environment Variables and redeploy.`);
    }
    vercelApp = createApp();
  }
  return vercelApp(req, res);
}
