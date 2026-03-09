/**
 * cchub notify - Claude Code hookイベントをCC Hubサーバーに送信する。
 * stdinからhookのJSON入力を読み取り、CC Hubの /api/notify エンドポイントにPOSTする。
 * デフォルトで本番(5923)とdev(3000)の両方に送信する（失敗は無視）。
 *
 * 使い方（Claude Code hook設定）:
 *   "command": "cchub notify"
 */

const PRODUCTION_PORT = 5923;
const DEV_PORT = 3456;

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of Bun.stdin.stream()) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

async function postToPort(port: number, body: string, useHttps: boolean): Promise<void> {
  const protocol = useHttps ? 'https' : 'http';
  const url = `${protocol}://localhost:${port}/api/notify`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  if (!response.ok) {
    throw new Error(`${response.status}`);
  }
}

export async function sendNotify(port: number): Promise<void> {
  try {
    const input = await readStdin();
    if (!input.trim()) {
      return;
    }

    // Validate JSON
    const json = JSON.parse(input);
    const body = JSON.stringify(json);

    // Skip TLS verification since cert is for Tailscale hostname, not localhost
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

    // Determine target ports
    const ports = port !== PRODUCTION_PORT
      // Explicit port specified via -p: send to that port only
      ? [{ port, https: port !== DEV_PORT }]
      // Default: try both production (HTTPS) and dev (HTTP), ignore failures
      : [
          { port: PRODUCTION_PORT, https: true },
          { port: DEV_PORT, https: false },
        ];

    await Promise.allSettled(
      ports.map(({ port: p, https }) => postToPort(p, body, https))
    );
  } catch {
    // Silent failure - hook should not block Claude Code
  }
}
