// マウスでクリック選択できる常時表示サイドバー（spike）。
//
// Ink はマウス非対応なので、ここは React を使わず raw ターミナルで描画する。
// SGR マウス（\x1b[?1006h）を自前で有効化し、tmux がこのペインへ転送してくる
// マウスイベント（\x1b[<b;x;yM）を読んで、行クリックでそのセッションへ switch する。
// tmux セッション（実端末）はそのまま右に残るので、herdr 風の「左でクリック→右が切替」になる。
import type { ApiClient } from '../api/client';
import { getSessions } from '../api/sessions';
import { deriveIndicator } from '../components/session-row';
import { switchClientWithSidebar } from '../tmux/attach';
import type { TuiSession } from '../types';

// 状態 → 色ドット（status-bar / @cchub_state と同じ意味論）。
const DOTS: Record<string, string> = {
  processing: '🟡',
  waiting_input: '🔴',
  completed: '🔵',
  idle: '🟢',
};
function dotFor(s: TuiSession): string {
  return DOTS[deriveIndicator(s) ?? 'idle'] ?? '🟢';
}

// 一覧の開始スクリーン行（1-based）: 1=ヘッダ, 2=空行, 3〜=セッション行。
const FIRST_ROW = 3;
const POLL_MS = 2500;

// ターミナル制御シーケンス。
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const MOUSE_ON = '\x1b[?1000h\x1b[?1006h';
const MOUSE_OFF = '\x1b[?1000l\x1b[?1006l';
const CLEAR = '\x1b[2J\x1b[H';

/** 表示幅ざっくり考慮でタイトルを切り詰め（絵文字は2幅とみなす簡易版）。 */
function truncate(text: string, max: number): string {
  if (max <= 1) return '';
  let width = 0;
  let out = '';
  for (const ch of text) {
    const w = (ch.codePointAt(0) ?? 0) > 0x2000 ? 2 : 1;
    if (width + w > max) {
      out += '…';
      break;
    }
    width += w;
    out += ch;
  }
  return out;
}

/**
 * マウス対応サイドバーを実行する。q / Ctrl-C で resolve（呼出側がペインを閉じる）。
 * 行クリック or Enter でそのセッションへ switch（自ペインは残り続ける）。
 */
export function runMouseSidebar(client: ApiClient): Promise<void> {
  return new Promise<void>((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    let sessions: TuiSession[] = [];
    let selected = 0;
    let done = false;

    const write = (s: string) => {
      try {
        stdout.write(s);
      } catch {
        // ペインが消えた等はベストエフォート
      }
    };

    function clampSelected() {
      if (sessions.length === 0) selected = 0;
      else selected = Math.min(Math.max(0, selected), sessions.length - 1);
    }

    function render() {
      const cols = stdout.columns || 34;
      const rows = stdout.rows || 24;
      let out = CLEAR;
      out += '\x1b[1;36m≡ sessions\x1b[0m\r\n\r\n';
      const visible = Math.max(0, rows - FIRST_ROW - 1); // フッタ1行を残す
      if (sessions.length === 0) {
        out += '\x1b[2mセッションがありません\x1b[0m\r\n';
      }
      sessions.slice(0, visible).forEach((s, i) => {
        const title = (s.customTitle?.trim() || s.name) ?? '';
        const label = truncate(`${dotFor(s)} ${title}`, cols - 2);
        if (i === selected) out += `\x1b[7m▸ ${label}\x1b[0m\r\n`;
        else out += `  ${label}\r\n`;
      });
      // フッタは最下行に固定。
      out += `\x1b[${rows};1H\x1b[2m↑↓/クリック 選択 · Enter 切替 · q 閉じる\x1b[0m`;
      write(out);
    }

    function activate(index: number) {
      const target = sessions[index];
      if (!target) return;
      selected = index;
      render();
      switchClientWithSidebar(target.name);
    }

    async function refresh() {
      try {
        sessions = await getSessions(client);
        clampSelected();
        if (!done) render();
      } catch {
        // 一時的な取得失敗は無視（次のポーリングで復帰）
      }
    }

    // 入力（キー + SGR マウス）を処理。制御文字を含む正規表現は使えないので文字列走査でパース。
    // SGR マウス列: ESC [ < button ; x ; y (M=押下 / m=解放)。
    const MOUSE_PREFIX = '\x1b[<';
    function onData(buf: Buffer) {
      const data = buf.toString('utf8');

      // マウス: 左ボタン押下（button 下位2bit=0）を行クリックとして扱う。
      let handledMouse = false;
      let mi = data.indexOf(MOUSE_PREFIX);
      while (mi !== -1) {
        let j = mi + MOUSE_PREFIX.length;
        while (j < data.length && data[j] !== 'M' && data[j] !== 'm') j++;
        if (j >= data.length) break;
        const press = data[j] === 'M';
        const parts = data.slice(mi + MOUSE_PREFIX.length, j).split(';');
        const button = Number.parseInt(parts[0] ?? '', 10);
        const y = Number.parseInt(parts[2] ?? '', 10);
        if (press && Number.isFinite(button) && (button & 3) === 0 && Number.isFinite(y)) {
          const idx = y - FIRST_ROW;
          if (idx >= 0 && idx < sessions.length) {
            activate(idx);
            handledMouse = true;
          }
        }
        mi = data.indexOf(MOUSE_PREFIX, j + 1);
      }
      if (handledMouse) return;

      // キー入力。
      if (data === 'q' || data === '\x03') {
        cleanup();
        return;
      }
      if (data === '\x1b[A' || data === 'k') {
        selected = Math.max(0, selected - 1);
        render();
      } else if (data === '\x1b[B' || data === 'j') {
        selected = Math.min(Math.max(0, sessions.length - 1), selected + 1);
        render();
      } else if (data === '\r' || data === '\n') {
        activate(selected);
      }
    }

    let poll: ReturnType<typeof setInterval> | null = null;

    function cleanup() {
      if (done) return;
      done = true;
      if (poll) clearInterval(poll);
      try {
        stdin.off('data', onData);
        if (stdin.isTTY && typeof stdin.setRawMode === 'function') stdin.setRawMode(false);
        stdin.pause();
      } catch {
        // best-effort
      }
      write(MOUSE_OFF + SHOW_CURSOR + CLEAR);
      resolve();
    }

    // セットアップ。
    if (stdin.isTTY && typeof stdin.setRawMode === 'function') stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
    write(HIDE_CURSOR + MOUSE_ON);
    void refresh();
    poll = setInterval(() => void refresh(), POLL_MS);
  });
}
