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
 * Decode tmux octal-escaped RAW BYTES into a Buffer.
 *
 * Unlike decodeOctalOutput() which works on a UTF-8 decoded string, this
 * function operates directly on raw bytes from tmux stdout.  This is
 * critical for %output data because tmux may split multi-byte UTF-8
 * sequences across %output lines.  Processing raw bytes avoids the
 * StringDecoder UTF-8 corruption that occurs when a 3/4-byte sequence
 * is interrupted by a newline.
 *
 * The function only interprets octal escapes (\NNN) and backslash
 * escapes (\\).  All other bytes (including raw UTF-8 high bytes
 * 0x80-0xFF) pass through as-is.
 */
export function decodeOctalOutputRaw(data: Buffer): Buffer {
  const result: number[] = [];
  let i = 0;

  while (i < data.length) {
    if (data[i] === 0x5c && i + 1 < data.length) {
      // Backslash (0x5C)
      if (data[i + 1] === 0x5c) {
        // Escaped backslash: \\ → \
        result.push(0x5c);
        i += 2;
      } else if (
        i + 3 < data.length &&
        data[i + 1] >= 0x30 && data[i + 1] <= 0x33 && // '0'-'3'
        data[i + 2] >= 0x30 && data[i + 2] <= 0x37 && // '0'-'7'
        data[i + 3] >= 0x30 && data[i + 3] <= 0x37    // '0'-'7'
      ) {
        // Octal escape \NNN → single byte
        const value =
          (data[i + 1] - 0x30) * 64 +
          (data[i + 2] - 0x30) * 8 +
          (data[i + 3] - 0x30);
        result.push(value);
        i += 4;
      } else {
        // Not a valid escape, pass through
        result.push(data[i]);
        i++;
      }
    } else {
      // All other bytes pass through as-is (including 0x80-0xFF raw UTF-8)
      result.push(data[i]);
      i++;
    }
  }

  return Buffer.from(result);
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
