import { describe, expect, test } from 'bun:test';
import type { PaneDemand } from '../../../../shared/types';
import { type ClientPaneDemands, reconcilePaneSizes, resolveTargetSizes } from '../pane-sizing';

const m = (o: Record<string, PaneDemand>) => new Map(Object.entries(o));

/**
 * A pane has one PTY, so N clients viewing it at different sizes must collapse
 * to one size. The policy is tmux's per-dimension smallest-wins; a pane no
 * client reports is simply absent (caller keeps its last size). These lock the
 * policy so the per-client sizing model can't silently drift.
 */
describe('reconcilePaneSizes', () => {
  test('no clients → empty map', () => {
    expect(reconcilePaneSizes([]).size).toBe(0);
  });

  test('single client → its sizes verbatim (single-client equivalence)', () => {
    const desktop: ClientPaneDemands = { '%1': { cols: 89, rows: 46 }, '%2': { cols: 89, rows: 46 } };
    const out = reconcilePaneSizes([desktop]);
    expect(out.get('%1')).toEqual({ cols: 89, rows: 46 });
    expect(out.get('%2')).toEqual({ cols: 89, rows: 46 });
  });

  test('smallest-wins per dimension across clients', () => {
    // Mobile shows %1 full (48 wide); desktop shows %1 in a split (89 wide).
    const mobile: ClientPaneDemands = { '%1': { cols: 48, rows: 45 } };
    const desktop: ClientPaneDemands = { '%1': { cols: 89, rows: 46 } };
    const out = reconcilePaneSizes([mobile, desktop]);
    // min cols = 48, min rows = 45 — desktop letterboxes, tmux-style.
    expect(out.get('%1')).toEqual({ cols: 48, rows: 45 });
  });

  test('dimensions are minimized independently', () => {
    const a: ClientPaneDemands = { '%1': { cols: 100, rows: 20 } };
    const b: ClientPaneDemands = { '%1': { cols: 60, rows: 50 } };
    expect(reconcilePaneSizes([a, b]).get('%1')).toEqual({ cols: 60, rows: 20 });
  });

  test('a pane only one client shows keeps that client’s size', () => {
    const mobile: ClientPaneDemands = { '%1': { cols: 48, rows: 45 } };
    const desktop: ClientPaneDemands = { '%1': { cols: 89, rows: 46 }, '%2': { cols: 89, rows: 46 } };
    const out = reconcilePaneSizes([mobile, desktop]);
    expect(out.get('%1')).toEqual({ cols: 48, rows: 45 }); // both → min
    expect(out.get('%2')).toEqual({ cols: 89, rows: 46 }); // desktop only
  });

  test('invalid / non-positive dimensions are ignored, never shrink a pane', () => {
    const good: ClientPaneDemands = { '%1': { cols: 80, rows: 24 } };
    const bogus: ClientPaneDemands = {
      '%1': { cols: 0, rows: Number.NaN },
      '%2': { cols: -5, rows: 10 },
    };
    const out = reconcilePaneSizes([good, bogus]);
    expect(out.get('%1')).toEqual({ cols: 80, rows: 24 }); // bogus %1 skipped
    expect(out.has('%2')).toBe(false); // %2 had no valid dimension
  });

  test('fractional sizes are floored', () => {
    const c: ClientPaneDemands = { '%1': { cols: 80.9, rows: 24.9 } };
    expect(reconcilePaneSizes([c]).get('%1')).toEqual({ cols: 80, rows: 24 });
  });
});

/**
 * The override that turns reconciled demands into final PTY sizes. Its whole
 * job is to leave a single client alone (the common case — no jitter, no
 * view-vs-demand lag) and only shrink a pane on a real multi-client conflict.
 */
describe('resolveTargetSizes', () => {
  const TOL = 3;

  test('single client → base untouched (no override at all)', () => {
    const base = m({ '%1': { cols: 89, rows: 46 }, '%2': { cols: 89, rows: 46 } });
    // Demand differs (e.g. ±1 rounding, or a stale zoom-transition value) but
    // with one client it must never apply.
    const reconciled = m({ '%1': { cols: 40, rows: 24 }, '%2': { cols: 88, rows: 46 } });
    expect(resolveTargetSizes(base, reconciled, 1, TOL)).toEqual(base);
  });

  test('two clients: shrinks a pane on a real conflict (mobile vs desktop)', () => {
    const base = m({ '%1': { cols: 89, rows: 46 }, '%2': { cols: 89, rows: 46 } });
    const reconciled = m({ '%1': { cols: 48, rows: 45 } }); // mobile shows %1 small
    const out = resolveTargetSizes(base, reconciled, 2, TOL);
    // cols conflict (89→48) shrinks; rows differ by only 1 (noise) so 46 stays.
    expect(out.get('%1')).toEqual({ cols: 48, rows: 46 });
    expect(out.get('%2')).toEqual({ cols: 89, rows: 46 }); // no demand → slot kept
  });

  test('two clients: ignores sub-tolerance rounding jitter', () => {
    const base = m({ '%1': { cols: 89, rows: 46 } });
    const reconciled = m({ '%1': { cols: 88, rows: 45 } }); // 1 smaller — noise
    expect(resolveTargetSizes(base, reconciled, 2, TOL).get('%1')).toEqual({ cols: 89, rows: 46 });
  });

  test('shrinks per dimension independently', () => {
    const base = m({ '%1': { cols: 89, rows: 46 } });
    const reconciled = m({ '%1': { cols: 40, rows: 45 } }); // cols conflict, rows noise
    expect(resolveTargetSizes(base, reconciled, 2, TOL).get('%1')).toEqual({ cols: 40, rows: 46 });
  });

  test('never grows a pane beyond its tree slot', () => {
    const base = m({ '%1': { cols: 50, rows: 24 } });
    const reconciled = m({ '%1': { cols: 200, rows: 100 } }); // larger demand
    expect(resolveTargetSizes(base, reconciled, 2, TOL).get('%1')).toEqual({ cols: 50, rows: 24 });
  });

  test('does not mutate the base map', () => {
    const base = m({ '%1': { cols: 89, rows: 46 } });
    resolveTargetSizes(base, m({ '%1': { cols: 40, rows: 20 } }), 2, TOL);
    expect(base.get('%1')).toEqual({ cols: 89, rows: 46 });
  });
});
