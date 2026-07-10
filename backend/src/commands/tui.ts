// `cchub tui` — launch the local TUI (embed-tui, in the `tui/` workspace).
//
// Statically imported so `bun build --compile` bundles the tui into the single `cchub`
// binary. embed-tui talks to tmux directly (no server/API), so it needs no port/host/auth.
import { startEmbedTui } from '../../../tui/src/embed/embed-tui';

export async function runTui(): Promise<void> {
  await startEmbedTui();
}
