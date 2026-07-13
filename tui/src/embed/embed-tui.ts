// 自前フルスクリーン TUI（spike）— tmux 直・API 迂回・独自レンダリング。
//
// 方針: tmux は「PTL/端末レンダリングのバックエンド」としてのみ使い、UI は完全自前。
//   - 左 = 自前サイドバー（セッション一覧）
//   - 右 = 選択セッションの実端末を `tmux capture-pane -e -p`（色付き描画済み画面）で貼る
//   - tmux の split-window / switch-client / status-bar / bind は一切使わない
//   - サーバの HTTP/WS API は経由しない（ローカルなので tmux を直接叩くのが最速）
//
// これは read-only spike（表示のみ）。入力転送は次段。
//
// 実行: bun run tui/src/embed/embed-tui.ts   (= bun run dev:tui-embed)

import { readdirSync, readFileSync } from 'node:fs';
import { fetchDashboardRows, type DashRow } from './dashboard';
import { listHistory, resumeCommand, type HistoryEntry } from './history';
import { TmuxCtl } from './tmux-ctl';

const ESC = '\x1b';
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;
const ALT_ON = `${ESC}[?1049h`;
const ALT_OFF = `${ESC}[?1049l`;
// 1000=ボタン, 1002=ボタン押下中のドラッグ(motion)報告, 1006=SGR 拡張。
const MOUSE_ON = `${ESC}[?1000h${ESC}[?1002h${ESC}[?1006h`;
const MOUSE_OFF = `${ESC}[?1000l${ESC}[?1002l${ESC}[?1006l`;
const RESET = `${ESC}[0m`;
const CLEAR = `${ESC}[2J${ESC}[H`;
const CLEAR_EOL = `${ESC}[K`;
const MOUSE_PREFIX = `${ESC}[<`; // SGR マウス列の接頭辞

// 再描画は tmux 制御モードの %output イベント駆動が基本。以下は保険と低頻度更新の間隔。
const MIN_PAINT_MS = 33; // 再描画の最小間隔（~30fps 上限。%output ストームの間引き）
const FALLBACK_REPAINT_MS = 250; // %output 取り逃し用のフォールバック再描画
const SESSIONS_REFRESH_MS = 2000; // セッション一覧（ドット/詳細メタ）の更新間隔
// Synchronized Output (DEC 2026): 対応端末（ghostty/iTerm2/kitty 等）は BSU..ESU の間の
// 書き込みを 1 フレームでアトミックに反映する（未対応端末は単に無視）。
const SYNC_ON = `${ESC}[?2026h`;
const SYNC_OFF = `${ESC}[?2026l`;
const LIST_TOP = 3; // セッション一覧の開始スクリーン行（1=タイトル, 2=アクションボタン, 3〜=一覧）
const WHEEL_MIN_MS = 40; // alt-screen へのホイール転送の最小間隔（慣性フラッド抑制）
const SIDEBAR_MIN = 20;
const SIDEBAR_MAX = 32;
const DASH_REFRESH_MS = 5000; // ダッシュボードパネル表示中の自動更新間隔

const dec = new TextDecoder();
function tmux(args: string[]): string {
  try {
    const p = Bun.spawnSync(['tmux', ...args], { stdout: 'pipe', stderr: 'ignore' });
    return p.stdout ? dec.decode(p.stdout) : '';
  } catch {
    return '';
  }
}

interface Sess {
  name: string;
  activePane: string | null;
  /** サーバが `@cchub_state` に書いたエージェント状態ドット（🟡🔴🔵🟢、無ければ空）。 */
  dot: string;
  /** カスタムタイトル（~/.cc-hub/session-metadata.json 由来、無ければ undefined）。 */
  title?: string;
  /** サーバが `@cchub_*` に書いたリッチ情報（詳細パネル用、無ければ空文字）。 */
  recap: string;
  branch: string;
  tokens: string;
  ctx: string;
}

// カスタムタイトルはサーバが ~/.cc-hub/session-metadata.json に { sessions: { <name>: {title} } }
// で保存している。API を使わずこのローカルファイルを直読みする（2秒キャッシュ）。
let titleCache: { map: Map<string, string>; at: number } | null = null;
function readTitles(): Map<string, string> {
  const now = Date.now();
  if (titleCache && now - titleCache.at < 2000) return titleCache.map;
  const map = new Map<string, string>();
  try {
    const dir = process.env.CC_HUB_DATA_DIR || `${process.env.HOME}/.cc-hub`;
    const data = JSON.parse(readFileSync(`${dir}/session-metadata.json`, 'utf-8'));
    for (const [name, m] of Object.entries(data?.sessions ?? {})) {
      const title = (m as { title?: unknown })?.title;
      if (typeof title === 'string' && title.trim()) map.set(name, title);
    }
  } catch {
    // ファイルが無い / 壊れている場合は空（名前フォールバック）
  }
  titleCache = { map, at: now };
  return map;
}

// embed-tui 自身が動いているセッション。これを capture すると「画面の中に画面」の
// 無限ネスト（自己参照再帰）になるので、一覧から必ず除外する。
let SELF_SESSION = '';
function detectSelfSession(): string {
  const pane = process.env.TMUX_PANE;
  if (!pane) return '';
  return tmux(['display-message', '-p', '-t', pane, '#{session_name}']).trim();
}

function listSessions(): Sess[] {
  // 名前 + 状態ドット + リッチ情報(@cchub_*) を一発で取得（tab 区切り）。
  // recap/branch/tokens/ctx はサーバがサニタイズ済み（tab/改行を含まない）。
  const raw = tmux([
    'list-sessions',
    '-F',
    '#{session_name}\t#{@cchub_state}\t#{@cchub_recap}\t#{@cchub_branch}\t#{@cchub_tokens}\t#{@cchub_ctx}',
  ]);
  const titles = readTitles();
  return raw
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const [name, dot = '', recap = '', branch = '', tokens = '', ctx = ''] = line.split('\t');
      return { name, activePane: null, dot, title: titles.get(name), recap, branch, tokens, ctx };
    })
    .filter((s) => s.name && s.name !== SELF_SESSION);
}

function activePaneOf(name: string): string | null {
  const raw = tmux(['list-panes', '-t', name, '-F', '#{pane_active} #{pane_id}']);
  for (const line of raw.split('\n')) {
    const [active, id] = line.trim().split(' ');
    if (active === '1' && id) return id;
  }
  return null;
}

/** pane を capture。offset>0 で tmux 履歴を上へ遡って height 行ぶんの窓を返す。 */
function capture(pane: string, offset: number, height: number): string[] {
  if (offset <= 0) return tmux(['capture-pane', '-e', '-p', '-t', pane]).split('\n');
  const start = -offset;
  const end = height - 1 - offset;
  return tmux(['capture-pane', '-e', '-p', '-t', pane, '-S', String(start), '-E', String(end)]).split('\n');
}

/** pane が代替スクリーン（Claude Code / vim 等）か。true ならスクロールはアプリ側に任せる。 */
function isAltScreen(pane: string): boolean {
  return tmux(['display-message', '-p', '-t', pane, '#{alternate_on}']).trim() === '1';
}

