/**
 * CC Hub-owned pane layout for herdr sessions.
 *
 * herdr's workspace grid cannot be resized headlessly (it stays at the
 * default client size when no interactive client is attached), so in herdr
 * mode CC Hub owns the split geometry itself: a binary split tree with
 * ratios, rendered to tmux-convention rects (siblings separated by one
 * cell, children partition the parent). The frontend keeps consuming
 * `TmuxLayoutNode` unchanged.
 */

import type { TmuxLayoutNode } from '../../../shared/types';

export interface LeafNode {
  type: 'leaf';
  paneId: string; // tmux-style "%N"
}

export interface SplitNode {
  type: 'split';
  // 'h' = children side-by-side (tmux 'horizontal'), 'v' = stacked
  dir: 'h' | 'v';
  ratio: number; // share of the first child, 0.1..0.9
  a: LayoutNode;
  b: LayoutNode;
}

export type LayoutNode = LeafNode | SplitNode;

export interface PaneRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MIN_RATIO = 0.1;
const MAX_RATIO = 0.9;

export class PaneLayoutTree {
  private root: LayoutNode | null = null;
  private zoomedPane: string | null = null;

  /** Initialize from an existing pane list (chained side-by-side, even). */
  setInitialPanes(paneIds: string[]): void {
    this.root = null;
    this.zoomedPane = null;
    for (const id of paneIds) {
      if (!this.root) {
        this.root = { type: 'leaf', paneId: id };
      } else {
        this.root = { type: 'split', dir: 'h', ratio: 0.5, a: this.root, b: { type: 'leaf', paneId: id } };
      }
    }
  }

  paneIds(): string[] {
    const out: string[] = [];
    const walk = (n: LayoutNode | null): void => {
      if (!n) return;
      if (n.type === 'leaf') {
        out.push(n.paneId);
      } else {
        walk(n.a);
        walk(n.b);
      }
    };
    walk(this.root);
    return out;
  }

  has(paneId: string): boolean {
    return this.paneIds().includes(paneId);
  }

  get zoomed(): string | null {
    return this.zoomedPane;
  }

  /** Split `target` in two; `newPane` becomes the second child. */
  split(target: string, dir: 'h' | 'v', newPane: string): void {
    const replace = (n: LayoutNode): LayoutNode => {
      if (n.type === 'leaf') {
        if (n.paneId !== target) return n;
        return { type: 'split', dir, ratio: 0.5, a: n, b: { type: 'leaf', paneId: newPane } };
      }
      return { ...n, a: replace(n.a), b: replace(n.b) };
    };
    if (this.root) this.root = replace(this.root);
    this.zoomedPane = null;
  }

  /** Append a pane we discovered but didn't create (external split etc.). */
  addUnknown(paneId: string): void {
    if (this.has(paneId)) return;
    if (!this.root) {
      this.root = { type: 'leaf', paneId };
    } else {
      this.root = { type: 'split', dir: 'h', ratio: 0.5, a: this.root, b: { type: 'leaf', paneId } };
    }
  }

  /** Remove a pane; its sibling takes the parent's slot. */
  remove(paneId: string): void {
    const prune = (n: LayoutNode): LayoutNode | null => {
      if (n.type === 'leaf') {
        return n.paneId === paneId ? null : n;
      }
      const a = prune(n.a);
      const b = prune(n.b);
      if (a && b) return { ...n, a, b };
      return a ?? b;
    };
    if (this.root) this.root = prune(this.root);
    if (this.zoomedPane === paneId) this.zoomedPane = null;
  }

  toggleZoom(paneId: string): void {
    this.zoomedPane = this.zoomedPane === paneId ? null : paneId;
  }

  /**
   * Nudge the split ratio of the nearest ancestor split matching the
   * direction. L/R adjust an 'h' split, U/D adjust a 'v' split; amount is
   * in cells relative to the total client size.
   */
  adjust(paneId: string, direction: 'L' | 'R' | 'U' | 'D', amountCells: number, totalCols: number, totalRows: number): void {
    const wantDir: 'h' | 'v' = direction === 'L' || direction === 'R' ? 'h' : 'v';
    const total = wantDir === 'h' ? totalCols : totalRows;
    if (total <= 0) return;
    const delta = (amountCells / total) * (direction === 'L' || direction === 'U' ? -1 : 1);

    // Find the deepest matching-direction split that contains the pane.
    let found: SplitNode | null = null;
    let foundInFirst = false;
    const walk = (n: LayoutNode): boolean => {
      if (n.type === 'leaf') return n.paneId === paneId;
      const inA = walk(n.a);
      const inB = inA ? false : walk(n.b);
      if ((inA || inB) && n.dir === wantDir && !found) {
        found = n;
        foundInFirst = inA;
      }
      return inA || inB;
    };
    if (this.root) walk(this.root);
    if (found) {
      const node = found as SplitNode;
      // Growing the pane means growing whichever child it sits in.
      const signed = foundInFirst ? delta : -delta;
      node.ratio = Math.min(MAX_RATIO, Math.max(MIN_RATIO, node.ratio + signed));
    }
  }

