import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serveStatic } from 'hono/bun';
import { auth } from './routes/auth';
import { logs } from './routes/logs';
import { sessions } from './routes/sessions';
import { upload } from './routes/upload';
import { terminalWebSocket, handleTerminalUpgrade } from './routes/terminal';

// Try to load embedded assets (available in compiled binary)
let getStaticAsset: ((path: string) => { content: Buffer; contentType: string } | null) | null = null;
let EMBEDDED_MODE = false;
try {
  const staticAssets = await import('./static-assets');
  getStaticAsset = staticAssets.getStaticAsset;
  EMBEDDED_MODE = true;
} catch {
  // Static assets not bundled, use file system
}

const app = new Hono();

// Middleware
app.use('*', logger());
app.use('*', cors({
  origin: '*',
}));

// Health check
app.get('/health', (c) => c.json({ status: 'ok' }));

// API routes
app.route('/api/auth', auth);
app.route('/api/logs', logs);
app.route('/api/sessions', sessions);
app.route('/api/upload', upload);

// Static files handling
const staticRoot = process.env.STATIC_ROOT || '../frontend/dist';

if (EMBEDDED_MODE && getStaticAsset) {
  // Serve from embedded assets
  app.get('*', (c) => {
    const path = c.req.path;

    // Skip API routes
    if (path.startsWith('/api/')) {
      return c.notFound();
    }

    // Try to get asset
    let asset = getStaticAsset!(path);

    // SPA fallback
    if (!asset) {
      asset = getStaticAsset!('/index.html');
    }

    if (asset) {
      return new Response(new Uint8Array(asset.content), {
        headers: { 'Content-Type': asset.contentType },
      });
    }

    return c.notFound();
  });
} else {
  // Serve from file system (development mode)
  app.use('/*', serveStatic({ root: staticRoot }));
  app.get('*', serveStatic({ root: staticRoot, path: '/index.html' }));
}

// Export app type for Hono RPC
export type AppType = typeof app;

// Start server with WebSocket support
const port = parseInt(process.env.PORT || '3000', 10);
const host = process.env.HOST || '0.0.0.0';

// TLS configuration
const tlsAuto = process.env.TLS === '1' || process.env.TLS === 'auto';
let tlsCert = process.env.TLS_CERT;
let tlsKey = process.env.TLS_KEY;
const tlsCA = process.env.TLS_CA;

// Auto-generate self-signed certificate if TLS=1 and no cert provided
if (tlsAuto && (!tlsCert || !tlsKey)) {
  const os = await import('node:os');
  const fs = await import('node:fs');
  const path = await import('node:path');

  const certDir = path.join(os.tmpdir(), 'cchub-tls');
  const certPath = path.join(certDir, 'cert.pem');
  const keyPath = path.join(certDir, 'key.pem');

  // Check if cert already exists
  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
    console.log('🔐 Generating self-signed certificate...');
    fs.mkdirSync(certDir, { recursive: true });

    const result = Bun.spawnSync([
      'openssl', 'req', '-x509', '-newkey', 'rsa:2048',
      '-keyout', keyPath,
      '-out', certPath,
      '-days', '365',
      '-nodes',
      '-subj', '/CN=localhost',
      '-addext', `subjectAltName=DNS:localhost,DNS:${os.hostname()},IP:127.0.0.1`
    ]);

    if (result.exitCode !== 0) {
      console.error('Failed to generate certificate:', result.stderr.toString());
      process.exit(1);
    }
    console.log(`📜 Certificate generated at: ${certDir}`);
  }

  tlsCert = certPath;
  tlsKey = keyPath;
}

const tlsEnabled = !!(tlsCert && tlsKey);

const protocol = tlsEnabled ? 'https' : 'http';
console.log(`🚀 CC Hub backend starting on ${protocol}://${host}:${port}`);
console.log(`📁 Serving static files from: ${EMBEDDED_MODE ? '(embedded)' : staticRoot}`);
if (tlsEnabled) {
  console.log(`🔒 TLS enabled`);
}

export default {
  port,
  hostname: host,
  ...(tlsEnabled && {
    tls: {
      cert: Bun.file(tlsCert!),
      key: Bun.file(tlsKey!),
      ...(tlsCA && { ca: Bun.file(tlsCA) }),
    },
  }),
  async fetch(req: Request, server: Parameters<typeof handleTerminalUpgrade>[1]) {
    // Handle WebSocket upgrades for terminal
    const wsResponse = await handleTerminalUpgrade(req, server);
    if (wsResponse !== null) {
      return wsResponse;
    }

    // Handle regular HTTP requests
    return app.fetch(req);
  },
  websocket: terminalWebSocket,
};
