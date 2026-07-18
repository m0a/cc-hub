import { describe, expect, test } from 'bun:test';
import { type ClientPaneDemands, reconcilePaneSizes } from '../pane-sizing';

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
