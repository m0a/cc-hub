import type { DashboardResponse, UsageCycleInfo } from '../../../shared/types';

/** 1 行ぶんの表示データ。text は ANSI を含まないプレーンテキスト、color は SGR パラメータ（例 '1;36', '32', '2'）。 */
export interface DashRow {
  text: string;
  color?: string;
}

const BAR_WIDTH = 12;
const FETCH_TIMEOUT_MS = 2000;

/**
 * 使用率(0-100)からブロック文字のバーを描画する（幅 BAR_WIDTH）。
 */
function renderBar(utilization: number): string {
  const clamped = Math.max(0, Math.min(100, utilization));
  const filled = Math.round((clamped / 100) * BAR_WIDTH);
  const empty = BAR_WIDTH - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

/**
 * UsageCycleInfo.status を SGR カラーコードにマッピングする。
 */
function statusColor(status: UsageCycleInfo['status']): string {
  if (status === 'warning') return '33';
  if (status === 'danger' || status === 'exceeded') return '31';
  return '32';
}

/**
 * resetsAt (ISO 8601) をローカル時刻表記に変換する。
 * includeDate=true の場合は `M/D HH:MM`、false の場合は `HH:MM`。
 */
function fmtResetTime(resetsAt: string, includeDate: boolean): string {
  const date = new Date(resetsAt);
  if (Number.isNaN(date.getTime())) return resetsAt;
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  if (!includeDate) return `${hh}:${mm}`;
  return `${date.getMonth() + 1}/${date.getDate()} ${hh}:${mm}`;
}

/**
 * 使用サイクル（5h / 7d）を 1 行に整形する。
 */
function fmtCycleRow(label: string, cycle: UsageCycleInfo, includeDate: boolean): DashRow {
  const bar = renderBar(cycle.utilization);
  const pct = Math.round(cycle.utilization);
  const resets = fmtResetTime(cycle.resetsAt, includeDate);
  return {
    text: `${label}  [${bar}] ${pct}%  resets ${resets}`,
    color: statusColor(cycle.status),
  };
}

/**
 * トークン数を k / M 単位に丸めて表示する（1000 未満はそのまま）。
 */
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return `${n}`;
}

/**
 * MB を GB に変換して小数 1 桁で表示する。
 */
function fmtGB(mb: number): string {
  return (mb / 1024).toFixed(1);
}

/**
 * text を width 以内に切り詰める（ASCII 前提、全角幅は考慮しない）。
 */
function truncate(text: string, width: number): string {
  if (width <= 0) return '';
  if (text.length <= width) return text;
  return text.slice(0, width);
}

// CC Hub サーバは Tailscale 証明書の HTTPS で立つ（証明書の CN は ts.net 名なので
// localhost アクセスでは検証を外す。statusline.sh の `curl -sk` と同じ）。
// 証明書が無い環境向けに http へのフォールバックも試す。到達できた base URL と
// 認証トークンはモジュール内にキャッシュする（パネルは 5 秒ごとに再取得するため）。
let cachedBase: string | null = null;
let cachedToken: string | null = null;

/** タイムアウト付き fetch。ネットワーク到達不可は null。 */
async function tryFetch(url: string, token: string | null, init?: RequestInit): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { ...(init?.headers as Record<string, string>) };
    if (token) headers.Authorization = `Bearer ${token}`;
    return await fetch(url, {
      ...init,
      headers,
      signal: controller.signal,
      // Bun 拡張: 自己署名/ホスト名不一致の証明書を許容（localhost への HTTPS 用）。
      tls: { rejectUnauthorized: false },
    } as RequestInit);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** サービスパスワード。env 優先、次に macOS Keychain（`cchub setup` が保存する）。 */
function servicePassword(): string | null {
  if (process.env.CCHUB_PASSWORD) return process.env.CCHUB_PASSWORD;
  try {
    const p = Bun.spawnSync(['security', 'find-generic-password', '-s', 'cchub', '-w'], {
      stdout: 'pipe',
      stderr: 'ignore',
    });
    const s = p.stdout ? new TextDecoder().decode(p.stdout).trim() : '';
    return s || null;
  } catch {
    return null;
  }
}

/** /api/auth/login で JWT トークンを取得。失敗は null。 */
async function login(base: string): Promise<string | null> {
  const pw = servicePassword();
  if (!pw) return null;
  const res = await tryFetch(`${base}/api/auth/login`, null, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: pw }),
  });
  if (!res?.ok) return null;
  try {
    const data = (await res.json()) as { token?: string };
    return data.token || null;
  } catch {
    return null;
  }
}