  /** Reset every split of the given orientation to an even ratio. */
  equalize(direction: 'horizontal' | 'vertical'): void {
    const dir: 'h' | 'v' = direction === 'horizontal' ? 'h' : 'v';
    const walk = (n: LayoutNode): void => {
      if (n.type !== 'split') return;
      if (n.dir === dir) n.ratio = 0.5;
      walk(n.a);
      walk(n.b);
    };
    if (this.root) walk(this.root);
  }

  /**
   * Compute integer cell rects for every pane at the given client size,
   * tmux convention: children partition the parent with a 1-cell separator.
   * A zoomed pane occupies the full client area.
   */
  computeRects(cols: number, rows: number): Map<string, PaneRect> {
    const rects = new Map<string, PaneRect>();
    if (this.zoomedPane && this.has(this.zoomedPane)) {
      rects.set(this.zoomedPane, { x: 0, y: 0, width: cols, height: rows });
      return rects;
    }
    const assign = (n: LayoutNode, rect: PaneRect): void => {
      if (n.type === 'leaf') {
        rects.set(n.paneId, rect);
        return;
      }
      if (n.dir === 'h') {
        const usable = rect.width - 1; // 1-col separator
        const wa = Math.max(1, Math.round(usable * n.ratio));
        const wb = Math.max(1, usable - wa);
        assign(n.a, { x: rect.x, y: rect.y, width: wa, height: rect.height });
        assign(n.b, { x: rect.x + wa + 1, y: rect.y, width: wb, height: rect.height });
      } else {
        const usable = rect.height - 1; // 1-row separator
        const ha = Math.max(1, Math.round(usable * n.ratio));
        const hb = Math.max(1, usable - ha);
        assign(n.a, { x: rect.x, y: rect.y, width: rect.width, height: ha });
        assign(n.b, { x: rect.x, y: rect.y + ha + 1, width: rect.width, height: hb });
      }
    };
    if (this.root) assign(this.root, { x: 0, y: 0, width: cols, height: rows });
    return rects;
  }

  /** Render the tree as a TmuxLayoutNode for the frontend. */
  toTmuxLayout(cols: number, rows: number): TmuxLayoutNode | null {
    if (!this.root) return null;
    if (this.zoomedPane && this.has(this.zoomedPane)) {
      return {
        type: 'leaf',
        width: cols,
        height: rows,
        x: 0,
        y: 0,
        paneId: paneNumber(this.zoomedPane),
      };
    }
    const rects = this.computeRects(cols, rows);
    const convert = (n: LayoutNode, rect: PaneRect): TmuxLayoutNode => {
      if (n.type === 'leaf') {
        const r = rects.get(n.paneId) ?? rect;
        return {
          type: 'leaf',
          width: r.width,
          height: r.height,
          x: r.x,
          y: r.y,
          paneId: paneNumber(n.paneId),
        };
      }
      const childRect = (child: LayoutNode): PaneRect => boundingRect(child, rects) ?? rect;
      return {
        type: n.dir === 'h' ? 'horizontal' : 'vertical',
        width: rect.width,
        height: rect.height,
        x: rect.x,
        y: rect.y,
        children: [convert(n.a, childRect(n.a)), convert(n.b, childRect(n.b))],
      };
    };
    return convert(this.root, { x: 0, y: 0, width: cols, height: rows });
  }
}

function paneNumber(tmuxPaneId: string): number {
  return Number.parseInt(tmuxPaneId.slice(1), 10);
}

function boundingRect(n: LayoutNode, rects: Map<string, PaneRect>): PaneRect | null {
  if (n.type === 'leaf') return rects.get(n.paneId) ?? null;
  const a = boundingRect(n.a, rects);
  const b = boundingRect(n.b, rects);
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}
