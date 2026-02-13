/**
 * Parse tmux layout strings into a tree structure.
 *
 * tmux layout format:
 *   checksum,WxH,X,Y{child1,child2}   - horizontal split
 *   checksum,WxH,X,Y[child1,child2]   - vertical split
 *   WxH,X,Y,paneNumber                - leaf pane
 *
 * Example: "a]b2,80x24,0,0{40x24,0,0,0,39x24,41,0,1}"
 *   → horizontal split with two leaf panes
 */

import type { TmuxLayoutNode } from '../../../shared/types';

interface ParseResult {
  node: TmuxLayoutNode;
  consumed: number;
}

/**
 * Parse a tmux layout string into a TmuxLayoutNode tree.
 * The input should be the raw layout string from tmux (e.g. from %layout-change).
 *
 * The layout string starts with a hex checksum followed by a comma,
 * then the root layout description.
 */
export function parseTmuxLayout(layoutString: string): TmuxLayoutNode {
  // Strip the leading checksum (hex chars followed by comma)
  const checksumEnd = layoutString.indexOf(',');
  if (checksumEnd === -1) {
    throw new Error(`Invalid layout string: no checksum separator found`);
  }

  const body = layoutString.substring(checksumEnd + 1);
  const result = parseNode(body, 0);
  return result.node;
}

function parseNode(s: string, pos: number): ParseResult {
  // Parse dimensions: WxH,X,Y
  const dims = parseDimensions(s, pos);
  const { width, height, x, y } = dims;
  pos = dims.nextPos;

  // Check what follows: '{' (horizontal), '[' (vertical), ',' (leaf pane number), or end
  if (pos >= s.length || s[pos] === ',' || s[pos] === '}' || s[pos] === ']') {
    // This could be a leaf if followed by comma + pane number, or end
    if (pos < s.length && s[pos] === ',') {
      // Could be leaf pane number or next sibling
      // Try to parse pane number
      const paneResult = tryParsePaneNumber(s, pos + 1);
      if (paneResult !== null) {
        return {
          node: { type: 'leaf', width, height, x, y, paneId: paneResult.paneId },
          consumed: paneResult.nextPos,
        };
      }
    }
    // No pane number, return as leaf with no pane ID (shouldn't normally happen)
    return {
      node: { type: 'leaf', width, height, x, y },
      consumed: pos,
    };
  }

  if (s[pos] === '{' || s[pos] === '[') {
    // Split node
    const splitType = s[pos] === '{' ? 'horizontal' : 'vertical';
    const closeChar = s[pos] === '{' ? '}' : ']';
    pos++; // skip opening bracket

    const children: TmuxLayoutNode[] = [];

    while (pos < s.length && s[pos] !== closeChar) {
      const childResult = parseNode(s, pos);
      children.push(childResult.node);
      pos = childResult.consumed;

      // Skip comma between siblings
      if (pos < s.length && s[pos] === ',') {
        pos++;
      }
    }

    // Skip closing bracket
    if (pos < s.length && s[pos] === closeChar) {
      pos++;
    }

    return {
      node: { type: splitType, width, height, x, y, children },
      consumed: pos,
    };
  }

  // Fallback: treat as leaf
  return {
    node: { type: 'leaf', width, height, x, y },
    consumed: pos,
  };
}

function parseDimensions(s: string, pos: number): { width: number; height: number; x: number; y: number; nextPos: number } {
  // Parse W
  let numStr = '';
  while (pos < s.length && s[pos] >= '0' && s[pos] <= '9') {
    numStr += s[pos++];
  }
  const width = parseInt(numStr, 10);

  // Expect 'x'
  if (pos < s.length && s[pos] === 'x') pos++;

  // Parse H
  numStr = '';
  while (pos < s.length && s[pos] >= '0' && s[pos] <= '9') {
    numStr += s[pos++];
  }
  const height = parseInt(numStr, 10);

  // Expect ','
  if (pos < s.length && s[pos] === ',') pos++;

  // Parse X
  numStr = '';
  while (pos < s.length && s[pos] >= '0' && s[pos] <= '9') {
    numStr += s[pos++];
  }
  const x = parseInt(numStr, 10);

  // Expect ','
  if (pos < s.length && s[pos] === ',') pos++;

  // Parse Y
  numStr = '';
  while (pos < s.length && s[pos] >= '0' && s[pos] <= '9') {
    numStr += s[pos++];
  }
  const y = parseInt(numStr, 10);

  return { width, height, x, y, nextPos: pos };
}

function tryParsePaneNumber(s: string, pos: number): { paneId: number; nextPos: number } | null {
  let numStr = '';
  let p = pos;
  while (p < s.length && s[p] >= '0' && s[p] <= '9') {
    numStr += s[p++];
  }
  if (numStr.length === 0) return null;

  // Pane number must be followed by end, comma, '}', or ']'
  if (p >= s.length || s[p] === ',' || s[p] === '}' || s[p] === ']') {
    return { paneId: parseInt(numStr, 10), nextPos: p };
  }

  // If followed by 'x', this is dimensions of next node, not a pane number
  if (s[p] === 'x') return null;

  return { paneId: parseInt(numStr, 10), nextPos: p };
}

/**
 * Convert TmuxLayoutNode to the frontend PaneNode format.
 * Calculates ratio arrays from absolute dimensions.
 */
export function toFrontendLayout(node: TmuxLayoutNode): {
  type: 'terminal';
  sessionId: null;
  id: string;
} | {
  type: 'split';
  direction: 'horizontal' | 'vertical';
  children: ReturnType<typeof toFrontendLayout>[];
  ratio: number[];
  id: string;
} {
  if (node.type === 'leaf') {
    return {
      type: 'terminal',
      sessionId: null,
      id: `%${node.paneId ?? 0}`,
    };
  }

  const children = (node.children || []).map(toFrontendLayout);

  // Calculate ratios from absolute sizes
  // tmux 'horizontal' split = side by side = our 'horizontal' (width-based ratio)
  // tmux 'vertical' split = stacked = our 'vertical' (height-based ratio)
  const isHorizontal = node.type === 'horizontal';
  const totalSize = node.children!.reduce(
    (sum, c) => sum + (isHorizontal ? c.width : c.height),
    0,
  );

  const ratio = node.children!.map(c => {
    const size = isHorizontal ? c.width : c.height;
    return totalSize > 0 ? (size / totalSize) * 100 : 100 / node.children!.length;
  });

  return {
    type: 'split',
    direction: isHorizontal ? 'horizontal' : 'vertical',
    children,
    ratio,
    id: `split-${node.x}-${node.y}`,
  };
}
