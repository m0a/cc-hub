/**
 * tmux control mode octal encoding/decoding utilities.
 *
 * tmux -CC encodes %output data:
 *   - Characters < 32 (control chars) and 0x7F (DEL) as \NNN (octal, 3 digits)
 *   - Backslash as \\
 *   - All other bytes (including UTF-8 high bytes 0x80-0xFF) are sent as-is
 *
 * Since Node.js decodes the tmux stdout as UTF-8, multi-byte sequences
 * become single Unicode characters. The decoder must re-encode these
 * back to UTF-8 bytes.
 *
 * For send-keys -H, input bytes are encoded as space-separated hex pairs.
 */

const textEncoder = new TextEncoder();

/**
 * Decode tmux %output octal-escaped string into a Buffer.
 *
 * The input string has already been UTF-8 decoded by Node.js, so
 * multi-byte characters (e.g. Japanese) appear as single Unicode chars.
 * We re-encode them to UTF-8 bytes for the output Buffer.
 */
export function decodeOctalOutput(encoded: string): Buffer {
  const bytes: number[] = [];
  let i = 0;

  while (i < encoded.length) {
    if (encoded[i] === '\\' && i + 1 < encoded.length) {
      if (encoded[i + 1] === '\\') {
        // Escaped backslash
        bytes.push(0x5c);
        i += 2;
      } else if (
        i + 3 < encoded.length &&
        encoded[i + 1] >= '0' && encoded[i + 1] <= '3' &&
        encoded[i + 2] >= '0' && encoded[i + 2] <= '7' &&
        encoded[i + 3] >= '0' && encoded[i + 3] <= '7'
      ) {
        // Octal escape \NNN
        const octal = encoded.substring(i + 1, i + 4);
        bytes.push(parseInt(octal, 8));
        i += 4;
      } else {
        // Not a valid escape, pass through
        bytes.push(encoded.charCodeAt(i));
        i++;
      }
    } else {
      const code = encoded.charCodeAt(i);
      if (code < 128) {
        // ASCII byte - push directly
        bytes.push(code);
        i++;
      } else {
        // Non-ASCII: re-encode the Unicode character back to UTF-8 bytes.
        // This handles characters like Japanese that tmux passed as raw
        // UTF-8 bytes but Node.js decoded into Unicode code points.
        //
        // Use codePointAt() to correctly handle non-BMP characters (emoji,
        // rare CJK, etc.) which are stored as surrogate pairs in JS strings.
        // encoded[i] alone would be a lone surrogate → TextEncoder produces
        // U+FFFD (replacement character).
        const codePoint = encoded.codePointAt(i)!;
        const utf8 = textEncoder.encode(String.fromCodePoint(codePoint));
        for (const b of utf8) {
          bytes.push(b);
        }
        // Advance 1 for BMP (single code unit), 2 for non-BMP (surrogate pair)
        i += codePoint > 0xFFFF ? 2 : 1;
      }
    }
  }

  return Buffer.from(bytes);
}

/**
 * Encode a Buffer into hex pairs for `tmux send-keys -H`.
 * Returns space-separated hex values, e.g. "61 62 63" for "abc".
 */
export function encodeHexInput(data: Buffer): string {
  const hexPairs: string[] = [];
  for (const byte of data) {
    hexPairs.push(byte.toString(16).padStart(2, '0'));
  }
  return hexPairs.join(' ');
}
