import { describe, test, expect } from 'bun:test';
import { isExecutableMagic, parseSha256Sums } from '../update';

const ELF = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);
const MACHO_64_LE = new Uint8Array([0xcf, 0xfa, 0xed, 0xfe, 0x07, 0x00, 0x00, 0x01]);
const MACHO_FAT_BE = new Uint8Array([0xca, 0xfe, 0xba, 0xbe, 0x00, 0x00, 0x00, 0x02]);
const NOT_EXEC = new Uint8Array([0x3c, 0x21, 0x44, 0x4f, 0x43, 0x54, 0x59]); // '<!DOCTY'

describe('isExecutableMagic', () => {
  test('accepts ELF for linux binary', () => {
    expect(isExecutableMagic(ELF, 'cchub-linux-x64')).toBe(true);
  });

  test('rejects non-ELF for linux binary', () => {
    expect(isExecutableMagic(MACHO_64_LE, 'cchub-linux-x64')).toBe(false);
    expect(isExecutableMagic(NOT_EXEC, 'cchub-linux-x64')).toBe(false);
  });

  test('accepts Mach-O thin and fat for macos binary', () => {
    expect(isExecutableMagic(MACHO_64_LE, 'cchub-macos-arm64')).toBe(true);
    expect(isExecutableMagic(MACHO_FAT_BE, 'cchub-macos-arm64')).toBe(true);
  });

  test('rejects ELF for macos binary', () => {
    expect(isExecutableMagic(ELF, 'cchub-macos-arm64')).toBe(false);
  });

  test('rejects truncated input', () => {
    expect(isExecutableMagic(new Uint8Array([0x7f, 0x45]), 'cchub-linux-x64')).toBe(false);
    expect(isExecutableMagic(new Uint8Array(), 'cchub-linux-x64')).toBe(false);
  });

  test('unknown platform falls back to permissive', () => {
    expect(isExecutableMagic(NOT_EXEC, 'cchub-something-else')).toBe(true);
  });
});

describe('parseSha256Sums', () => {
  const sample = [
    'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789  cchub-linux-x64',
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef *cchub-macos-arm64',
    '',
    '# comment',
  ].join('\n');

  test('extracts hash by name (BSD or GNU format)', () => {
    expect(parseSha256Sums(sample, 'cchub-linux-x64')).toBe(
      'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    );
    expect(parseSha256Sums(sample, 'cchub-macos-arm64')).toBe(
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    );
  });

  test('returns null for unknown binary', () => {
    expect(parseSha256Sums(sample, 'cchub-windows-x64')).toBe(null);
  });

  test('returns null for empty input', () => {
    expect(parseSha256Sums('', 'cchub-linux-x64')).toBe(null);
  });

  test('ignores malformed lines', () => {
    const bad = 'not-a-hash cchub-linux-x64\n  cchub-linux-x64';
    expect(parseSha256Sums(bad, 'cchub-linux-x64')).toBe(null);
  });

  test('hex casing is normalised to lower case', () => {
    const upper = 'ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789  cchub-linux-x64';
    expect(parseSha256Sums(upper, 'cchub-linux-x64')).toBe(
      'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    );
  });
});
