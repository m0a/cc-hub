import { describe, expect, test } from 'bun:test';
import { isSafePeerUrl } from '../../src/services/peer-url';

// Regression for #235: peer URLs are fetched server-side (with the stored
// wsToken attached), so an attacker-chosen URL is an SSRF primitive. Only
// https to non-local hosts (incl. Tailscale ranges) is allowed.

describe('isSafePeerUrl', () => {
  test('allows https Tailscale hosts/IPs (legitimate peers)', () => {
    expect(isSafePeerUrl('https://beelink-arch.tail4459c9.ts.net:5923')).toBe(true);
    expect(isSafePeerUrl('https://100.91.210.90:5923')).toBe(true); // Tailscale CGNAT 100.64/10
    expect(isSafePeerUrl('https://example.com')).toBe(true);
    expect(isSafePeerUrl('https://[fd7a:115c:a1e0::1]:5923')).toBe(true); // Tailscale ULA
  });

  test('rejects non-https schemes', () => {
    for (const u of [
      'http://100.91.210.90:5923',
      'file:///etc/passwd',
      'gopher://127.0.0.1:6379/_INFO',
      'javascript:alert(1)',
      'ftp://example.com',
    ]) {
      expect(isSafePeerUrl(u)).toBe(false);
    }
  });

  test('rejects loopback / link-local / private hosts even over https', () => {
    for (const u of [
      'https://127.0.0.1:5923',
      'https://localhost:5923',
      'https://169.254.169.254/latest/meta-data/', // cloud metadata
      'https://10.0.0.5/admin',
      'https://172.16.0.1',
      'https://192.168.1.1',
      'https://[::1]:5923',
      'https://[fe80::1]',
      'https://0.0.0.0',
    ]) {
      expect(isSafePeerUrl(u)).toBe(false);
    }
  });

  test('rejects garbage', () => {
    expect(isSafePeerUrl('not a url')).toBe(false);
    expect(isSafePeerUrl('')).toBe(false);
  });
});
