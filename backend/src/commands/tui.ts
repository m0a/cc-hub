// `cchub tui` — launch the local TUI client (Ink, in the `tui/` workspace).
//
// The tui entry is resolved at RUNTIME (variable path) so the backend's typecheck
// stays decoupled from the tui/JSX workspace — backend's tsconfig has no `jsx`
// setting and must not pull `.tsx` files into its program. Bun resolves the
// absolute path at runtime in dev. Binary packaging includes the tui entry as a
// separate build entrypoint — see tasks.md T036.
import { join } from 'node:path';

export interface RunTuiOptions {
  port: number;
  host: string;
}

export async function runTui(options: RunTuiOptions): Promise<void> {
  // `-H` の既定はサーバの bind 用 `0.0.0.0`。TUI は接続側なので localhost へ正規化する
  // （明示指定された host はそのまま尊重）。
  const host = options.host === '0.0.0.0' ? '127.0.0.1' : options.host;

  const entry = join(import.meta.dir, '../../../tui/src/index.ts');
  const mod = (await import(entry)) as {
    startTui: (opts: RunTuiOptions) => Promise<void>;
  };
  await mod.startTui({ port: options.port, host });
}