/** /api/dashboard を取得（base URL 解決・401 時の再ログイン込み）。 */
async function fetchDashboard(): Promise<{ ok: true; data: DashboardResponse } | { ok: false; error: string }> {
  const port = Number(process.env.CCHUB_PORT) || 5923;
  const bases = cachedBase ? [cachedBase] : [`https://127.0.0.1:${port}`, `http://127.0.0.1:${port}`];
  for (const base of bases) {
    let res = await tryFetch(`${base}/api/dashboard`, cachedToken);
    if (!res) continue;
    cachedBase = base;
    if (res.status === 401) {
      const token = await login(base);
      if (!token) return { ok: false, error: 'auth failed (password not found in Keychain)' };
      cachedToken = token;
      res = await tryFetch(`${base}/api/dashboard`, token);
      if (!res) return { ok: false, error: 'server not reachable (start cchub server)' };
      if (res.status === 401) return { ok: false, error: 'auth failed (invalid credentials)' };
    }
    if (!res.ok) return { ok: false, error: `server error (HTTP ${res.status})` };
    try {
      return { ok: true, data: (await res.json()) as DashboardResponse };
    } catch {
      return { ok: false, error: 'server error (invalid response body)' };
    }
  }
  cachedBase = null;
  return { ok: false, error: 'server not reachable (start cchub server)' };
}

/**
 * CC Hub サーバから /api/dashboard を取得し、TUI 表示用の行データに整形する。
 * @param width - 本文の表示幅。各行はこの幅に収まるよう切り詰められる。
 */
export async function fetchDashboardRows(
  width: number
): Promise<{ ok: true; rows: DashRow[] } | { ok: false; error: string }> {
  const fetched = await fetchDashboard();
  if (!fetched.ok) return fetched;
  const data = fetched.data;

  const rows: DashRow[] = [];
  const push = (text: string, color?: string) => {
    rows.push({ text: truncate(text, width), color });
  };

  // 1. claude セクション
  const claudeRows: DashRow[] = [];
  if (data.usageLimits) {
    claudeRows.push(fmtCycleRow('5h ', data.usageLimits.fiveHour, false));
    claudeRows.push(fmtCycleRow('7d ', data.usageLimits.sevenDay, true));
  } else if (data.usageLimitsStatus?.errorReason) {
    claudeRows.push({ text: `(usage unavailable: ${data.usageLimitsStatus.errorReason})`, color: '2' });
  }
  if (claudeRows.length > 0) {
    push('claude', '1;36');
    for (const row of claudeRows) push(row.text, row.color);
  }

  // 2. codex セクション
  const codex = data.codexUsageLimits;
  if (codex && (codex.fiveHour || codex.sevenDay)) {
    push('codex', '1;36');
    if (codex.fiveHour) {
      const row = fmtCycleRow('5h ', codex.fiveHour, false);
      push(row.text, row.color);
    }
    if (codex.sevenDay) {
      const row = fmtCycleRow('7d ', codex.sevenDay, true);
      push(row.text, row.color);
    }
    if (codex.rateLimitExceeded) {
      push('(rate limit exceeded)', '31');
    }
  }

  // 3. 空行
  push('');

  // 4. today セクション
  const today = data.dailyActivity.length > 0 ? data.dailyActivity[data.dailyActivity.length - 1] : undefined;
  if (today) {
    push('today', '1;36');
    push(
      `${today.messageCount} msgs · ${today.sessionCount} sessions · in ${fmtTokens(today.tokensIn)} / out ${fmtTokens(today.tokensOut)} tokens`
    );
  }

  // 5. system セクション
  if (data.systemMetrics) {
    push('system', '1;36');
    const { current, loadAvg } = data.systemMetrics;
    push(
      `cpu ${Math.round(current.cpuPercent)}% · mem ${Math.round(current.memUsedPercent)}% (${fmtGB(current.memUsedMB)}/${fmtGB(current.memTotalMB)}GB) · load ${loadAvg[0].toFixed(2)}`
    );
    if (data.diskUsage) {
      const usedPct = data.diskUsage.total > 0 ? Math.round((data.diskUsage.used / data.diskUsage.total) * 100) : 0;
      const usedGB = Math.round(data.diskUsage.used / 1024 ** 3);
      const totalGB = Math.round(data.diskUsage.total / 1024 ** 3);
      push(`disk ${usedPct}% used (${usedGB}/${totalGB}GB)`);
    }
  }

  // 6. 空行
  push('');

  // 7. フッタ
  const footerParts: string[] = [];
  if (data.version) footerParts.push(`cchub v${data.version}`);
  if (data.connectedClients !== undefined) footerParts.push(`${data.connectedClients} client(s)`);
  if (footerParts.length > 0) {
    push(footerParts.join(' · '), '2');
  }

  return { ok: true, rows };
}