// ANSI エスケープを除いた「見た目が空行」判定（制御文字リテラルは biome が禁止するので構築）。
const ANSI_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;:]*[A-Za-z]`, 'g');
function isBlankLine(l: string): boolean {
  return l.replace(ANSI_RE, '').trim() === '';
}

/**
 * padFill（web UI の PaneViewport と同じ考え方）: normal-screen の Claude Code は
 * カーソル周辺しか描かないため、pane の大半が未描画の空白（void）になる。
 * カーソル行より下の空白を刈り、足りない分をスクロールバックで上に継ぎ足して
 * 画面を埋める。カーソル y は継ぎ足した行数ぶん下へシフトする。
 */
async function padFill(
  live: string[],
  cursorY: number,
  rows: number,
  fetchHist: (n: number) => Promise<string[]>,
): Promise<{ lines: string[]; cursorY: number }> {
  let kept = Math.min(live.length, rows);
  while (kept > 0 && kept - 1 > cursorY && isBlankLine(live[kept - 1])) kept--;
  const prepend = Math.max(0, rows - kept);
  if (prepend === 0) return { lines: live, cursorY };
  const hist = await fetchHist(prepend);
  const tail = hist.slice(-prepend);
  const padTop = prepend - tail.length;
  const blanks: string[] = new Array(Math.max(0, padTop)).fill('');
  return { lines: [...blanks, ...tail, ...live.slice(0, kept)], cursorY: cursorY + prepend };
}

/** 生の入力バイトを hex 化して pane へ送る（エスケープ列・制御文字も忠実に転送できる）。 */
function sendKeysHex(pane: string, data: string): void {
  const bytes = Array.from(Buffer.from(data, 'utf8')).map((b) => b.toString(16).padStart(2, '0'));
  if (bytes.length) tmux(['send-keys', '-H', '-t', pane, ...bytes]);
}

/** pane のカーソル位置（0-based）。自前領域にカーソルを合わせるために使う。 */
function paneCursor(pane: string): { x: number; y: number } | null {
  const raw = tmux(['display-message', '-p', '-t', pane, '#{cursor_x} #{cursor_y}']).trim();
  const [x, y] = raw.split(' ').map((n) => Number.parseInt(n, 10));
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

// --- セッション作成（tmux 直・API 迂回）。サーバの createSession と同じ手順を踏む。 ---
const AGENT_CMD: Record<string, string> = { claude: 'claude', codex: 'codex' };

function shellQuote(v: string): string {
  return `'${v.replace(/'/g, `'\\''`)}'`;
}
function expandHome(v: string): string {
  const home = process.env.HOME ?? '';
  if (v === '~') return home;
  if (v.startsWith('~/')) return `${home}${v.slice(1)}`;
  return v;
}
function sessionExists(name: string): boolean {
  try {
    return Bun.spawnSync(['tmux', 'has-session', '-t', name], { stdout: 'ignore', stderr: 'ignore' }).exitCode === 0;
  } catch {
    return false;
  }
}
/** 一意なセッション名を作る（dir の basename ベース、衝突時は -N）。 */
function uniqueSessionName(dir: string): string {
  const base = (dir.split('/').filter(Boolean).pop() || 'session').replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 24) || 'session';
  if (!sessionExists(base)) return base;
  let i = 2;
  while (sessionExists(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}
/** ディレクトリ配下のサブディレクトリ名（隠しを除く、先頭に ".."）。file browser 用。 */
function listDirs(dir: string): string[] {
  try {
    const items = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b));
    return ['..', ...items];
  } catch {
    return ['..'];
  }
}
function parentDir(p: string): string {
  const s = p.replace(/\/+$/, '');
  const i = s.lastIndexOf('/');
  return i <= 0 ? '/' : s.slice(0, i);
}
function childDir(p: string, name: string): string {
  return `${p.replace(/\/+$/, '')}/${name}`;
}

/** セッションを閉じる（kill）。 */
function killSessionByName(name: string): void {
  tmux(['kill-session', '-t', name]);
}

/** サーバ createSession 相当: 空シェルで new-session → config source → `cd <dir> && <agent>` を送る。 */
function createTmuxSession(name: string, dir: string, agent: string): void {
  tmux(['new-session', '-d', '-s', name]);
  const conf = `${process.env.HOME}/.config/cchub/tmux.conf`;
  tmux(['source-file', conf]); // best-effort（無ければ無視される）
  const cmd = `cd ${shellQuote(expandHome(dir))} && ${AGENT_CMD[agent] ?? 'claude'}`;
  tmux(['send-keys', '-t', name, cmd, 'Enter']);
}

function moveTo(row: number, col: number): string {
  return `${ESC}[${row};${col}H`;
}

