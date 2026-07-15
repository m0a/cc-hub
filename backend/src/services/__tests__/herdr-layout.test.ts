import { describe, expect, test } from 'bun:test';
import { PaneLayoutTree } from '../herdr-layout';

function twoPane(): PaneLayoutTree {
  const t = new PaneLayoutTree();
  t.setInitialPanes(['%1']);
  t.split('%1', 'h', '%2');
  return t;
}

describe('PaneLayoutTree.setPaneSize', () => {
  test('sets absolute width via ancestor split ratio', () => {
    const t = twoPane();
    t.setPaneSize('%1', 120, 40, 160, 40);
    const rects = t.computeRects(160, 40);
    expect(rects.get('%1')?.width).toBeCloseTo(120, -1); // within rounding
    expect((rects.get('%1')?.width ?? 0) + (rects.get('%2')?.width ?? 0) + 1).toBe(160);
  });

  test('resize survives a subsequent recompute (single source of truth)', () => {
    const t = twoPane();
    t.setPaneSize('%2', 40, 40, 160, 40);
    // Simulate a later applyLayout pass at the same client size
    const again = t.computeRects(160, 40);
    expect(again.get('%2')?.width).toBeCloseTo(40, -1);
  });

  test('second pane resize adjusts the shared split consistently', () => {
    const t = twoPane();
    t.setPaneSize('%2', 100, 40, 160, 40);
    const rects = t.computeRects(160, 40);
    expect(rects.get('%2')?.width).toBeCloseTo(100, -1);
    expect(rects.get('%1')?.width).toBeCloseTo(59, -1);
  });

  test('vertical dimension uses v-split ancestor', () => {
    const t = new PaneLayoutTree();
    t.setInitialPanes(['%1']);
    t.split('%1', 'v', '%2');
    t.setPaneSize('%1', 160, 30, 160, 40);
    const rects = t.computeRects(160, 40);
    expect(rects.get('%1')?.height).toBeCloseTo(30, -1);
  });

  test('nested split: resizing inner pane keeps outer split intact', () => {
    const t = new PaneLayoutTree();
    t.setInitialPanes(['%1']);
    t.split('%1', 'h', '%2'); // [%1 | %2]
    t.split('%2', 'v', '%3'); // right column: %2 over %3
    t.setPaneSize('%3', 79, 10, 160, 40);
    const rects = t.computeRects(160, 40);
    expect(rects.get('%3')?.height).toBeCloseTo(10, -1);
    // outer h-split untouched: right column still ~half width
    expect(rects.get('%3')?.width).toBeCloseTo(79, -1);
    expect(rects.get('%1')?.width).toBeCloseTo(80, -1);
  });

  test('ratio is clamped so a pane cannot be sized away entirely', () => {
    const t = twoPane();
    t.setPaneSize('%1', 1000, 40, 160, 40);
    const rects = t.computeRects(160, 40);
    expect(rects.get('%2')?.width ?? 0).toBeGreaterThanOrEqual(15); // >= 10% of usable
  });
});

describe('PaneLayoutTree.split duplicate guard', () => {
  test('splitting with an id already in the tree does not create a duplicate leaf', () => {
    const t = twoPane();
    // Simulate reconcile having already added %3 before the split RPC returns
    t.addUnknown('%3');
    t.split('%1', 'h', '%3');
    const ids = t.paneIds();
    expect(ids.filter((id) => id === '%3').length).toBe(1);
  });
});
