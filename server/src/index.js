import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { connectDB } from './db.js';
import { makeRoutes } from './routes.js';
import { STORAGE_MODE } from './storage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4000);
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/milart';
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads'));
const CLIENT_DIST = path.resolve(path.join(__dirname, '..', '..', 'client', 'dist'));
const CLIENT_INDEX = path.join(CLIENT_DIST, 'index.html');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

console.log('[boot] cwd          =', process.cwd());
console.log('[boot] __dirname    =', __dirname);
console.log('[boot] NODE_ENV     =', process.env.NODE_ENV);
console.log('[boot] PORT         =', PORT);
console.log('[boot] UPLOAD_DIR   =', UPLOAD_DIR);
console.log('[boot] CLIENT_DIST  =', CLIENT_DIST, fs.existsSync(CLIENT_DIST) ? '(exists)' : '(MISSING)');
console.log('[boot] CLIENT_INDEX =', CLIENT_INDEX, fs.existsSync(CLIENT_INDEX) ? '(exists)' : '(MISSING)');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));
app.use('/api', makeRoutes({ uploadDir: UPLOAD_DIR }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Diagnostic — shows what paths the server resolved to. Safe to leave enabled.
app.get('/api/_debug', (_req, res) => {
  let uploadContents = null;
  try { uploadContents = fs.existsSync(UPLOAD_DIR) ? fs.readdirSync(UPLOAD_DIR).slice(0, 50) : null; } catch (e) { uploadContents = `error: ${e.message}`; }
  res.json({
    nodeEnv: process.env.NODE_ENV,
    cwd: process.cwd(),
    dirname: __dirname,
    storage: {
      mode: STORAGE_MODE,
      bucket: process.env.SUPABASE_BUCKET || 'images',
      supabaseConfigured: !!(process.env.SUPABASE_URL && (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_KEY)),
    },
    uploadDir: { path: UPLOAD_DIR, exists: fs.existsSync(UPLOAD_DIR), contents: uploadContents },
    clientDist: { path: CLIENT_DIST, exists: fs.existsSync(CLIENT_DIST) },
    clientIndex: { path: CLIENT_INDEX, exists: fs.existsSync(CLIENT_INDEX) },
    distContents: fs.existsSync(CLIENT_DIST) ? fs.readdirSync(CLIENT_DIST) : null,
  });
});

// Serve the built client whenever it exists (don't gate on NODE_ENV, simpler).
if (fs.existsSync(CLIENT_INDEX)) {
  app.use(express.static(CLIENT_DIST));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
    res.sendFile(CLIENT_INDEX);
  });
} else {
  // Helpful fallback so a misconfigured deploy doesn't just silently 404.
  app.get('/', (_req, res) => {
    res.status(500).type('html').send(`
      <h1>MilaRT server is up, but the client build is missing</h1>
      <p>Expected file: <code>${CLIENT_INDEX}</code></p>
      <p>This usually means the deploy build step didn't run. On Railway, check the build logs for <code>vite build</code>.</p>
      <p>See <a href="/api/_debug">/api/_debug</a> for the resolved paths.</p>
    `);
  });
}

app.use((err, _req, res, _next) => {
  console.error('[err]', err.message);
  const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  res.status(status).json({ error: err.message });
});

connectDB(MONGODB_URI)
  .then(() => {
    app.listen(PORT, () => console.log(`[server] listening on :${PORT}`));
  })
  .catch((err) => {
    console.error('[db] failed to connect:', err.message);
    process.exit(1);
  });
