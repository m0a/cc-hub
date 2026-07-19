/**
 * Per-client pane sizing: reconcile many clients' reported render sizes into
 * one PTY size per pane.
 *
 * A pane has exactly one PTY (herdr), so its size can only be one value. When
 * more than one client displays the same pane at different sizes, we pick a
 * single size per dimension. The default policy is tmux's: the smallest
 * requested extent wins (the larger client sees unused margin). A pane no
 * client reports is absent from the result — the caller keeps its last size.
 *
 * This is pure and policy-only; it holds no state and talks to nothing.
 */

import type { PaneDemand } from '../../../shared/types';

/** One client's reported sizes, keyed by tmux-style pane id (`%N`). */
export type ClientPaneDemands = Record<string, PaneDemand>;

function sanitize(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  const floored = Math.floor(value);
  return floored >= 1 ? floored : null;
}

/**
 * Reconcile every client's pane demands into one size per pane.
 * Default policy: per-dimension smallest-wins (tmux-style). Invalid or
 * non-positive dimensions are ignored so a bogus report can't shrink a pane
 * to nothing.
 */
export function reconcilePaneSizes(
  demandsByClient: Iterable<ClientPaneDemands>,
): Map<string, PaneDemand> {
  const out = new Map<string, PaneDemand>();
  for (const demands of demandsByClient) {
    for (const paneId in demands) {
      const cols = sanitize(demands[paneId]?.cols);
      const rows = sanitize(demands[paneId]?.rows);
      if (cols === null || rows === null) continue;
      const prev = out.get(paneId);
      if (!prev) {
        out.set(paneId, { cols, rows });
      } else {
        // Smallest-wins, independently per dimension (matches tmux window sizing).
        out.set(paneId, {
          cols: Math.min(prev.cols, cols),
          rows: Math.min(prev.rows, rows),
        });
      }
    }
  }
  return out;
}
