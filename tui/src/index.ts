// `cchub tui` / `bun run --filter tui dev` の入口。
// 接続・認証を解決し、alt-screen 上で一覧を描画 → Enter で tmux attach にハンドオフ →
// detach で復帰、のループを回す。JSX は含めない（backend の typecheck から切り離すため、
// root は React.createElement で生成）。
import { render } from 'ink';
import React from 'react';
import { resolveToken } from './api/auth';
import { type ApiClient, createClient } from './api/client';
import { getSessions } from './api/sessions';
import { App } from './components/App';
import { attachSession } from './tmux/attach';
import type { ListAction } from './types';

const ALT_ON = '\x1b[?1049h';
const ALT_OFF = '\x1b[?1049l';

export interface StartTuiOptions {
  port: number;
  host: string;
}

function isLocalHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '0.0.0.0';
}

function serverDownHint(baseUrl: string, detail: string): string {
  return [
    `CC Hub サーバ(${baseUrl})に接続できません。`,
    '  → サーバを起動してください（本番: cchub / 開発: env -u TMUX bun run dev）',
    `  詳細: ${detail}`,
  ].join('\n');
}

/** 接続を確立してクライアントを返す。失敗時は分類された Error を投げる。 */
async function connect(baseUrl: string): Promise<ApiClient> {
  const token = await resolveToken(baseUrl); // server-down / unauthorized で throw
  const client = createClient({ baseUrl, token });
  await getSessions(client); // 疎通プローブ（401 等はここで ApiError）
  return client;
}

/** Ink で一覧を 1 回描画し、ユーザ操作（attach / quit）で解決して unmount する。 */
function renderListOnce(client: ApiClient, baseUrl: string): Promise<ListAction> {
  return new Promise((resolve) => {
    const instance = render(
      React.createElement(App, {
        client,
        baseUrl,
        onAction: (action: ListAction) => {
          instance.unmount();
          resolve(action);
        },
      }),
    );
  });
}

function ensureInteractiveTty(): void {
  // Ink の useInput は raw mode を要求する。stdin が TTY でない（パイプ/リダイレクト、
  // RTK 等のラッパ経由、raw mode 非対応の端末）と Ink が内部で例外を投げ、react-reconciler の
  // 難解なスタックになる。事前に検知して分かりやすく案内する。
  const stdin = process.stdin as NodeJS.ReadStream & { setRawMode?: unknown };
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    console.error(
      [
        '',
        'cchub tui は対話的な実ターミナル（raw mode 対応）が必要です。',
        '  stdin が TTY ではありません（パイプ/リダイレクト、RTK 等のラッパ経由、',
        '  または raw mode 非対応の端末での実行が原因の可能性）。',
        '  → 実ターミナルで直接実行してください（ラッパを挟まず）。',
        '',
      ].join('\n'),
    );
    process.exit(1);
  }
}

export async function startTui(opts: StartTuiOptions): Promise<void> {
  ensureInteractiveTty();

  // CC Hub は Tailscale 証明書で HTTPS を話す。localhost では証明書のホスト名が一致しないため、
  // ローカル接続に限り TLS 検証を無効化する（web の --ignore-certificate-errors 相当）。
  if (isLocalHost(opts.host) && process.env.NODE_TLS_REJECT_UNAUTHORIZED === undefined) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }
  const baseUrl = `https://${opts.host}:${opts.port}`;

  let client: ApiClient;
  try {
    client = await connect(baseUrl);
  } catch (e) {
    const msg = (e as Error).message;
    const status = (e as { status?: number }).status;
    if (status === 401 || msg.includes('トークンを発行できません')) {
      console.error(`\n認証に失敗しました: ${msg}\n`);
    } else {
      console.error(`\n${serverDownHint(baseUrl, msg)}\n`);
    }
    process.exit(1);
  }

  // alt-screen ループ: 一覧 → Enter で入室（alt 退出 → tmux attach 子プロセス → alt 復帰）→ q で終了。
  process.on('exit', () => {
    try {
      process.stdout.write(ALT_OFF);
    } catch {
      // 終了時のベストエフォート
    }
  });
  process.stdout.write(ALT_ON);
  try {
    for (;;) {
      const action = await renderListOnce(client, baseUrl);
      if (action.type === 'quit') break;
      if (action.type === 'attach') {
        process.stdout.write(ALT_OFF);
        attachSession(action.sessionName);
        process.stdout.write(ALT_ON);
      }
    }
  } finally {
    process.stdout.write(ALT_OFF);
  }
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
