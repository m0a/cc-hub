// `cchub tui` — launch the local TUI client (Ink, in the `tui/` workspace).
//
// Statically imported so `bun build --compile` bundles the tui (+ ink/react) into the
// single `cchub` binary. cli.ts loads this module lazily (only for `cchub tui`), so other
// subcommands don't pay the ink/react load cost at runtime. Backend's tsconfig enables
// `jsx` so its typecheck can follow the imported `.tsx` files.
import { startTui } from '../../../tui/src/index';

export interface RunTuiOptions {
  port: number;
  host: string;
  /** tmux の display-popup から呼ばれた場合の単発モード（switch-client → 終了）。 */
  popup?: boolean;
}

export async function runTui(options: RunTuiOptions): Promise<void> {
  // `-H` の既定はサーバの bind 用 `0.0.0.0`。TUI は接続側なので localhost へ正規化する
  // （明示指定された host はそのまま尊重）。
  const host = options.host === '0.0.0.0' ? '127.0.0.1' : options.host;
  await startTui({ port: options.port, host, popup: options.popup ?? false });
}
