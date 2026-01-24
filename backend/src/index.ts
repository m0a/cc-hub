import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { auth } from './routes/auth';
import { logs } from './routes/logs';
import { sessions } from './routes/sessions';
import { terminalWebSocket, handleTerminalUpgrade } from './routes/terminal';

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

// Export app type for Hono RPC
export type AppType = typeof app;

// Start server with WebSocket support
const port = parseInt(process.env.PORT || '3000');
const host = process.env.HOST || '0.0.0.0';

console.log(`🚀 CC Hub backend starting on ${host}:${port}`);

export default {
  port,
  hostname: host,
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
