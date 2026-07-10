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
import { listHistory, resumeCommand, type HistoryEntry } from './history';

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

const FRAME_MS = 33; // ~30fps
const WHEEL_MIN_MS = 40; // alt-screen へのホイール転送の最小間隔（慣性フラッド抑制）
const SIDEBAR_MIN = 20;
const SIDEBAR_MAX = 32;

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
  // 名前 + 状態ドット(@cchub_state) を一発で取得（tab 区切り）。
  const raw = tmux(['list-sessions', '-F', '#{session_name}\t#{@cchub_state}']);
  const titles = readTitles();
  return raw
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const [name, dot = ''] = line.split('\t');
      return { name, activePane: null, dot, title: titles.get(name) };
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

function displayWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += (ch.codePointAt(0) ?? 0) > 0x2000 ? 2 : 1;
  return w;
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
  // サイドバー幅の手動上書き（null=自動）。[ / ] で調整。
  let sidebarWidth: number | null = null;
  // 通常スクリーンの履歴スクロール量（0=ライブ）。alt-screen ではアプリ側に任せる。
  let scrollOffset = 0;
  // 区切り線ドラッグによる幅調整の進行フラグ。
  let dragging = false;
  // alt-screen へホイールを最後に転送した時刻（レート制限用）。
  let lastWheelForward = 0;
  // 右クリックのコンテキストメニュー（開いている間は最前面に描画）。
  let menu: { session: string; items: string[]; sel: number; mx: number; my: number; w: number } | null = null;
  const resized = new Set<string>();
  let done = false;

  const write = (s: string) => {
    try {
      stdout.write(s);
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
    tmux(['set-option', '-t', s.name, 'window-size', 'manual']);
    tmux(['resize-window', '-t', s.name, '-x', String(Math.max(20, termW)), '-y', String(Math.max(5, rows))]);
    resized.add(s.name);
  }

  function renderSidebar() {
    const { rows, sidebarW } = layout();
    const sidebarActive = focus === 'sidebar';
    let out = '';
    // タイトル: フォーカス中は明るい cyan＋◀ 印、非フォーカスは暗く。
    const title = sidebarActive ? '≡ sessions ◀' : '≡ sessions';
    const titleStyle = sidebarActive ? '1;36' : '2';
    out += moveTo(1, 1) + `${ESC}[${titleStyle}m${truncateDisplay(title, sidebarW)}${RESET}${CLEAR_EOL}`;
    sessions.forEach((s, i) => {
      const row = i + 2;
      if (row > rows - 1) return;
      const marker = i === selected ? '▸ ' : '  ';
      const dot = s.dot ? `${s.dot} ` : '· ';
      const label = truncateDisplay(marker + dot + (s.title || s.name), sidebarW);
      out += moveTo(row, 1);
      // 選択行: サイドバーフォーカス中は cyan 反転、そうでなければ通常反転（暗め）。
      if (i === selected) out += `${ESC}[7${sidebarActive ? ';36' : ''}m${label}${RESET}`;
      else out += label;
      out += CLEAR_EOL;
    });
    // 区切り線: フォーカスのある側を cyan、無い側は暗いグレー。
    const sepColor = sidebarActive ? '90' : '36';
    for (let r = 1; r <= rows; r++) out += moveTo(r, sidebarW + 1) + `${ESC}[${sepColor}m│${RESET}`;
    // フッタ: モードバッジ（反転）＋ヒント。
    const badge = sidebarActive ? `${ESC}[7;36m 一覧 ${RESET}` : `${ESC}[7;33m 端末 ${RESET}`;
    const hint = sidebarActive ? ' ↑↓ Enter n H:履歴 [] q' : ' Ctrl-B で一覧へ';
    out += moveTo(rows, 1) + badge + `${ESC}[2m${truncateDisplay(hint, Math.max(0, sidebarW - 6))}${RESET}${CLEAR_EOL}`;
    write(out);
  }

  function renderTerminal() {
    const { rows, termLeft, termW } = layout();
    const s = sessions[selected];
    let out = '';
    // alt-screen（Claude Code 等）は履歴 offset を使わず常にライブ画面を映す
    // （スクロールはアプリ自身が代替スクリーン内でやる）。通常スクリーンは offset で遡る。
    const alt = s?.activePane ? isAltScreen(s.activePane) : false;
    const off = alt ? 0 : scrollOffset;
    const lines = s?.activePane
      ? capture(s.activePane, off, rows)
      : sessions.length === 0
        ? ['', '  他のセッションがありません。', '  （このセッション自身は自己参照防止のため除外しています）']
        : [];
    for (let r = 0; r < rows; r++) {
      const line = lines[r] ?? '';
      out += moveTo(r + 1, termLeft) + RESET;
      // 領域幅にクリップ（表示幅で切る）。エスケープ込みなのでざっくり文字数で。
      out += line.length > termW * 2 ? line.slice(0, termW * 2) : line;
      out += `${RESET}${CLEAR_EOL}`;
    }
    // 端末フォーカス中は pane のカーソル位置に自前カーソルを合わせて表示。
    if (focus === 'terminal' && s?.activePane) {
      const cur = paneCursor(s.activePane);
      if (cur && cur.y < rows) out += moveTo(cur.y + 1, termLeft + cur.x) + SHOW_CURSOR;
      else out += HIDE_CURSOR;
    } else {
      out += HIDE_CURSOR;
    }
    write(out);
  }

  function openCreate() {
    const dir = process.env.HOME || '/';
    creating = { dir, entries: listDirs(dir), sel: 0, agent: 'claude' };
    renderCreate();
  }

  function renderCreate() {
    if (!creating) return;
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
    const title = ' 新規セッション ';
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
    put(rows - 1, bodyRow(`agent ${agent('claude')} ${agent('codex')}  ·  クリック:開く 📂:作成 c:作成 Esc`, { color: '2' }));
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
      fitSelected();
    }
    focus = 'terminal';
    renderSidebar();
    renderTerminal();
  }

  function renderHistory() {
    if (!history) return;
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
    const title = ' 履歴から復帰 ';
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
        if (h.entries.length === 0 && i === 0) put(r, bodyRow('(履歴なし)', { color: '2' }));
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
    put(rows - 1, bodyRow('↑↓ 移動 · Enter/クリック 復帰 · Esc 中止', { color: '2' }));
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
      fitSelected();
    }
    focus = 'terminal';
    renderSidebar();
    renderTerminal();
  }

  function openMenu(session: string, clickX: number, clickY: number) {
    const { rows, cols } = layout();
    const items = ['閉じる', 'キャンセル'];
    const title = truncateDisplay(session, 20);
    const w = Math.max(displayWidth(title) + 2, ...items.map((l) => displayWidth(l) + 2), 10);
    const mx = Math.max(1, Math.min(clickX, cols - w - 2));
    const my = Math.max(1, Math.min(clickY, rows - items.length - 2));
    menu = { session, items, sel: 0, mx, my, w };
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
    const title = truncateDisplay(m.session, m.w - 2);
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
    write(CLEAR);
    renderSidebar();
    renderTerminal();
  }

  function menuSelect(idx: number) {
    const m = menu;
    if (!m) return;
    menu = null;
    if (idx === 0) {
      // 閉じる
      killSessionByName(m.session);
      refreshSessions();
      if (selected >= sessions.length) selected = Math.max(0, sessions.length - 1);
      scrollOffset = 0;
      const cur = sessions[selected];
      if (cur) cur.activePane = activePaneOf(cur.name);
      focus = 'sidebar';
    }
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
    sessions[selected].activePane = activePaneOf(sessions[selected].name);
    fitSelected();
    renderSidebar();
  }

  function refreshSessions() {
    const next = listSessions();
    // 名前ベースでマージ（activePane は保持、dot は最新を採用）
    const byName = new Map(sessions.map((s) => [s.name, s]));
    sessions = next.map((n) => {
      const prev = byName.get(n.name);
      return prev ? { ...prev, dot: n.dot, title: n.title } : n;
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
          if ((button & 3) === 0) {
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
          if (s?.activePane) {
            if (isAltScreen(s.activePane)) {
              const px = Math.max(1, x - sidebarW - 1);
              sendKeysHex(s.activePane, `${ESC}[<${button};${px};${y}M`);
            } else {
              scrollOffset = Math.max(0, scrollOffset + (button === 64 ? 3 : -3));
              renderTerminal();
            }
          }
        }
      } else if (isPress && (button & 3) === 2 && !motion && x < sidebarW) {
        // 右クリック（サイドバー行）→ コンテキストメニュー。
        const idx = y - 2;
        if (idx >= 0 && idx < sessions.length) openMenu(sessions[idx].name, x, y);
      } else if (isPress && (button & 3) === 0 && !motion) {
        if (x === sidebarW || x === sidebarW + 1) {
          // 区切り線（＋その左1桁）を掴んだらドラッグ開始。
          dragging = true;
        } else if (x < sidebarW) {
          // サイドバー領域はどこをクリックしてもフォーカスを移す（空白でも）。
          // セッション行の上ならその行を選択も行う。
          const idx = y - 2;
          if (idx >= 0 && idx < sessions.length) selectIndex(idx);
          enterSidebar();
        } else if (x > sidebarW) {
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
        sendKeysHex(s.activePane, data);
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
      history = { entries: listHistory(50), sel: 0 };
      renderHistory();
      return;
    }
    if (data === '[' || data === ']') {
      const cur = layout().sidebarW;
      sidebarWidth = cur + (data === ']' ? 2 : -2);
      fitSelected(); // 端末領域の幅が変わったので再フィット
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

  function cleanup() {
    if (done) return;
    done = true;
    if (timer) clearInterval(timer);
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
    write(CLEAR);
    renderSidebar();
  });
  process.on('exit', cleanup);

  write(ALT_ON + HIDE_CURSOR + MOUSE_ON + CLEAR);
  if (sessions[selected]) {
    sessions[selected].activePane = activePaneOf(sessions[selected].name);
    fitSelected();
  }
  renderSidebar();

  timer = setInterval(() => {
    if (done || creating || history) return; // 作成フォーム/履歴パネル表示中は上書きしない
    refreshSessions();
    renderTerminal();
    if (menu) renderMenu(); // メニューは最前面に再描画
  }, FRAME_MS);
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
