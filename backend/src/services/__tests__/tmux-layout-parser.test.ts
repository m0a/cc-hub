import { describe, test, expect } from 'bun:test';
import { parseTmuxLayout, toFrontendLayout } from '../tmux-layout-parser';

describe('parseTmuxLayout', () => {
  test('single pane', () => {
    // Simple single pane: checksum,80x24,0,0,0
    const result = parseTmuxLayout('a1b2,80x24,0,0,0');
    expect(result.type).toBe('leaf');
    expect(result.width).toBe(80);
    expect(result.height).toBe(24);
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
    expect(result.paneId).toBe(0);
  });

  test('horizontal split (two panes side by side)', () => {
    // Horizontal split: checksum,80x24,0,0{40x24,0,0,0,39x24,41,0,1}
    const result = parseTmuxLayout('a1b2,80x24,0,0{40x24,0,0,0,39x24,41,0,1}');
    expect(result.type).toBe('horizontal');
    expect(result.width).toBe(80);
    expect(result.height).toBe(24);
    expect(result.children).toHaveLength(2);
    expect(result.children![0].type).toBe('leaf');
    expect(result.children![0].width).toBe(40);
    expect(result.children![0].paneId).toBe(0);
    expect(result.children![1].type).toBe('leaf');
    expect(result.children![1].width).toBe(39);
    expect(result.children![1].paneId).toBe(1);
  });

  test('vertical split (two panes stacked)', () => {
    // Vertical split: checksum,80x24,0,0[80x12,0,0,0,80x11,0,13,1]
    const result = parseTmuxLayout('a1b2,80x24,0,0[80x12,0,0,0,80x11,0,13,1]');
    expect(result.type).toBe('vertical');
    expect(result.children).toHaveLength(2);
    expect(result.children![0].type).toBe('leaf');
    expect(result.children![0].height).toBe(12);
    expect(result.children![0].paneId).toBe(0);
    expect(result.children![1].type).toBe('leaf');
    expect(result.children![1].height).toBe(11);
    expect(result.children![1].paneId).toBe(1);
  });

  test('nested split', () => {
    // Horizontal split with left pane split vertically:
    // checksum,80x24,0,0{40x24,0,0[40x12,0,0,0,40x11,0,13,2],39x24,41,0,1}
    const result = parseTmuxLayout('a1b2,80x24,0,0{40x24,0,0[40x12,0,0,0,40x11,0,13,2],39x24,41,0,1}');
    expect(result.type).toBe('horizontal');
    expect(result.children).toHaveLength(2);

    // Left child: vertical split
    const left = result.children![0];
    expect(left.type).toBe('vertical');
    expect(left.children).toHaveLength(2);
    expect(left.children![0].paneId).toBe(0);
    expect(left.children![1].paneId).toBe(2);

    // Right child: leaf
    const right = result.children![1];
    expect(right.type).toBe('leaf');
    expect(right.paneId).toBe(1);
  });

  test('three-way horizontal split', () => {
    const result = parseTmuxLayout('a1b2,120x24,0,0{40x24,0,0,0,39x24,41,0,1,39x24,81,0,2}');
    expect(result.type).toBe('horizontal');
    expect(result.children).toHaveLength(3);
    expect(result.children![0].paneId).toBe(0);
    expect(result.children![1].paneId).toBe(1);
    expect(result.children?.[2].paneId).toBe(2);
  });
});

describe('toFrontendLayout', () => {
  test('single pane converts to terminal', () => {
    const node = parseTmuxLayout('a1b2,80x24,0,0,0');
    const result = toFrontendLayout(node);
    expect(result.type).toBe('terminal');
    if (result.type === 'terminal') {
      expect(result.id).toBe('%0');
      expect(result.sessionId).toBeNull();
    }
  });

  test('horizontal split ratio calculation', () => {
    const node = parseTmuxLayout('a1b2,80x24,0,0{40x24,0,0,0,40x24,40,0,1}');
    const result = toFrontendLayout(node);
    expect(result.type).toBe('split');
    if (result.type === 'split') {
      expect(result.direction).toBe('horizontal');
      expect(result.ratio).toHaveLength(2);
      expect(result.ratio[0]).toBeCloseTo(50);
      expect(result.ratio[1]).toBeCloseTo(50);
    }
  });

  test('uneven split ratio', () => {
    const node = parseTmuxLayout('a1b2,120x24,0,0{80x24,0,0,0,40x24,80,0,1}');
    const result = toFrontendLayout(node);
    if (result.type === 'split') {
      // 80/120 ≈ 66.7%, 40/120 ≈ 33.3%
      expect(result.ratio[0]).toBeCloseTo(66.67, 1);
      expect(result.ratio[1]).toBeCloseTo(33.33, 1);
    }
  });

  test('nested split preserves structure', () => {
    const node = parseTmuxLayout('a1b2,80x24,0,0{40x24,0,0[40x12,0,0,0,40x11,0,13,2],39x24,41,0,1}');
    const result = toFrontendLayout(node);
    expect(result.type).toBe('split');
    if (result.type === 'split') {
      expect(result.direction).toBe('horizontal');
      expect(result.children[0].type).toBe('split');
      if (result.children[0].type === 'split') {
        expect(result.children[0].direction).toBe('vertical');
      }
      expect(result.children[1].type).toBe('terminal');
    }
  });
});
