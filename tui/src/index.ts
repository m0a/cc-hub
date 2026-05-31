// `cchub tui` / `bun run --filter tui dev` の入口。
// 接続・認証を解決して接続状態を作り、Ink アプリを起動する。JSX は含めない
// （backend の typecheck から JSX を切り離すため、root は React.createElement で生成）。
import { render } from 'ink';
import React from 'react';
import { createClient } from './api/client';
import { resolveToken } from './api/auth';
import { App } from './components/App';
import type { ConnectionInfo } from './types';

export interface StartTuiOptions {
  port: number;
  host: string;
}

function serverDownHint(baseUrl: string, detail: string): string {
  return [
    `CC Hub サーバ(${baseUrl})に接続できません。`,
    '  → サーバを起動してください（本番: cchub / 開発: env -u TMUX bun run dev）',
    `  詳細: ${detail}`,
  ].join('\n');
}

async function buildConnection(baseUrl: string): Promise<ConnectionInfo> {
  let token: string | null;
  try {
    token = await resolveToken(baseUrl);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes('トークンを発行できません')) {
      return { state: 'unauthorized', baseUrl, error: msg };
    }
    return { state: 'server-down', baseUrl, error: serverDownHint(baseUrl, msg) };
  }

  try {
    const client = createClient({ baseUrl, token });
    // GET /api/sessions は SessionListResponse（{ sessions: SessionResponse[] }）を返す。
    const data = await client.get<{ sessions?: unknown[] }>('/api/sessions');
    const list = Array.isArray(data?.sessions) ? data.sessions : [];
    return {
      state: 'connected',
      baseUrl,
      sessionCount: list.length,
    };
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 401) {
      return { state: 'unauthorized', baseUrl, error: '認証に失敗しました（トークンが拒否されました）' };
    }
    return { state: 'server-down', baseUrl, error: serverDownHint(baseUrl, (e as Error).message) };
  }
}

function isLocalHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '0.0.0.0';
}

export async function startTui(opts: StartTuiOptions): Promise<void> {
  // CC Hub は Tailscale 証明書で HTTPS を話す。localhost では証明書のホスト名が一致しないため、
  // ローカル接続に限り TLS 検証を無効化する（web の --ignore-certificate-errors 相当）。
  // Tailscale IP/ホスト名で接続する場合は正規証明書が一致するので検証は維持する。
  if (isLocalHost(opts.host) && process.env.NODE_TLS_REJECT_UNAUTHORIZED === undefined) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }
  const baseUrl = `https://${opts.host}:${opts.port}`;
  const connection = await buildConnection(baseUrl);

  // server-down は Ink を起動せず、案内を出して非ゼロ終了（非対話でも機能する / FR-012）。
  if (connection.state === 'server-down') {
    console.error(`\n${connection.error}\n`);
    process.exit(1);
  }

  const instance = render(React.createElement(App, { connection }));
  await instance.waitUntilExit();
}

// `bun run src/index.ts [-p <port>] [-H <host>]` で直接起動された場合の引数処理。
if (import.meta.main) {
  const argv = process.argv.slice(2);
  let port = 5923;
  let host = '127.0.0.1';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if ((a === '-p' || a === '--port') && argv[i + 1]) port = Number.parseInt(argv[++i], 10);
    else if ((a === '-H' || a === '--host') && argv[i + 1]) host = argv[++i];
  }
  await startTui({ port, host });
}
