import { describe, expect, it } from 'bun:test';
import { assertPanesHaveScroll } from '../herdr-control';

/**
 * herdr < protocol 16 (v0.7.1 and older) returns panes without `scroll`.
 * Subscribing then used to die with a bare TypeError deep in
 * HerdrControlSession.start(), reaching the client as an unexplained
 * "Failed to subscribe". The guard must name the actual fix instead.
 */
describe('assertPanesHaveScroll', () => {
  const scroll = { offset_from_bottom: 0, max_offset_from_bottom: 460, viewport_rows: 23 };

  it('accepts protocol 16 panes (scroll present)', () => {
    expect(() => assertPanesHaveScroll([{ scroll }, { scroll }])).not.toThrow();
  });

  it('accepts an empty pane list', () => {
    expect(() => assertPanesHaveScroll([])).not.toThrow();
  });

  it('rejects protocol 14 panes with a message naming the fix', () => {
    expect(() => assertPanesHaveScroll([{ scroll }, { scroll: undefined }])).toThrow(
      /herdr server is too old.*protocol >= 16/,
    );
  });
});
