import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serveStatic } from 'hono/bun';
import { auth } from './routes/auth';
import { logs } from './routes/logs';
import { sessions } from './routes/sessions';
import { upload } from './routes/upload';
import { files } from './routes/files';
import { dashboard } from './routes/dashboard';
import { terminalWebSocket, handleTerminalUpgrade } from './routes/terminal';
import { parseArgs, runCli, VERSION } from './cli';
import { conditionalAuthMiddleware } from './middleware/auth';

// Parse CLI arguments
const args = parseArgs(process.argv.slice(2));
const cliResult = await runCli(args);

if (cliResult === 'exit') {
  process.exit(0);
}

// Server mode - continue with startup

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
app.get('/health', (c) => c.json({ status: 'ok', version: VERSION }));

// Auth routes (no auth required for login/required check)
app.route('/api/auth', auth);

// Public images route (no auth required - images are user-uploaded screenshots)
const IMAGES_DIR = '/tmp/cchub-images';
app.get('/api/images/:filename', async (c) => {
  const { readFile } = await import('node:fs/promises');
  const { join, basename } = await import('node:path');

  const filename = c.req.param('filename');

  // Security: only allow alphanumeric, dash, dot for filename
  if (!filename || !/^[\w\-.]+\.(png|jpg|jpeg|gif|webp)$/i.test(filename)) {
    return c.json({ error: 'Invalid filename' }, 400);
  }

  const filePath = join(IMAGES_DIR, basename(filename));

  try {
    const data = await readFile(filePath);
    const ext = filename.split('.').pop()?.toLowerCase();
    const mimeTypes: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
    };

    return new Response(data, {
      headers: {
        'Content-Type': mimeTypes[ext || 'png'] || 'application/octet-stream',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch {
    return c.json({ error: 'Image not found' }, 404);
  }
});

// Protected API routes (require auth if password is set)
app.use('/api/logs/*', conditionalAuthMiddleware);
app.use('/api/sessions/*', conditionalAuthMiddleware);
app.use('/api/sessions', conditionalAuthMiddleware);
app.use('/api/upload/*', conditionalAuthMiddleware);
app.use('/api/files/*', conditionalAuthMiddleware);
app.use('/api/dashboard', conditionalAuthMiddleware);

app.route('/api/logs', logs);
app.route('/api/sessions', sessions);
app.route('/api/upload', upload);
app.route('/api/files', files);
app.route('/api/dashboard', dashboard);

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

// Tailscale certificate setup (required)
const fs = await import('node:fs');
const path = await import('node:path');

// Check if tailscale command exists
const whichResult = Bun.spawnSync(['which', 'tailscale']);
if (whichResult.exitCode !== 0) {
  console.error('❌ エラー: tailscale コマンドが見つかりません');
  console.error('   インストール: https://tailscale.com/download');
  process.exit(1);
}

// Get Tailscale hostname
const statusResult = Bun.spawnSync(['tailscale', 'status', '--json']);
if (statusResult.exitCode !== 0) {
  console.error('❌ エラー: Tailscale の状態を取得できません');
  console.error('   Tailscale が起動しているか確認してください');
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
  console.error('❌ エラー: Tailscale のステータスを解析できません');
  process.exit(1);
}

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
  console.log('🔐 Tailscale 証明書を生成中...');
  fs.mkdirSync(certDir, { recursive: true, mode: 0o700 });

  const certResult = Bun.spawnSync([
    'tailscale', 'cert',
    '--cert-file', certPath,
    '--key-file', keyPath,
    tailscaleHostname
  ]);

  if (certResult.exitCode !== 0) {
    const stderr = certResult.stderr.toString();
    console.error('❌ エラー: Tailscale 証明書の生成に失敗しました');
    console.error(stderr);
    if (stderr.includes('Access denied') || stderr.includes('cert access denied')) {
      console.error('');
      console.error('💡 ヒント: 以下のコマンドを一度実行してください:');
      console.error('   sudo tailscale set --operator=$USER');
    }
    process.exit(1);
  }
  console.log(`📜 証明書を生成しました: ${certDir}`);
}

// Store password in environment for auth middleware
if (args.password) {
  process.env.CCHUB_PASSWORD = args.password;
  console.log('🔒 パスワード認証: 有効');
} else {
  console.log('⚠️  パスワード未設定: -P オプションで設定を推奨');
}

// Start server
const port = args.port;
const host = args.host;

console.log(`🚀 CC Hub v${VERSION}`);
console.log(`   URL: https://${tailscaleHostname}:${port}`);
console.log(`   静的ファイル: ${EMBEDDED_MODE ? '(埋め込み)' : staticRoot}`);

export default {
  port,
  hostname: host,
  tls: {
    cert: Bun.file(certPath),
    key: Bun.file(keyPath),
  },
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
