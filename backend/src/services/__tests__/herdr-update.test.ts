import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildHerdrApplyCommands, parseHerdrStatus } from '../herdr-update';

/**
 * #393: `herdr update` swaps the binary but leaves the running server on the
 * old version, and cchub spawns the binary to drive panes. The parser has to
 * catch that skew, but a herdr release that changes the status format must
 * degrade to silence — a false "restart your server" nag costs the user every
 * running command in every pane.
 */
describe('parseHerdrStatus', () => {
  // Real `herdr status --json` output (herdr 0.7.3, protocol 16).
  const healthy = JSON.stringify({
    client: { version: '0.7.3', channel: 'stable', protocol: 16, binary: '/home/u/.local/bin/herdr', session: null },
    server: {
      status: 'running',
      running: true,
      version: '0.7.3',
      protocol: 16,
      capabilities: { live_handoff: true, detached_server_daemon: true },
      compatible: true,
      socket: '/home/u/.config/herdr/herdr.sock',
      session: null,
      restart_needed: false,
    },
    update: { restart_needed: false },
  });

  it('reports no skew when binary and server match', () => {
    expect(parseHerdrStatus(healthy)).toEqual({
      binaryVersion: '0.7.3',
      serverVersion: '0.7.3',
      restartNeeded: false,
    });
  });

  it('detects skew from differing versions', () => {
    const raw = JSON.stringify({
      client: { version: '0.7.4' },
      server: { running: true, version: '0.7.3' },
    });
    expect(parseHerdrStatus(raw)?.restartNeeded).toBe(true);
  });

  it('honors herdr update.restart_needed even when versions read equal', () => {
    const raw = JSON.stringify({
      client: { version: '0.7.3' },
      server: { running: true, version: '0.7.3' },
      update: { restart_needed: true },
    });
    expect(parseHerdrStatus(raw)?.restartNeeded).toBe(true);
  });

  it('treats an incompatible server as needing a restart', () => {
    const raw = JSON.stringify({
      client: { version: '0.8.0' },
      server: { running: true, version: '0.8.0', compatible: false },
    });
    expect(parseHerdrStatus(raw)?.restartNeeded).toBe(true);
  });

  it('exposes both versions so the UI can name them', () => {
    const raw = JSON.stringify({
      client: { version: '0.7.4' },
      server: { running: true, version: '0.7.3' },
    });
    const reading = parseHerdrStatus(raw);
    expect(reading?.binaryVersion).toBe('0.7.4');
    expect(reading?.serverVersion).toBe('0.7.3');
  });

  it('ignores unknown fields a newer herdr may add', () => {
    const raw = JSON.stringify({
      client: { version: '0.7.3', someNewField: 'x' },
      server: { running: true, version: '0.7.3', futureFlag: 42 },
      update: { restart_needed: false },
      brandNewSection: { anything: true },
    });
    expect(parseHerdrStatus(raw)?.restartNeeded).toBe(false);
  });

  // Everything below must not warn: unreadable input means "don't know".
  it.each([
    ['empty output', ''],
    ['non-JSON text output', 'status: running\nversion: 0.7.3\ncompatible: yes'],
    ['a JSON array', '[]'],
    ['a JSON scalar', '"running"'],
    ['truncated JSON', '{"client":{"version":"0.7.3"'],
    ['a usage error from an older herdr', 'error: unknown flag --json'],
  ])('returns null for %s', (_label, raw) => {
    expect(parseHerdrStatus(raw)).toBeNull();
  });

  it('stays silent when the server is not running', () => {
    const raw = JSON.stringify({
      client: { version: '0.7.4' },
      server: { status: 'stopped', running: false },
    });
    expect(parseHerdrStatus(raw)).toBeNull();
  });

  it('stays silent when the running flag is missing or renamed', () => {
    const raw = JSON.stringify({
      client: { version: '0.7.4' },
      server: { state: 'up', version: '0.7.3' },
    });
    expect(parseHerdrStatus(raw)).toBeNull();
  });

  it('does not infer skew from a missing or blank version', () => {
    for (const server of [{ running: true }, { running: true, version: '' }, { running: true, version: null }]) {
      const raw = JSON.stringify({ client: { version: '0.7.4' }, server });
      expect(parseHerdrStatus(raw)?.restartNeeded).toBe(false);
    }
    const noClient = JSON.stringify({ client: {}, server: { running: true, version: '0.7.3' } });
    expect(parseHerdrStatus(noClient)?.restartNeeded).toBe(false);
  });

  it('does not treat non-boolean restart_needed as a signal', () => {
    const raw = JSON.stringify({
      client: { version: '0.7.3' },
      server: { running: true, version: '0.7.3' },
      update: { restart_needed: 'maybe' },
    });
    expect(parseHerdrStatus(raw)?.restartNeeded).toBe(false);
  });
});

/**
 * `--handoff` is banned: the handed-off server escapes systemd/launchd and
 * fights `Restart=always`. Unsupervised herdr gets no button at all, since
 * `systemctl restart` would be a silent no-op there.
 */
describe('buildHerdrApplyCommands', () => {
  it('updates then restarts the systemd user unit', () => {
    expect(buildHerdrApplyCommands('systemd', '/home/u/.local/bin/herdr', 1000)).toEqual([
      ['/home/u/.local/bin/herdr', 'update'],
      ['systemctl', '--user', 'restart', 'herdr'],
    ]);
  });

  it('updates then kickstarts the launchd job on macOS', () => {
    expect(buildHerdrApplyCommands('launchd', '/opt/homebrew/bin/herdr', 501)).toEqual([
      ['/opt/homebrew/bin/herdr', 'update'],
      ['launchctl', 'kickstart', '-k', 'gui/501/com.herdr.server'],
    ]);
  });

  it('refuses to act when nothing supervises herdr', () => {
    expect(buildHerdrApplyCommands('unmanaged', '/usr/bin/herdr', 1000)).toBeNull();
  });

  it('never passes --handoff', () => {
    for (const supervisor of ['systemd', 'launchd'] as const) {
      const flat = (buildHerdrApplyCommands(supervisor, 'herdr', 1000) ?? []).flat();
      expect(flat).not.toContain('--handoff');
    }
  });

  it('updates before restarting so a failed download never bounces the server', () => {
    const commands = buildHerdrApplyCommands('systemd', 'herdr', 1000) ?? [];
    expect(commands[0]).toContain('update');
    expect(commands[1]).toContain('restart');
  });
});

/**
 * `cchub update --auto` runs unattended from a timer. Restarting herdr there
 * would silently kill whatever builds/tests/long jobs were running in every
 * pane overnight, so the auto path must never reach herdr — hence this guard
 * on the source itself rather than on behavior.
 */
describe('cchub update timer', () => {
  it('never touches herdr', () => {
    const source = readFileSync(join(import.meta.dir, '../../commands/update.ts'), 'utf-8');
    expect(source).not.toMatch(/herdr/i);
  });
});
