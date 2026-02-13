/**
 * tmux control mode octal encoding/decoding utilities.
 *
 * tmux -CC encodes %output data:
 *   - Characters < 32 (control chars) as \NNN (octal, 3 digits)
 *   - Backslash as \\
 *   - All other bytes are sent as-is
 *
 * For send-keys -H, input bytes are encoded as space-separated hex pairs.
 */

/**
 * Decode tmux %output octal-escaped string into a Buffer.
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
      bytes.push(encoded.charCodeAt(i));
      i++;
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
