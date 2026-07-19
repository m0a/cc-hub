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
 * Decide the final PTY size per pane from the tree/zoom `base` and the
 * reconciled per-client `demand`.
 *
 * Per-client sizing only intervenes for a genuine MULTI-client conflict: with
 * fewer than two clients the base is returned untouched (single client always
 * uses the existing tree/zoom path — no override, so no rounding jitter and no
 * lag from a client's view changing faster than its demand). With two or more,
 * a pane is shrunk to the demand only when the demand is at least `tolerance`
 * cells smaller than its slot in some dimension — a real dual-view conflict
 * (mobile 48 vs desktop 89), not the ±1 rounding between a client's
 * proposeDimensions and the server's ratio split. Panes are never grown beyond
 * their tree slot.
 */
export function resolveTargetSizes(
  base: ReadonlyMap<string, PaneDemand>,
  reconciled: ReadonlyMap<string, PaneDemand>,
  clientCount: number,
  tolerance: number,
): Map<string, PaneDemand> {
  const out = new Map<string, PaneDemand>(base);
  if (clientCount < 2) return out;
  for (const [paneId, b] of base) {
    const d = reconciled.get(paneId);
    if (!d) continue;
    const cols = b.cols - d.cols >= tolerance ? d.cols : b.cols;
    const rows = b.rows - d.rows >= tolerance ? d.rows : b.rows;
    if (cols !== b.cols || rows !== b.rows) out.set(paneId, { cols, rows });
  }
  return out;
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