/** 表示幅ベースで width 桁ごとに折り返す（日本語=空白なしでも文字単位で改行）。maxLines で打ち切り。 */
function wrapByWidth(text: string, width: number, maxLines: number): string[] {
  if (width < 2) return [];
  const lines: string[] = [];
  let cur = '';
  let curW = 0;
  for (const ch of text) {
    const w = (ch.codePointAt(0) ?? 0) > 0x2000 ? 2 : 1;
    if (curW + w > width) {
      lines.push(cur);
      if (lines.length >= maxLines) return lines;
      cur = ch;
      curW = w;
    } else {
      cur += ch;
      curW += w;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  return lines;
}

function displayWidth(text: string): number {
  let w = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    // 罫線・ブロック要素（U+2500–259F: │ ─ █ ░ 等）は曖昧幅だが端末では 1 桁描画が普通。
    w += cp > 0x2000 && !(cp >= 0x2500 && cp <= 0x259f) ? 2 : 1;
  }
  return w;
}

/** tmux pane のジオメトリ（ウィンドウ座標、0-based）。 */
interface PaneRect {
  id: string;
  active: boolean;
  left: number;
  top: number;
  w: number;
  h: number;
}

/**
 * 複数 pane の 1 スクリーン行を、絶対位置指定の書き込み列として合成する。
 * capture 行は行末の空白が刈られていて見た目幅が pane 幅に満たないことがあるため、
 * 幅計算（wcwidth の曖昧幅問題）に頼らず「pane 幅ぶん空白で消してから内容を重ね書き」する。
 * どの pane にも属さないセルは区切り線（幅 1 の隙間は │、それ以外は ─）。
 */
function composePaneRow(
  views: Array<{ p: PaneRect; lines: string[] }>,
  r: number,
  termLeft: number,
  termW: number,
): string {
  const segs = views.filter((v) => r >= v.p.top && r < v.p.top + v.p.h).sort((a, b) => a.p.left - b.p.left);
  const sep = (col: number, n: number) =>
    moveTo(r + 1, termLeft + col) + `${ESC}[90m${n === 1 ? '│' : '─'.repeat(n)}${RESET}`;
  let out = '';
  let col = 0;
  for (const v of segs) {
    if (v.p.left > col) out += sep(col, v.p.left - col);
    const line = v.lines[r - v.p.top] ?? '';
    out +=
      moveTo(r + 1, termLeft + v.p.left) +
      ' '.repeat(v.p.w) +
      moveTo(r + 1, termLeft + v.p.left) +
      RESET +
      line +
      RESET;
    col = v.p.left + v.p.w;
  }
  if (col < termW) out += sep(col, termW - col);
  return out;
}

function truncateDisplay(text: string, max: number): string {
  if (max <= 1) return '';
  let width = 0;
  let out = '';
  for (const ch of text) {
    const w = (ch.codePointAt(0) ?? 0) > 0x2000 ? 2 : 1;
    if (width + w > max) break;
    width += w;
    out += ch;
  }
  return out;
}

async function main() {
  const stdin = process.stdin;
  const stdout = process.stdout;
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    console.error('実ターミナル（raw mode）で実行してください。');
    process.exit(1);
  }

  // 自分のセッションを特定して一覧から除外（自己参照再帰の防止）。
  SELF_SESSION = detectSelfSession();

  let sessions = listSessions();
  let selected = 0;
  // フォーカス: sidebar=一覧操作 / terminal=打鍵を選択 pane へ転送。
  let focus: 'sidebar' | 'terminal' = 'sidebar';
  // 新規作成フォーム（file browser。開いている間は右領域にオーバーレイ表示）。
  let creating: {
    dir: string; // 現在ブラウズ中のディレクトリ（絶対パス）
    entries: string[]; // サブディレクトリ（先頭に ".."）
    sel: number; // 選択中エントリ
    agent: 'claude' | 'codex';
  } | null = null;
  // 履歴から復帰パネル（開いている間は右領域にオーバーレイ表示）。
  let history: { entries: HistoryEntry[]; sel: number } | null = null;
  // ダッシュボードパネル（開いている間は右領域にオーバーレイ表示。データはサーバ API から）。
  let dash: { rows: DashRow[] | null; error: string | null } | null = null;
  let dashFetchedAt = 0;
  // サイドバー幅の手動上書き（null=自動）。[ / ] で調整。
  let sidebarWidth: number | null = null;
  // 通常スクリーンの履歴スクロール量（0=ライブ）。alt-screen ではアプリ側に任せる。
  let scrollOffset = 0;
  // 区切り線ドラッグによる幅調整の進行フラグ。
  let dragging = false;
  // alt-screen へホイールを最後に転送した時刻（レート制限用）。
  let lastWheelForward = 0;
  // サイドバーのクリック可能ボタンの x 範囲（renderSidebar で更新、クリック判定で参照）。
  const actionBtns = {
    newBtn: [0, -1] as [number, number],
    histBtn: [0, -1] as [number, number],
    dashBtn: [0, -1] as [number, number],
  };
  // 一覧の最終スクリーン行（詳細パネルぶん減る）。クリック判定で「詳細/フッタ領域は選択しない」ために参照。
  let listBottomRow = 0;
  // 右クリックのコンテキストメニュー（開いている間は最前面に描画）。
  // kind: session=サイドバー行（セッション操作）/ pane=端末領域（pane 分割・クローズ）。
  let menu: {
    kind: 'session' | 'pane';
    target: string;
    title: string;
    items: string[];
    sel: number;
    mx: number;
    my: number;
    w: number;
  } | null = null;
  const resized = new Set<string>();
  let done = false;

  // --- 常駐 tmux 制御クライアント（高速化の核）---
  // 毎フレーム tmux を fork する（macOS で 1 回 5〜20ms）代わりに、1 本の `tmux -C attach`
  // にコマンドをパイプで流し（サブ ms）、%output をダーティ通知として受けて必要な時だけ
  // 再描画する。選択セッションの変更は switch-client で追従。切断時は spawn 経路へ fallback。
  let ctl: TmuxCtl | null = null;
  let ctlSession = '';

  // 選択セッションの pane ジオメトリ（直近の paint で取得）。クリック→pane 解決と
  // %output → 再描画判定に使う。セッション切替時にリセット。
  let paneRects: PaneRect[] = [];
  let paneIds = new Set<string>();

  function ensureCtl(name: string | undefined) {
    if (!name) return;
    if (ctl && !ctl.closed) {
      if (ctlSession !== name) {
        ctlSession = name;
        void ctl.exec(`switch-client -t ${name}`);
      }
      return;
    }
    ctlSession = name;
    const c = new TmuxCtl(name);
    c.onOutput = (paneId) => {
      if (paneIds.has(paneId) || sessions[selected]?.activePane === paneId) renderTerminal();
    };
    c.onExit = () => {
      if (ctl === c) ctl = null; // 以後は spawn fallback（次の選択/ティックで再接続）
    };
    ctl = c;
    // 制御クライアントの申告サイズで window が縮まないよう、右領域サイズを申告しておく。
    const { rows, termW } = layout();
    void c.exec(`refresh-client -C ${Math.max(20, termW)}x${Math.max(5, rows)}`);
  }

  /** 入力転送（可能なら制御クライアント経由 = fork なし）。 */
  function sendInput(pane: string, data: string) {
    if (ctl && !ctl.closed) {
      const bytes = Array.from(Buffer.from(data, 'utf8')).map((b) => b.toString(16).padStart(2, '0'));
      if (bytes.length) void ctl.exec(`send-keys -H -t ${pane} ${bytes.join(' ')}`);
    } else {
      sendKeysHex(pane, data);
    }
  }

  const write = (s: string) => {
    try {
      // Synchronized Output で包む: 対応端末は途中状態を描かず 1 フレームで反映（ティアリング防止）。
      if (process.env.CCHUB_TUI_NOSYNC) stdout.write(s);
      else stdout.write(SYNC_ON + s + SYNC_OFF);
    } catch {
      // best-effort
    }
  };

  function layout() {
    const cols = stdout.columns || 100;
    const rows = stdout.rows || 30;
    const auto = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, Math.floor(cols * 0.25)));
    // 手動幅は 12..cols-20 にクランプ（端末領域が潰れないように）。
    const sidebarW = sidebarWidth === null ? auto : Math.max(12, Math.min(cols - 20, sidebarWidth));
    const termLeft = sidebarW + 2; // 1-based。sidebarW+1 は区切り線
    const termW = cols - sidebarW - 1;
    return { cols, rows, sidebarW, termLeft, termW };
  }

  /** 選択セッションのウィンドウを右領域サイズに合わせる（capture がその寸法で返るように）。 */
  function fitSelected() {
    const s = sessions[selected];
    if (!s) return;
    const { rows, termW } = layout();
    const w = String(Math.max(20, termW));
    const h = String(Math.max(5, rows));
    if (ctl && !ctl.closed) {
      void ctl.exec(`set-option -t ${s.name} window-size manual`);
      void ctl.exec(`resize-window -t ${s.name} -x ${w} -y ${h}`);
    } else {
      tmux(['set-option', '-t', s.name, 'window-size', 'manual']);
      tmux(['resize-window', '-t', s.name, '-x', w, '-y', h]);
    }
    resized.add(s.name);
  }

  function renderSidebar() {
    const { rows, sidebarW } = layout();
    const sidebarActive = focus === 'sidebar';
    let out = '';
    // 重要: サイドバーの行は CLEAR_EOL（行末まで消去）を使わない。行末まで消すと右の
    // 端末領域まで白紙化し、差分描画キャッシュは「変化なし」と思って再描画しないため
    // 画面が消えたままになる。かわりにサイドバー幅ちょうどまで空白でパディングする。
    const pad = (plainWidth: number) => ' '.repeat(Math.max(0, sidebarW - plainWidth));
    // タイトル: フォーカス中は明るい cyan＋◀ 印、非フォーカスは暗く。
    const title = truncateDisplay(sidebarActive ? '≡ sessions ◀' : '≡ sessions', sidebarW);
    const titleStyle = sidebarActive ? '1;36' : '2';
    out += moveTo(1, 1) + `${ESC}[${titleStyle}m${title}${RESET}` + pad(displayWidth(title));
    // アクションボタン行（クリック可能）: [ +new ] [ hist ] [ dash ]。x 範囲を記録して当たり判定に使う。
    const newLabel = ' +new ';
    const histLabel = ' hist ';
    const dashLabel = ' dash ';
    const wNew = displayWidth(newLabel);
    const wHist = displayWidth(histLabel);
    const wDash = displayWidth(dashLabel);
    actionBtns.newBtn = [1, wNew];
    actionBtns.histBtn = [wNew + 2, wNew + 1 + wHist];
    actionBtns.dashBtn = [wNew + wHist + 3, wNew + wHist + 2 + wDash];
    out +=
      `${moveTo(2, 1)}${ESC}[7;36m${newLabel}${RESET} ${ESC}[7;35m${histLabel}${RESET} ${ESC}[7;34m${dashLabel}${RESET}` +
      pad(wNew + wHist + wDash + 2);

    // 詳細パネル: 選択セッションの recap（複数行折り返し）/ branch·tokens·ctx を
    // 一覧の「直下」に表示する（最下部固定だと間に空白が空いて遠すぎるため）。
    // 一覧に最低2行を残しつつ、区切り + recap 最大4行 + meta を割り当てる。
    const sel = sessions[selected];
    const hasData = !!sel && !!(sel.recap || sel.branch || sel.tokens || sel.ctx);
    const region = rows - LIST_TOP; // 一覧+詳細に使える行数（screen rows LIST_TOP..rows-1）
    let recapLines = 0;
    let detailHeight = 0;
    if (hasData && region - Math.min(sessions.length, 2) >= 3) {
      // 一覧が長い場合は一覧側を削る（最低2行は残す）。
      const maxDetail = region - Math.min(sessions.length, Math.max(2, region - 3));
      const budget = Math.max(3, Math.min(6, region - Math.min(sessions.length, region - 3)));
      recapLines = Math.max(1, Math.min(4, budget - 2)); // 区切り + meta = 2
      detailHeight = recapLines + 2;
      void maxDetail;
    }
    // 一覧の表示可能行数（詳細とフッタを差し引く）。
    const visibleSessions = Math.min(sessions.length, region - detailHeight);
    const lastListRow = LIST_TOP + visibleSessions - 1;
    listBottomRow = lastListRow; // クリック判定用（実在する行まで）

    sessions.forEach((s, i) => {
      const row = i + LIST_TOP;
      if (row > lastListRow) return;
      const marker = i === selected ? '▸ ' : '  ';
      const dot = s.dot ? `${s.dot} ` : '· ';
      const label = truncateDisplay(marker + dot + (s.title || s.name), sidebarW);
      out += moveTo(row, 1);
      // 選択行: サイドバーフォーカス中は cyan 反転、そうでなければ通常反転（暗め）。
      if (i === selected) out += `${ESC}[7${sidebarActive ? ';36' : ''}m${label}${RESET}`;
      else out += label;
      out += pad(displayWidth(label));
    });

    // 詳細パネル（一覧の直下）。
    let cursorRow = lastListRow + 1;
    if (detailHeight > 0 && sel) {
      const rule = truncateDisplay(`─ detail ${'─'.repeat(Math.max(0, sidebarW - 5))}`, sidebarW);
      out += `${moveTo(cursorRow++, 1)}${ESC}[90m${rule}${RESET}` + pad(displayWidth(rule));
      const recapWrapped = sel.recap ? wrapByWidth(sel.recap, sidebarW, recapLines) : ['—'];
      for (let i = 0; i < recapLines; i++) {
        const t = recapWrapped[i] ?? '';
        out += `${moveTo(cursorRow++, 1)}${ESC}[37m${t}${RESET}` + pad(displayWidth(t));
      }
      const metaParts: string[] = [];
      if (sel.branch) metaParts.push(`⎇ ${sel.branch}`);
      if (sel.tokens) metaParts.push(sel.tokens);
      if (sel.ctx) metaParts.push(`ctx ${sel.ctx}%`);
      const metaText = truncateDisplay(metaParts.join('  '), sidebarW);
      out += `${moveTo(cursorRow++, 1)}${ESC}[36m${metaText}${RESET}` + pad(displayWidth(metaText));
    }
    // 残りの余白行をフッタ手前まで空白で塗る（CLEAR_EOL は右領域を消すので使わない）。
    for (let r = cursorRow; r <= rows - 1; r++) out += moveTo(r, 1) + pad(0);
    // 区切り線: フォーカスのある側を cyan、無い側は暗いグレー。
    const sepColor = sidebarActive ? '90' : '36';
    for (let r = 1; r <= rows; r++) out += moveTo(r, sidebarW + 1) + `${ESC}[${sepColor}m│${RESET}`;
    // フッタ: モードバッジ（反転）＋ヒント。
    const badge = sidebarActive ? `${ESC}[7;36m LIST ${RESET}` : `${ESC}[7;33m TERM ${RESET}`;
    const hint = truncateDisplay(sidebarActive ? ' ↑↓ Enter n H D [] q' : ' Ctrl-B: back to list', Math.max(0, sidebarW - 6));
    out += moveTo(rows, 1) + badge + `${ESC}[2m${hint}${RESET}` + pad(6 + displayWidth(hint));
    // 端末フォーカス中は、サイドバー描画で動いたカーソルを pane の位置へ戻す
    // （戻さないと 2 秒ごとの一覧更新のたびにカーソルが左へ飛んでちらつく）。
    if (focus === 'terminal' && lastCurKey && lastCurKey !== 'hidden') {
      const [cx, cy] = lastCurKey.split(',').map((n) => Number.parseInt(n, 10));
      if (Number.isFinite(cx) && Number.isFinite(cy)) out += moveTo(cy + 1, sidebarW + 2 + cx);
    }
    write(out);
  }

  // --- 端末領域の再描画（イベント駆動・非同期・差分・レート制限）---
  // renderTerminal() はトリガ。実描画は paintTerminal()（ctl 経由なら fork なし）。
  // 点滅防止:
  //   1. 前回描画した行をキャッシュし、変わった行だけ書く（無変化なら 0 バイト）
  //   2. 描画は最大 ~30fps に間引く（%output はストリーミング中に毎秒何十回も飛ぶ）
  //   3. write() を Synchronized Output (DEC 2026) で包み、対応端末では描画をアトミックに
  let paintCache: string[] | null = null;
  let paintGeom = '';
  let lastCurKey = '';
  let painting = false;
  let pendingPaint = false;
  let paintTimer: ReturnType<typeof setTimeout> | null = null;
  let lastPaintAt = 0;

  /** 端末領域のキャッシュを無効化（オーバーレイ表示や画面クリアで内容が壊れた時に呼ぶ）。 */
  function invalidatePaint() {
    paintCache = null;
    lastCurKey = '';
  }

  function renderTerminal() {
    if (painting) {
      pendingPaint = true;
      return;
    }
    if (paintTimer) return; // 既にスケジュール済み
    const since = Date.now() - lastPaintAt;
    const delay = since >= MIN_PAINT_MS ? 0 : MIN_PAINT_MS - since;
    paintTimer = setTimeout(() => {
      paintTimer = null;
      painting = true;
      lastPaintAt = Date.now();
      void paintTerminal().finally(() => {
        painting = false;
        if (pendingPaint) {
          pendingPaint = false;
          renderTerminal(); // レート制限を通して次を予約
        }
      });
    }, delay);
  }

  /** セッションの pane 一覧（ジオメトリ付き）。可能なら制御クライアント経由。 */
  async function fetchPanes(name: string): Promise<PaneRect[]> {
    const FMT = '#{pane_id},#{pane_active},#{pane_left},#{pane_top},#{pane_width},#{pane_height}';
    let raw: string[];
    if (ctl && !ctl.closed) {
      raw = await ctl.exec(`list-panes -t ${name} -F '${FMT}'`);
      // 空応答 = 切断中（fetchPaneView と同じ理由）。spawn へフォールバック。
      if (raw.length === 0) raw = tmux(['list-panes', '-t', name, '-F', FMT]).split('\n');
    } else {
      raw = tmux(['list-panes', '-t', name, '-F', FMT]).split('\n');
    }
    const out: PaneRect[] = [];
    for (const line of raw) {
      const [id, active, left, top, w, h] = line.trim().split(',');
      if (!id?.startsWith('%')) continue;
      out.push({
        id,
        active: active === '1',
        left: Number.parseInt(left, 10) || 0,
        top: Number.parseInt(top, 10) || 0,
        w: Number.parseInt(w, 10) || 1,
        h: Number.parseInt(h, 10) || 1,
      });
    }
    return out;
  }

  /** スクリーン座標 (x,y) が乗っている pane（直近 paint のジオメトリで解決）。 */
  function paneAt(x: number, y: number): PaneRect | null {
    const { termLeft } = layout();
    const wx = x - termLeft;
    const wy = y - 1;
    for (const p of paneRects) {
      if (wx >= p.left && wx < p.left + p.w && wy >= p.top && wy < p.top + p.h) return p;
    }
    return null;
  }

  /** pane をアクティブにする（クリックフォーカス）。 */
  function focusPane(p: PaneRect) {
    const s = sessions[selected];
    if (!s || s.activePane === p.id) return;
    if (ctl && !ctl.closed) void ctl.exec(`select-pane -t ${p.id}`);
    else tmux(['select-pane', '-t', p.id]);
    s.activePane = p.id;
    scrollOffset = 0;
    renderTerminal();
  }

  /** pane の alt/カーソル/画面内容を取得（可能なら常駐制御クライアント経由 = fork なし）。 */
  async function fetchPaneView(
    pane: string,
    rows: number,
    offset: number,
  ): Promise<{ cur: { x: number; y: number } | null; lines: string[] }> {
    if (ctl && !ctl.closed) {
      // 注意: 制御モードのコマンド行では未クオートの `#` がコメント扱いになるため、
      // フォーマットは必ずシングルクオートで包む。
      const c = ctl;
      const meta = await c.exec(`display-message -p -t ${pane} '#{alternate_on},#{cursor_x},#{cursor_y}'`);
      const [altS = '', xS = '', yS = ''] = (meta[0] ?? '').split(',');
      const x = Number.parseInt(xS, 10);
      const y = Number.parseInt(yS, 10);
      const alt = altS === '1';
      const off = alt ? 0 : offset;
      const cmd =
        off <= 0
          ? `capture-pane -e -p -t ${pane}`
          : `capture-pane -e -p -t ${pane} -S -${off} -E ${rows - 1 - off}`;
      const lines = await c.exec(cmd);
      // 空応答 = 切断（markClosed が未応答を [] で解決する）や失敗。実在 pane の capture が
      // 0 行になることはない（空画面でも空文字の行が返る）ので、ここでブランクを描かず
      // 下の spawn 経路へフォールバックする（切断中の「画面が消える」を防ぐ）。
      if (lines.length > 0) {
        const okCur = Number.isFinite(x) && Number.isFinite(y);
        if (!alt && off === 0 && okCur) {
          // normal-screen（Claude Code 等）は void をスクロールバックで埋める。
          const filled = await padFill(lines, y, rows, (n) =>
            c.exec(`capture-pane -e -p -t ${pane} -S -${n} -E -1`),
          );
          return { cur: { x, y: filled.cursorY }, lines: filled.lines };
        }
        return { cur: okCur ? { x, y } : null, lines };
      }
    }
    // fallback: 使い捨て spawn（制御クライアント切断時）。
    const alt = isAltScreen(pane);
    const off = alt ? 0 : offset;
    const lines = capture(pane, off, rows);
    const cur = paneCursor(pane);
    if (!alt && off === 0 && cur) {
      const filled = await padFill(lines, cur.y, rows, (n) =>
        Promise.resolve(tmux(['capture-pane', '-e', '-p', '-t', pane, '-S', `-${n}`, '-E', '-1']).split('\n')),
      );
      return { cur: { x: cur.x, y: filled.cursorY }, lines: filled.lines };
    }
    return { cur, lines };
  }

  async function paintTerminal(): Promise<void> {
    if (done || creating || history || dash) return; // オーバーレイ表示中は上書きしない
    const { rows, termLeft, termW } = layout();
    const s = sessions[selected];
    let lines: string[] = [];
    let cur: { x: number; y: number } | null = null;
    let multi = false; // 複数 pane 合成モード（行内に絶対位置指定を含むので CLEAR_EOL を付けない）
    if (s) {
      const panes = await fetchPanes(s.name);
      if (panes.length > 0) {
        paneRects = panes;
        paneIds = new Set(panes.map((p) => p.id));
        const act = panes.find((p) => p.active) ?? panes[0];
        s.activePane = act.id;
        if (panes.length === 1) {
          ({ cur, lines } = await fetchPaneView(act.id, rows, scrollOffset));
        } else {
          // 複数 pane: 各 pane を個別に取得し、ジオメトリ通りに 1 画面へ合成する。
          // 履歴スクロールはアクティブ pane のみ。
          multi = true;
          const views = await Promise.all(
            panes.map(async (p) => ({
              p,
              v: await fetchPaneView(p.id, p.h, p.active ? scrollOffset : 0),
            })),
          );
          const flat = views.map((x) => ({ p: x.p, lines: x.v.lines }));
          lines = [];
          for (let r = 0; r < rows; r++) lines.push(composePaneRow(flat, r, termLeft, termW));
          const av = views.find((x) => x.p.active);
          if (av?.v.cur) cur = { x: av.v.cur.x + av.p.left, y: av.v.cur.y + av.p.top };
        }
      }
    } else if (sessions.length === 0) {
      lines = ['', '  no other sessions', '  (this session is hidden to avoid recursion)'];
    }
    if (done || creating || history || dash) return; // await 中にオーバーレイが開いたら破棄

    // 差分描画: 変わった行だけ書く（全行書き直しは点滅の原因）。
    const clipped: string[] = [];
    for (let r = 0; r < rows; r++) {
      const line = lines[r] ?? '';
      // 領域幅にクリップ（エスケープ込みなのでざっくり文字数で）。合成行は位置指定込みで
      // 幅が構造上保証されているのでクリップしない（途中で切るとエスケープが壊れる）。
      clipped.push(!multi && line.length > termW * 2 ? line.slice(0, termW * 2) : line);
    }
    const geom = `${termLeft}:${termW}:${rows}:${multi ? 'm' : 's'}`;
    const full = paintCache === null || paintGeom !== geom;
    let out = '';
    for (let r = 0; r < rows; r++) {
      if (full || paintCache?.[r] !== clipped[r]) {
        // 合成行は絶対位置指定＋pane 幅ぶんの空白消去を内包するので、そのまま書く。
        if (multi) out += clipped[r];
        else out += moveTo(r + 1, termLeft) + RESET + clipped[r] + RESET + CLEAR_EOL;
      }
    }
    paintCache = clipped;
    paintGeom = geom;

    // カーソル: 端末フォーカス中は pane の位置に表示。
    // 重要: 毎フレーム HIDE→SHOW を繰り返すとカーソルがちらつくので、
    // 可視性(DECTCEM)の切替は「状態が変わる時だけ」発行し、位置移動は毎回最後に行う。
    // 書き込み途中のカーソル移動は Synchronized Output が隠す。
    const showCur = focus === 'terminal' && !!s?.activePane && !!cur && cur.y < rows;
    const curKey = showCur && cur ? `${cur.x},${cur.y}` : 'hidden';
    if (out || curKey !== lastCurKey) {
      const wasHidden = lastCurKey === 'hidden';
      const unknown = lastCurKey === ''; // invalidate 直後は状態不明 → 必ず適用
      if (showCur && cur) {
        out += moveTo(cur.y + 1, termLeft + cur.x);
        if (wasHidden || unknown) out += SHOW_CURSOR;
      } else if (!wasHidden || unknown) {
        out += HIDE_CURSOR;
      }
      write(out);
      lastCurKey = curKey;
    }
    if (menu) renderMenu(); // メニューは最前面に重ねる
  }

  function openCreate() {
    const dir = process.env.HOME || '/';
    creating = { dir, entries: listDirs(dir), sel: 0, agent: 'claude' };
    renderCreate();
  }

  function openHistory() {
    history = { entries: listHistory(50), sel: 0 };
    renderHistory();
  }

  function openDashboard() {
    dash = { rows: null, error: null };
    renderDash();
    void refreshDash();
  }

  /** サーバ (/api/dashboard) からダッシュボードを取得して再描画。開いている間は定期更新。 */
  async function refreshDash() {
    if (!dash) return;
    const { termW } = layout();
    const res = await fetchDashboardRows(Math.max(20, termW - 4));
    if (!dash || done) return; // await 中に閉じられたら破棄
    dashFetchedAt = Date.now();
    dash = res.ok ? { rows: res.rows, error: null } : { rows: null, error: res.error };
    renderDash();
  }

  function renderDash() {
    if (!dash) return;
    invalidatePaint(); // 右領域を上書きするので閉じた後は全再描画
    const d = dash;
    const { rows, termLeft, termW } = layout();
    const W = Math.max(24, termW);
    const inner = W - 2; // 枠の内側幅
    const B = (s: string) => `${ESC}[36m${s}${RESET}`; // 枠は cyan
    let out = HIDE_CURSOR;
    for (let r = 1; r <= rows; r++) out += moveTo(r, termLeft) + RESET + CLEAR_EOL;

    const put = (r: number, s: string) => {
      out += moveTo(r, termLeft) + s;
    };
    const bodyRow = (text: string, color?: string) => {
      const t = truncateDisplay(text, inner - 1);
      const padded = ` ${t}${' '.repeat(Math.max(0, inner - 1 - displayWidth(t)))}`;
      const body = color ? `${ESC}[${color}m${padded}${RESET}` : padded;
      return B('│') + body + B('│');
    };
    const sep = (l: string, r: string) => B(l + '─'.repeat(inner) + r);

    const title = ' dashboard ';
    put(1, B(`┌─${title}${'─'.repeat(Math.max(0, inner - displayWidth(title) - 1))}┐`));
    put(2, sep('├', '┤'));

    const bodyTop = 3;
    const bodyRows = Math.max(1, rows - 5);
    const content: DashRow[] =
      d.rows ?? [{ text: d.error ? `⚠ ${d.error}` : 'loading…', color: d.error ? '31' : '2' }];
    for (let i = 0; i < bodyRows; i++) {
      const row = content[i];
      put(bodyTop + i, row ? bodyRow(row.text, row.color) : bodyRow(''));
    }

    put(rows - 2, sep('├', '┤'));
    put(rows - 1, bodyRow('r: refresh · Esc: close', '2'));
    put(rows, sep('└', '┘'));
    write(out);
  }

  function renderCreate() {
    if (!creating) return;
    invalidatePaint(); // 右領域を上書きするので閉じた後は全再描画
    const c = creating;
    const { rows, termLeft, termW } = layout();
    const W = Math.max(24, termW);
    const inner = W - 2; // 枠の内側幅
    const B = (s: string) => `${ESC}[36m${s}${RESET}`; // 枠は cyan
    let out = HIDE_CURSOR;
    for (let r = 1; r <= rows; r++) out += moveTo(r, termLeft) + RESET + CLEAR_EOL;

    const put = (r: number, s: string) => {
      out += moveTo(r, termLeft) + s;
    };
    // 内側 inner 幅にパディングした本文行（色は幅に影響しないよう外側で巻く）。
    const bodyRow = (text: string, opts: { selected?: boolean; color?: string } = {}) => {
      const t = truncateDisplay(text, inner - 1);
      const padded = ` ${t}${' '.repeat(Math.max(0, inner - 1 - displayWidth(t)))}`;
      let body = padded;
      if (opts.color) body = `${ESC}[${opts.color}m${body}${RESET}`;
      if (opts.selected) body = `${ESC}[7;36m${padded}${RESET}`;
      return B('│') + body + B('│');
    };
    const sep = (l: string, r: string) => B(l + '─'.repeat(inner) + r);

    // 上枠＋タイトル、パスバー、区切り。
    const title = ' new session ';
    put(1, B(`┌─${title}${'─'.repeat(Math.max(0, inner - displayWidth(title) - 1))}┐`));
    put(2, bodyRow(`📂 ${c.dir}`, { color: '1;36' }));
    put(3, sep('├', '┤'));

    // ディレクトリ一覧（フォルダアイコン＋選択ハイライト＋スクロールバー）。
    const listTop = 4;
    const listRows = Math.max(1, rows - 6);
    const start = Math.max(0, Math.min(c.sel - (listRows >> 1), Math.max(0, c.entries.length - listRows)));
    for (let i = 0; i < listRows; i++) {
      const idx = start + i;
      const r = listTop + i;
      if (idx >= c.entries.length) {
        put(r, bodyRow(''));
        continue;
      }
      const name = c.entries[idx];
      const label = name === '..' ? '📁 ..' : `📁 ${name}`;
      let rowStr = bodyRow(label, { selected: idx === c.sel });
      // スクロールバー: 溢れている時、右端 │ の内側にスライダを重ねる。
      if (c.entries.length > listRows) {
        const barPos = Math.round((c.sel / Math.max(1, c.entries.length - 1)) * (listRows - 1));
        if (i === barPos) rowStr = rowStr.slice(0, -B('│').length) + `${ESC}[36m▐${RESET}`;
      }
      put(r, rowStr);
    }

    // 区切り＋フッタ（agent 選択はブラケットで表示）＋下枠。
    put(rows - 2, sep('├', '┤'));
    const agent = (a: string) => (c.agent === a ? `[${a}]` : ` ${a} `);
    put(rows - 1, bodyRow(`agent ${agent('claude')} ${agent('codex')}  ·  click:open 📂:create-here c:create Esc`, { color: '2' }));
    put(rows, sep('└', '┘'));
    write(out);
  }

  function doCreate(dir: string, agent: 'claude' | 'codex') {
    creating = null;
    const name = uniqueSessionName(dir);
    createTmuxSession(name, dir, agent);
    refreshSessions();
    const idx = sessions.findIndex((s) => s.name === name);
    if (idx >= 0) {
      selected = idx;
      sessions[selected].activePane = activePaneOf(name);
      ensureCtl(name);
      fitSelected();
    }
    focus = 'terminal';
    renderSidebar();
    renderTerminal();
  }

  function renderHistory() {
    if (!history) return;
    invalidatePaint(); // 右領域を上書きするので閉じた後は全再描画
    const h = history;
    const { rows, termLeft, termW } = layout();
    const W = Math.max(24, termW);
    const inner = W - 2; // 枠の内側幅
    const B = (s: string) => `${ESC}[36m${s}${RESET}`; // 枠は cyan
    let out = HIDE_CURSOR;
    for (let r = 1; r <= rows; r++) out += moveTo(r, termLeft) + RESET + CLEAR_EOL;

    const put = (r: number, s: string) => {
      out += moveTo(r, termLeft) + s;
    };
    const bodyRow = (text: string, opts: { selected?: boolean; color?: string } = {}) => {
      const t = truncateDisplay(text, inner - 1);
      const padded = ` ${t}${' '.repeat(Math.max(0, inner - 1 - displayWidth(t)))}`;
      let body = padded;
      if (opts.color) body = `${ESC}[${opts.color}m${body}${RESET}`;
      if (opts.selected) body = `${ESC}[7;36m${padded}${RESET}`;
      return B('│') + body + B('│');
    };
    const sep = (l: string, r: string) => B(l + '─'.repeat(inner) + r);

    // 上枠＋タイトル、区切り。
    const title = ' resume from history ';
    put(1, B(`┌─${title}${'─'.repeat(Math.max(0, inner - displayWidth(title) - 1))}┐`));
    put(2, sep('├', '┤'));

    // 履歴一覧（タイトル＋projectPath dim・選択ハイライト＋スクロールバー）。
    const listTop = 3;
    const listRows = Math.max(1, rows - 5);
    const start = Math.max(0, Math.min(h.sel - (listRows >> 1), Math.max(0, h.entries.length - listRows)));
    for (let i = 0; i < listRows; i++) {
      const idx = start + i;
      const r = listTop + i;
      if (idx >= h.entries.length) {
        if (h.entries.length === 0 && i === 0) put(r, bodyRow('(no history)', { color: '2' }));
        else put(r, bodyRow(''));
        continue;
      }
      const entry = h.entries[idx];
      const selected = idx === h.sel;
      // 幅が許せば projectPath を dim で末尾に付ける（色エスケープは幅計算に含めない）。
      const budget = inner - 1;
      const titleTrunc = truncateDisplay(entry.title, budget);
      let gap = '';
      let path = '';
      const remAfterTitle = budget - displayWidth(titleTrunc);
      if (remAfterTitle > 4) {
        gap = '   ';
        path = truncateDisplay(entry.projectPath, remAfterTitle - gap.length);
      }
      const visibleW = displayWidth(titleTrunc) + displayWidth(gap) + displayWidth(path);
      const pad = ' '.repeat(Math.max(0, budget - visibleW));
      // 選択行は反転済みなので path は dim にせずそのまま（RESET の入れ子を避ける）。
      const pathSeg = path ? `${gap}${selected ? path : `${ESC}[2m${path}${RESET}`}` : '';
      const content = ` ${titleTrunc}${pathSeg}${pad}`;
      let rowStr = selected ? B('│') + `${ESC}[7;36m${content}${RESET}` + B('│') : B('│') + content + B('│');
      // スクロールバー: 溢れている時、右端 │ の内側にスライダを重ねる。
      if (h.entries.length > listRows) {
        const barPos = Math.round((h.sel / Math.max(1, h.entries.length - 1)) * (listRows - 1));
        if (i === barPos) rowStr = rowStr.slice(0, -B('│').length) + `${ESC}[36m▐${RESET}`;
      }
      put(r, rowStr);
    }

    // 区切り＋フッタ＋下枠。
    put(rows - 2, sep('├', '┤'));
    put(rows - 1, bodyRow('↑↓ move · Enter/click: resume · Esc', { color: '2' }));
    put(rows, sep('└', '┘'));
    write(out);
  }

  function doResume(entry: HistoryEntry) {
    history = null;
    const name = uniqueSessionName(entry.projectPath);
    tmux(['new-session', '-d', '-s', name]);
    tmux(['source-file', `${process.env.HOME}/.config/cchub/tmux.conf`]);
    tmux(['send-keys', '-t', name, resumeCommand(entry), 'Enter']);
    refreshSessions();
    const idx = sessions.findIndex((s) => s.name === name);
    if (idx >= 0) {
      selected = idx;
      sessions[selected].activePane = activePaneOf(name);
      ensureCtl(name);
      fitSelected();
    }
    focus = 'terminal';
    renderSidebar();
    renderTerminal();
  }

  function openMenu(kind: 'session' | 'pane', target: string, rawTitle: string, items: string[], clickX: number, clickY: number) {
    const { rows, cols } = layout();
    const title = truncateDisplay(rawTitle, 20);
    const w = Math.max(displayWidth(title) + 2, ...items.map((l) => displayWidth(l) + 2), 10);
    const mx = Math.max(1, Math.min(clickX, cols - w - 2));
    const my = Math.max(1, Math.min(clickY, rows - items.length - 2));
    menu = { kind, target, title, items, sel: 0, mx, my, w };
    renderMenu();
  }

  function renderMenu() {
    if (!menu) return;
    const m = menu;
    const bd = (s: string) => `${ESC}[36m${s}${RESET}`;
    let out = '';
    const at = (r: number, s: string) => {
      out += moveTo(r, m.mx) + s;
    };
    const title = truncateDisplay(m.title, m.w - 2);
    at(m.my, bd(`┌─${title}${'─'.repeat(Math.max(0, m.w - displayWidth(title) - 1))}┐`));
    m.items.forEach((label, i) => {
      const t = ` ${label}${' '.repeat(Math.max(0, m.w - 1 - displayWidth(label)))}`;
      at(m.my + 1 + i, bd('│') + (i === m.sel ? `${ESC}[7;36m${t}${RESET}` : t) + bd('│'));
    });
    at(m.my + 1 + m.items.length, bd(`└${'─'.repeat(m.w)}┘`));
    write(out);
  }

  function closeMenu() {
    menu = null;
    invalidatePaint();
    write(CLEAR);
    renderSidebar();
    renderTerminal();
  }

  function menuSelect(idx: number) {
    const m = menu;
    if (!m) return;
    menu = null;
    const label = m.items[idx] ?? 'cancel';
    if (m.kind === 'session' && label === 'close') {
      killSessionByName(m.target);
      refreshSessions();
      if (selected >= sessions.length) selected = Math.max(0, sessions.length - 1);
      scrollOffset = 0;
      const cur = sessions[selected];
      if (cur) cur.activePane = activePaneOf(cur.name);
      focus = 'sidebar';
    } else if (m.kind === 'pane' && label !== 'cancel') {
      // split は分割先 pane のカレントディレクトリを引き継ぐ（-c はフォーマット展開される）。
      // 反映は次 paint の fetchPanes が拾う（fallback 再描画 250ms が保険）。
      if (label.startsWith('split')) {
        const dir = label.includes('│') ? '-h' : '-v';
        if (ctl && !ctl.closed) void ctl.exec(`split-window ${dir} -t ${m.target} -c '#{pane_current_path}'`);
        else tmux(['split-window', dir, '-t', m.target, '-c', '#{pane_current_path}']);
      } else if (label === 'close pane' && paneRects.length > 1) {
        // 最後の 1 枚は kill しない（セッションごと消えるため。メニューにも出さない）。
        if (ctl && !ctl.closed) void ctl.exec(`kill-pane -t ${m.target}`);
        else tmux(['kill-pane', '-t', m.target]);
      }
      focus = 'terminal';
    }
    invalidatePaint();
    write(CLEAR);
    renderSidebar();
    renderTerminal();
  }

  function selectIndex(i: number) {
    if (i < 0 || i >= sessions.length || i === selected) {
      selected = Math.max(0, Math.min(sessions.length - 1, i));
      return;
    }
    selected = i;
    scrollOffset = 0;
    paneRects = []; // 前セッションのジオメトリでクリック解決しないように
    paneIds = new Set();
    sessions[selected].activePane = activePaneOf(sessions[selected].name);
    ensureCtl(sessions[selected].name); // %output の追従先を切替え
    fitSelected();
    renderSidebar();
    renderTerminal();
  }

  function refreshSessions() {
    const next = listSessions();
    // 名前ベースでマージ（activePane は保持、dot は最新を採用）
    const byName = new Map(sessions.map((s) => [s.name, s]));
    sessions = next.map((n) => {
      const prev = byName.get(n.name);
      return prev
        ? { ...prev, dot: n.dot, title: n.title, recap: n.recap, branch: n.branch, tokens: n.tokens, ctx: n.ctx }
        : n;
    });
    if (selected >= sessions.length) selected = Math.max(0, sessions.length - 1);
    const cur = sessions[selected];
    if (cur && !cur.activePane) cur.activePane = activePaneOf(cur.name);
  }

  function enterTerminal() {
    if (!sessions[selected]?.activePane) return;
    focus = 'terminal';
    renderSidebar();
    renderTerminal();
  }
  function enterSidebar() {
    focus = 'sidebar';
    renderSidebar();
    renderTerminal();
  }

  // 入力
  const PREFIX = '\x02'; // Ctrl-B: 端末フォーカスから一覧へ戻る
  function onData(buf: Buffer) {
    const data = buf.toString('utf8');

    // コンテキストメニューが開いている間は最優先で処理。
    if (menu) {
      const mci = data.indexOf(MOUSE_PREFIX);
      if (mci !== -1) {
        let j = mci + MOUSE_PREFIX.length;
        while (j < data.length && data[j] !== 'M' && data[j] !== 'm') j++;
        if (j < data.length && data[j] === 'M') {
          const p = data.slice(mci + MOUSE_PREFIX.length, j).split(';');
          const button = Number.parseInt(p[0] ?? '', 10);
          const x = Number.parseInt(p[1] ?? '', 10);
          const y = Number.parseInt(p[2] ?? '', 10);
          // ホイール（bit6）は無視: 64 & 3 === 0 なので左クリックと誤判定される。
          if ((button & 64) === 0 && (button & 3) === 0) {
            const insideX = x >= menu.mx && x <= menu.mx + menu.w + 1;
            const itemRow = y - (menu.my + 1);
            if (insideX && itemRow >= 0 && itemRow < menu.items.length) menuSelect(itemRow);
            else closeMenu();
          }
        }
        return;
      }
      if (data === '\x1b') closeMenu();
      else if (data === `${ESC}[A` || data === 'k') {
        menu.sel = Math.max(0, menu.sel - 1);
        renderMenu();
      } else if (data === `${ESC}[B` || data === 'j') {
        menu.sel = Math.min(menu.items.length - 1, menu.sel + 1);
        renderMenu();
      } else if (data === '\r' || data === '\n') {
        menuSelect(menu.sel);
      }
      return;
    }

    // 新規作成フォーム（file browser）が開いている間は最優先で処理。
    if (creating) {
      const c = creating;
      // --- マウス: クリックでフォルダを開く / パスバーで作成 / フッタで agent 切替 / ホイールでスクロール ---
      const mci = data.indexOf(MOUSE_PREFIX);
      if (mci !== -1) {
        let j = mci + MOUSE_PREFIX.length;
        while (j < data.length && data[j] !== 'M' && data[j] !== 'm') j++;
        if (j < data.length && data[j] === 'M') {
          const p = data.slice(mci + MOUSE_PREFIX.length, j).split(';');
          const button = Number.parseInt(p[0] ?? '', 10);
          const x = Number.parseInt(p[1] ?? '', 10);
          const y = Number.parseInt(p[2] ?? '', 10);
          const { rows, termLeft } = layout();
          const listTop = 4;
          const listRows = Math.max(1, rows - 6);
          const start = Math.max(0, Math.min(c.sel - (listRows >> 1), Math.max(0, c.entries.length - listRows)));
          if (button === 64 || button === 65) {
            c.sel = Math.max(0, Math.min(c.entries.length - 1, c.sel + (button === 64 ? -3 : 3)));
            renderCreate();
          } else if ((button & 3) === 0 && x >= termLeft) {
            if (y === 2) {
              doCreate(c.dir, c.agent); // パスバークリック = ここで作成
            } else if (y === rows - 1) {
              c.agent = c.agent === 'claude' ? 'codex' : 'claude'; // フッタ = agent 切替
              renderCreate();
            } else if (y >= listTop && y < listTop + listRows) {
              const idx = start + (y - listTop);
              if (idx >= 0 && idx < c.entries.length) {
                const name = c.entries[idx]; // クリックで開く
                c.dir = name === '..' ? parentDir(c.dir) : childDir(c.dir, name);
                c.entries = listDirs(c.dir);
                c.sel = 0;
                renderCreate();
              }
            }
          }
        }
        return;
      }
      if (data === '\x1b') {
        creating = null;
        renderTerminal();
      } else if (data === '\t') {
        c.agent = c.agent === 'claude' ? 'codex' : 'claude';
        renderCreate();
      } else if (data === `${ESC}[A` || data === 'k') {
        c.sel = Math.max(0, c.sel - 1);
        renderCreate();
      } else if (data === `${ESC}[B` || data === 'j') {
        c.sel = Math.min(c.entries.length - 1, c.sel + 1);
        renderCreate();
      } else if (data === '\r' || data === '\n') {
        // 選択エントリを開く（.. は上へ）。
        const name = c.entries[c.sel];
        c.dir = name === '..' ? parentDir(c.dir) : childDir(c.dir, name);
        c.entries = listDirs(c.dir);
        c.sel = 0;
        renderCreate();
      } else if (data === 'c') {
        doCreate(c.dir, c.agent);
      }
      return;
    }

    // 履歴から復帰パネルが開いている間は最優先で処理。
    if (history) {
      const h = history;
      // --- マウス: ホイールでスクロール / クリックで行を選択して即復帰 ---
      const mci = data.indexOf(MOUSE_PREFIX);
      if (mci !== -1) {
        let j = mci + MOUSE_PREFIX.length;
        while (j < data.length && data[j] !== 'M' && data[j] !== 'm') j++;
        if (j < data.length && data[j] === 'M') {
          const p = data.slice(mci + MOUSE_PREFIX.length, j).split(';');
          const button = Number.parseInt(p[0] ?? '', 10);
          const x = Number.parseInt(p[1] ?? '', 10);
          const y = Number.parseInt(p[2] ?? '', 10);
          const { rows, termLeft } = layout();
          const listTop = 3;
          const listRows = Math.max(1, rows - 5);
          const start = Math.max(0, Math.min(h.sel - (listRows >> 1), Math.max(0, h.entries.length - listRows)));
          if (button === 64 || button === 65) {
            h.sel = Math.max(0, Math.min(h.entries.length - 1, h.sel + (button === 64 ? -3 : 3)));
            renderHistory();
          } else if ((button & 3) === 0 && x >= termLeft) {
            if (y >= listTop && y < listTop + listRows) {
              const idx = start + (y - listTop);
              if (idx >= 0 && idx < h.entries.length) {
                h.sel = idx;
                doResume(h.entries[idx]); // クリックで選択即復帰
              }
            }
          }
        }
        return;
      }
      if (data === '\x1b') {
        history = null;
        renderTerminal();
      } else if (data === `${ESC}[A` || data === 'k') {
        h.sel = Math.max(0, h.sel - 1);
        renderHistory();
      } else if (data === `${ESC}[B` || data === 'j') {
        h.sel = Math.min(Math.max(0, h.entries.length - 1), h.sel + 1);
        renderHistory();
      } else if (data === '\r' || data === '\n') {
        if (h.entries[h.sel]) doResume(h.entries[h.sel]);
      }
      return;
    }

    // ダッシュボードパネルが開いている間は最優先で処理（マウスは握りつぶす）。
    if (dash) {
      if (data.indexOf(MOUSE_PREFIX) !== -1) return;
      if (data === '\x1b' || data === 'q') {
        dash = null;
        renderTerminal();
      } else if (data === 'r') {
        void refreshDash();
      }
      return;
    }

    // マウス処理。全フォーカス共通。区切り線ドラッグで幅調整・クリックで選択/フォーカス・ホイールでスクロール。
    // パースできたマウスイベントは常に握りつぶす（端末へ生シーケンスが漏れないように）。
    let handledMouse = false;
    let mi = data.indexOf(MOUSE_PREFIX);
    while (mi !== -1) {
      let j = mi + MOUSE_PREFIX.length;
      while (j < data.length && data[j] !== 'M' && data[j] !== 'm') j++;
      if (j >= data.length) break;
      handledMouse = true;
      const isPress = data[j] === 'M';
      const parts = data.slice(mi + MOUSE_PREFIX.length, j).split(';');
      const button = Number.parseInt(parts[0] ?? '', 10);
      const x = Number.parseInt(parts[1] ?? '', 10);
      const y = Number.parseInt(parts[2] ?? '', 10);
      const { sidebarW } = layout();
      const motion = (button & 32) !== 0;

      if (dragging) {
        // ドラッグ中: 動きで幅追従、離したら終了。
        if (!isPress) dragging = false;
        else if (motion) {
          sidebarWidth = x - 1; // 区切り線がマウス位置に来るように
          fitSelected();
          invalidatePaint();
    write(CLEAR);
          renderSidebar();
          renderTerminal();
        }
      } else if (isPress && (button === 64 || button === 65) && x > sidebarW) {
        // ホイール: 端末領域上で回したらスクロール。慣性フラッド対策のレート制限は
        // 両パスに効かせる（Claude Code 2.1.x は alt=0 の通常スクリーンなので下の else 側）。
        const now = Date.now();
        if (now - lastWheelForward >= WHEEL_MIN_MS) {
          lastWheelForward = now;
          const s = sessions[selected];
          // 複数 pane ではマウス直下の pane を対象にする（座標も pane ローカルへ変換）。
          const p = paneAt(x, y);
          const target = p?.id ?? s?.activePane;
          if (target) {
            if (isAltScreen(target)) {
              const px = Math.max(1, x - sidebarW - 1 - (p?.left ?? 0));
              const py = Math.max(1, y - (p?.top ?? 0));
              sendInput(target, `${ESC}[<${button};${px};${py}M`);
            } else if (!p || p.active) {
              // 履歴スクロールはアクティブ pane のみ（scrollOffset は 1 本しか持たない）。
              scrollOffset = Math.max(0, scrollOffset + (button === 64 ? 3 : -3));
              renderTerminal();
            }
          }
        }
      } else if ((button & 64) !== 0) {
        // その他のホイールは握りつぶす: 横スクロール（66/67。トラックパッドで斜めに
        // 滑ると飛んでくる）とサイドバー上の縦ホイール。66 & 3 === 2 なので、ここで
        // 除外しないと下の右クリック判定に誤マッチして pane メニューが開いてしまう。
      } else if (isPress && (button & 3) === 2 && !motion) {
        if (x < sidebarW) {
          // 右クリック（サイドバー行）→ セッションメニュー。
          const idx = y - LIST_TOP;
          if (y >= LIST_TOP && y <= listBottomRow && idx < sessions.length)
            openMenu('session', sessions[idx].name, sessions[idx].name, ['close', 'cancel'], x, y);
        } else if (x > sidebarW + 1) {
          // 右クリック（端末領域）→ pane メニュー（分割・クローズ）。
          const p = paneAt(x, y);
          if (p) {
            const items =
              paneRects.length > 1 ? ['split │', 'split ─', 'close pane', 'cancel'] : ['split │', 'split ─', 'cancel'];
            openMenu('pane', p.id, `pane ${p.id}`, items, x, y);
          }
        }
      } else if (isPress && (button & 3) === 0 && !motion) {
        if (x === sidebarW || x === sidebarW + 1) {
          // 区切り線（＋その左1桁）を掴んだらドラッグ開始。
          dragging = true;
        } else if (y === 2 && x >= actionBtns.newBtn[0] && x <= actionBtns.newBtn[1]) {
          openCreate(); // [ + 新規 ] ボタン
        } else if (y === 2 && x >= actionBtns.histBtn[0] && x <= actionBtns.histBtn[1]) {
          openHistory(); // [ hist ] ボタン
        } else if (y === 2 && x >= actionBtns.dashBtn[0] && x <= actionBtns.dashBtn[1]) {
          openDashboard(); // [ dash ] ボタン
        } else if (x < sidebarW) {
          // サイドバー領域はどこをクリックしてもフォーカスを移す（空白でも）。
          // セッション行（一覧領域内）の上ならその行を選択も行う。
          const idx = y - LIST_TOP;
          if (y >= LIST_TOP && y <= listBottomRow && idx < sessions.length) selectIndex(idx);
          enterSidebar();
        } else if (x > sidebarW) {
          // 端末領域クリック: 複数 pane ならクリック位置の pane をアクティブに。
          const p = paneAt(x, y);
          if (p) focusPane(p);
          enterTerminal();
        }
      }
      mi = data.indexOf(MOUSE_PREFIX, j + 1);
    }
    if (handledMouse) return;

    // 端末フォーカス: プレフィックス以外は全部 pane へ転送。
    if (focus === 'terminal') {
      if (data === PREFIX) {
        enterSidebar();
        return;
      }
      const s = sessions[selected];
      if (s?.activePane) {
        scrollOffset = 0; // 打鍵したらライブへ戻す
        sendInput(s.activePane, data);
      }
      return;
    }

    // サイドバーフォーカス。
    if (data === 'q' || data === '\x03') {
      cleanup();
      return;
    }
    if (data === 'n') {
      openCreate();
      return;
    }
    if (data === 'H') {
      openHistory();
      return;
    }
    if (data === 'D') {
      openDashboard();
      return;
    }
    if (data === '[' || data === ']') {
      const cur = layout().sidebarW;
      sidebarWidth = cur + (data === ']' ? 2 : -2);
      fitSelected(); // 端末領域の幅が変わったので再フィット
      invalidatePaint();
    write(CLEAR);
      renderSidebar();
      renderTerminal();
      return;
    }
    if (data === `${ESC}[A` || data === 'k') selectIndex(selected - 1);
    else if (data === `${ESC}[B` || data === 'j') selectIndex(selected + 1);
    else if (data === '\r' || data === '\n') enterTerminal();
  }

  let timer: ReturnType<typeof setInterval> | null = null;
  let sessionsTimer: ReturnType<typeof setInterval> | null = null;

  function cleanup() {
    if (done) return;
    done = true;
    if (timer) clearInterval(timer);
    if (sessionsTimer) clearInterval(sessionsTimer);
    if (paintTimer) clearTimeout(paintTimer);
    ctl?.dispose();
    try {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
    } catch {
      // best-effort
    }
    // リサイズしたセッションを自動サイズへ戻す。
    for (const name of resized) tmux(['set-option', '-u', '-t', name, 'window-size']);
    write(MOUSE_OFF + SHOW_CURSOR + ALT_OFF);
  }

  // セットアップ
  stdin.setRawMode(true);
  stdin.resume();
  stdin.on('data', onData);
  stdout.on('resize', () => {
    fitSelected();
    if (ctl && !ctl.closed) {
      const { rows, termW } = layout();
      void ctl.exec(`refresh-client -C ${Math.max(20, termW)}x${Math.max(5, rows)}`);
    }
    invalidatePaint();
    write(CLEAR);
    renderSidebar();
    renderTerminal();
  });
  process.on('exit', cleanup);

  write(ALT_ON + HIDE_CURSOR + MOUSE_ON + CLEAR);
  if (sessions[selected]) {
    sessions[selected].activePane = activePaneOf(sessions[selected].name);
    ensureCtl(sessions[selected].name);
    fitSelected();
  }
  renderSidebar();
  renderTerminal();

  // 再描画は %output イベント駆動が基本。これは取り逃し用のフォールバック（低頻度）。
  timer = setInterval(() => {
    if (done) return;
    renderTerminal();
  }, FALLBACK_REPAINT_MS);

  // セッション一覧（ドット・詳細メタ含む）の定期更新。制御クライアントの再接続もここで拾う。
  sessionsTimer = setInterval(() => {
    if (done) return;
    if (dash) {
      // ダッシュボード表示中は一覧更新を止め、パネルの自動更新だけ行う。
      if (Date.now() - dashFetchedAt >= DASH_REFRESH_MS) void refreshDash();
      return;
    }
    if (creating || history || menu) return;
    refreshSessions();
    ensureCtl(sessions[selected]?.name);
    renderSidebar();
  }, SESSIONS_REFRESH_MS);
}

/** `cchub tui` / `bun run dev:tui` の入口。 */
export async function startEmbedTui(): Promise<void> {
  await main();
}

// `bun run tui/src/embed/embed-tui.ts` で直接起動された場合のみ自動実行。
// backend の commands/tui.ts から import される時は import.meta.main が false なので走らない。
if (import.meta.main) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
