import { describe, expect, test } from 'bun:test';
import { clientOwnsSessionSize } from '../herdr-control';

/**
 * Active-client sizing: the device being interacted with owns the shared
 * session size, so two devices on one session don't thrash it (the dual-view
 * flicker). This locks the ownership rule; the state transitions (claim on
 * input/tap, handoff on disconnect) are covered by the mux integration path.
 */
describe('clientOwnsSessionSize', () => {
  test('sole size reporter owns it (single-client = unchanged behavior)', () => {
    expect(clientOwnsSessionSize('a', 'a', false, 1)).toBe(true);
    // Even if some other id is nominally active, one reporter still owns.
    expect(clientOwnsSessionSize('other', 'a', false, 1)).toBe(true);
  });

  test('with nobody active yet, the first reporter owns', () => {
    expect(clientOwnsSessionSize(null, 'a', false, 2)).toBe(true);
  });

  test('the active client keeps ownership', () => {
    expect(clientOwnsSessionSize('a', 'a', false, 2)).toBe(true);
  });

  test('a passive second client does NOT own (no flicker)', () => {
    // b resizes while a is active → recorded only, size stays a's.
    expect(clientOwnsSessionSize('a', 'b', false, 2)).toBe(false);
  });

  test('an explicit claim (tap/focus) always takes ownership', () => {
    expect(clientOwnsSessionSize('a', 'b', true, 2)).toBe(true);
    expect(clientOwnsSessionSize('a', 'b', true, 5)).toBe(true);
  });

  test('three clients: only active or claimer owns', () => {
    expect(clientOwnsSessionSize('a', 'b', false, 3)).toBe(false);
    expect(clientOwnsSessionSize('a', 'c', false, 3)).toBe(false);
    expect(clientOwnsSessionSize('a', 'a', false, 3)).toBe(true);
  });
});
