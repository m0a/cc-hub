// tmux 制御モード(-C)の常駐クライアント。
//
// 目的はホットパスの高速化: 毎フレーム `tmux ...` を fork する（macOS で 1 回 5〜20ms）
// 代わりに、常駐した 1 本の `tmux -C attach` にコマンドをパイプで流す（サブ ms）。
// さらに %output 通知を「ダーティ信号」として受け取り、出力があった時だけ再描画できる
// （ブラインド 30fps ポーリングの廃止）。ペイロード自体は使わない（描画は capture-pane）。
//
// プロトコル: コマンドは stdin に 1 行ずつ。応答は %begin ... %end（%error）で囲まれ、
// 発行順に返る（FIFO）。それ以外の % 行は非同期通知（%output %<pane> <data> など）。
import type { FileSink, Subprocess } from 'bun';

const dec = new TextDecoder();

export class TmuxCtl {
  private proc: Subprocess<'pipe', 'pipe', 'ignore'>;
  private stdin: FileSink;
  private pending: Array<(lines: string[]) => void> = [];
  private collecting: string[] | null = null;
  private buf = '';
  private _closed = false;
  /** 選択セッションの pane に出力があった時に呼ばれる（ダーティ通知）。 */
  onOutput: ((paneId: string) => void) | null = null;
  onExit: (() => void) | null = null;

  constructor(target: string) {
    // ネスト検出（$TMUX）を外して制御クライアントとして attach する。ただし $TMUX には
    // ソケットパスが入っている（tmux 内で動いている場合）ので、外す前に -S で引き継ぐ。
    // これを忘れると別ソケットの tmux サーバに繋いでしまう。
    const sock = (process.env.TMUX ?? '').split(',')[0];
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && k !== 'TMUX') env[k] = v;
    }
    const args = sock ? ['-S', sock] : [];
    this.proc = Bun.spawn(['tmux', ...args, '-C', 'attach-session', '-t', target], {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'ignore',
      env,
    });
    this.stdin = this.proc.stdin;
    // 接続直後に tmux が出す最初の %begin/%end ブロック（attach 自体の応答）を吸収する。
    this.pending.push(() => {});
    void this.readLoop();
  }

  get closed(): boolean {
    return this._closed;
  }

  private async readLoop(): Promise<void> {
    try {
      for await (const chunk of this.proc.stdout) {
        this.buf += dec.decode(chunk);
        let nl = this.buf.indexOf('\n');
        while (nl !== -1) {
          const line = this.buf.slice(0, nl).replace(/\r$/, '');
          this.buf = this.buf.slice(nl + 1);
          this.handleLine(line);
          nl = this.buf.indexOf('\n');
        }
      }
    } catch {
      // 読み取り失敗 = 切断扱い
    }
    this.markClosed();
  }

  private handleLine(line: string): void {
    if (this.collecting !== null) {
      if (line.startsWith('%end') || line.startsWith('%error')) {
        const resolve = this.pending.shift();
        const lines = this.collecting;
        this.collecting = null;
        resolve?.(lines);
      } else {
        this.collecting.push(line);
      }
      return;
    }
    if (line.startsWith('%begin')) {
      this.collecting = [];
      return;
    }
    if (line.startsWith('%output ')) {
      const rest = line.slice('%output '.length);
      const sp = rest.indexOf(' ');
      const pane = sp === -1 ? rest : rest.slice(0, sp);
      this.onOutput?.(pane);
      return;
    }
    if (line.startsWith('%exit')) {
      this.markClosed();
    }
    // その他の通知（%session-changed 等）は無視。
  }

  private markClosed(): void {
    if (this._closed) return;
    this._closed = true;
    // 未応答のコマンドは空で解決（呼び出し側は fallback へ）。
    for (const resolve of this.pending.splice(0)) resolve([]);
    this.onExit?.();
  }

  /** コマンドを 1 つ実行し、%begin/%end 間の出力行を返す。切断時は []。 */
  exec(cmd: string): Promise<string[]> {
    if (this._closed) return Promise.resolve([]);
    return new Promise((resolve) => {
      this.pending.push(resolve);
      try {
        this.stdin.write(`${cmd}\n`);
        this.stdin.flush();
      } catch {
        this.pending.pop();
        this.markClosed();
        resolve([]);
      }
    });
  }

  dispose(): void {
    this._closed = true;
    try {
      this.stdin.end();
    } catch {
      // best-effort
    }
    try {
      this.proc.kill();
    } catch {
      // best-effort
    }
  }
}
