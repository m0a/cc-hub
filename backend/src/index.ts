import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serveStatic } from 'hono/bun';
import { auth } from './routes/auth';
import { logs } from './routes/logs';
import { sessions } from './routes/sessions';
import { upload } from './routes/upload';
import { files } from './routes/files';
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
app.route('/api/files', files);

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
const tlsMode = process.env.TLS;
const tlsSelfSigned = tlsMode === '1' || tlsMode === 'auto';
const tlsTailscale = tlsMode === 'tailscale';
let tlsCert = process.env.TLS_CERT;
let tlsKey = process.env.TLS_KEY;
const tlsCA = process.env.TLS_CA;

// Tailscale certificate generation
if (tlsTailscale && (!tlsCert || !tlsKey)) {
  const fs = await import('node:fs');
  const path = await import('node:path');

  // Check if tailscale command exists
  const whichResult = Bun.spawnSync(['which', 'tailscale']);
  if (whichResult.exitCode !== 0) {
    console.error('❌ Error: tailscale command not found');
    console.error('   Please install Tailscale: https://tailscale.com/download');
    process.exit(1);
  }

  // Get Tailscale hostname
  const statusResult = Bun.spawnSync(['tailscale', 'status', '--json']);
  if (statusResult.exitCode !== 0) {
    console.error('❌ Error: Failed to get Tailscale status');
    console.error('   Is Tailscale running?');
    process.exit(1);
  }

  let tailscaleHostname: string;
  try {
    const status = JSON.parse(statusResult.stdout.toString());
    const dnsName = status.Self?.DNSName;
    if (!dnsName) {
      throw new Error('DNSName not found in Tailscale status');
    }
    // Remove trailing dot if present
    tailscaleHostname = dnsName.replace(/\.$/, '');
  } catch (e) {
    console.error('❌ Error: Failed to parse Tailscale status');
    process.exit(1);
  }

  console.log(`🔗 Tailscale hostname: ${tailscaleHostname}`);

  const certDir = path.join(process.env.HOME || '/tmp', '.tailscale-certs');
  const certPath = path.join(certDir, `${tailscaleHostname}.crt`);
  const keyPath = path.join(certDir, `${tailscaleHostname}.key`);

  // Check if cert needs to be generated or renewed
  let needsCert = !fs.existsSync(certPath) || !fs.existsSync(keyPath);

  if (!needsCert) {
    // Check if cert is expiring soon (within 7 days)
    try {
      const checkResult = Bun.spawnSync([
        'openssl', 'x509', '-in', certPath, '-checkend', String(7 * 24 * 60 * 60)
      ]);
      needsCert = checkResult.exitCode !== 0;
    } catch {
      needsCert = true;
    }
  }

  if (needsCert) {
    console.log('🔐 Generating Tailscale certificate...');
    fs.mkdirSync(certDir, { recursive: true, mode: 0o700 });

    const certResult = Bun.spawnSync([
      'tailscale', 'cert',
      '--cert-file', certPath,
      '--key-file', keyPath,
      tailscaleHostname
    ]);

    if (certResult.exitCode !== 0) {
      const stderr = certResult.stderr.toString();
      console.error('❌ Error: Failed to generate Tailscale certificate');
      console.error(stderr);
      if (stderr.includes('Access denied') || stderr.includes('cert access denied')) {
        console.error('');
        console.error('💡 Hint: Run this once to allow certificate generation without sudo:');
        console.error('   sudo tailscale set --operator=$USER');
      }
      process.exit(1);
    }
    console.log(`📜 Certificate generated at: ${certDir}`);
  }

  tlsCert = certPath;
  tlsKey = keyPath;
}

// Auto-generate self-signed certificate if TLS=1 and no cert provided
if (tlsSelfSigned && (!tlsCert || !tlsKey)) {
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
