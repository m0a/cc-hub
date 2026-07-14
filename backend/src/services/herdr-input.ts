/**
 * VT input → herdr send_input translation.
 *
 * The frontend (xterm.js) emits raw terminal input bytes: printable text
 * mixed with control bytes and escape sequences. herdr's `pane.send_input`
 * deliberately treats `text` as literal (newlines are stripped so agents
 * can't inject Enter); control input must be expressed as named `keys`.
 * This module splits an input buffer into an ordered list of text / keys
 * operations that reproduce the original byte stream.
 */

export type HerdrInputOp = { text: string } | { keys: string[] };

// CSI escape sequences → herdr key names
const CSI_KEYS: Record<string, string> = {
  '[A': 'up',
  '[B': 'down',
  '[C': 'right',
  '[D': 'left',
  '[H': 'home',
  '[F': 'end',
  '[Z': 'shift+tab',
  '[2~': 'insert',
  '[3~': 'delete',
  '[5~': 'pageup',
  '[6~': 'pagedown',
  '[1~': 'home',
  '[4~': 'end',
  '[1;5A': 'ctrl+up',
  '[1;5B': 'ctrl+down',
  '[1;5C': 'ctrl+right',
  '[1;5D': 'ctrl+left',
  '[1;2A': 'shift+up',
  '[1;2B': 'shift+down',
  '[1;2C': 'shift+right',
  '[1;2D': 'shift+left',
  // application cursor mode (DECCKM)
  OA: 'up',
  OB: 'down',
  OC: 'right',
  OD: 'left',
  OH: 'home',
  OF: 'end',
  // F1-F4
  OP: 'f1',
  OQ: 'f2',
  OR: 'f3',
  OS: 'f4',
  '[15~': 'f5',
  '[17~': 'f6',
  '[18~': 'f7',
  '[19~': 'f8',
  '[20~': 'f9',
  '[21~': 'f10',
  '[23~': 'f11',
  '[24~': 'f12',
};

// Bracketed paste markers: herdr has no paste concept; we strip the markers
// and let the payload flow as text (newlines inside become 'enter' keys).
const PASTE_START = '[200~';
const PASTE_END = '[201~';

/**
 * Translate raw VT input bytes into ordered herdr send_input operations.
 * Consecutive key presses coalesce into one { keys } op; printable runs
 * (including all non-ASCII UTF-8) become { text } ops.
 */
export function translateInput(data: Buffer): HerdrInputOp[] {
  const s = data.toString('utf-8');
  const ops: HerdrInputOp[] = [];
  let textRun = '';
  let keyRun: string[] = [];

  const flushText = () => {
    if (textRun) {
      ops.push({ text: textRun });
      textRun = '';
    }
  };
  const flushKeys = () => {
    if (keyRun.length) {
      ops.push({ keys: keyRun });
      keyRun = [];
    }
  };
  const pushKey = (key: string) => {
    flushText();
    keyRun.push(key);
  };
  const pushText = (ch: string) => {
    flushKeys();
    textRun += ch;
  };

  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    const code = s.charCodeAt(i);

    if (ch === '\x1b') {
      // Try to match a known escape sequence (longest first: 6..2 chars)
      let matched = false;
      for (let len = 6; len >= 2; len--) {
        const seq = s.slice(i + 1, i + 1 + len);
        if (seq === PASTE_START || seq === PASTE_END) {
          // Strip paste markers entirely
          i += 1 + len;
          matched = true;
          break;
        }
        const key = CSI_KEYS[seq];
        if (key) {
          pushKey(key);
          i += 1 + len;
          matched = true;
          break;
        }
      }
      if (matched) continue;

      const next = s[i + 1];
      if (next && next >= ' ' && next <= '~' && next !== '[' && next !== 'O') {
        // ESC + printable = Meta/Alt chord
        pushKey(`alt+${next.toLowerCase()}`);
        i += 2;
        continue;
      }
      if (next === '[' || next === 'O') {
        // Unknown CSI sequence — consume through its terminator so the
        // parameters don't leak into the pane as literal text.
        let j = i + 2;
        while (j < s.length && !/[a-zA-Z~]/.test(s[j])) j++;
        i = Math.min(j + 1, s.length);
        continue;
      }
      // Lone ESC
      pushKey('escape');
      i += 1;
      continue;
    }

    if (ch === '\r' || ch === '\n') {
      pushKey('enter');
      i += 1;
      continue;
    }
    if (ch === '\t') {
      pushKey('tab');
      i += 1;
      continue;
    }
    if (code === 0x7f || code === 0x08) {
      pushKey('backspace');
      i += 1;
      continue;
    }
    if (code < 0x20) {
      // Ctrl+A .. Ctrl+Z (minus the ones handled above)
      if (code >= 0x01 && code <= 0x1a) {
        pushKey(`ctrl+${String.fromCharCode(0x60 + code)}`);
      }
      // Other C0 controls have no herdr key name; drop them.
      i += 1;
      continue;
    }

    pushText(ch);
    i += 1;
  }

  flushText();
  flushKeys();
  return ops;
}
