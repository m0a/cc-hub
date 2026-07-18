// cchub setup command - service registration (systemd on Linux, launchd on macOS)

import { mkdir, writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';
import { t } from '../i18n';
import { herdrBinaryPath } from '../services/herdr-client';
import { migrateCodexHooksToJson } from '../services/codex-hook-config';
import { storePassword as storePasswordInKeychain } from '../utils/keychain';

/** Escape special characters for safe inclusion in XML/plist content. */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ─── Linux: systemd ───

const SYSTEMD_SERVICE = `[Unit]
Description=CC Hub - Claude Code Session Manager
After=network.target tailscaled.service

[Service]
Type=simple
ExecStart=__SHELL__ -lc 'exec __EXEC_PATH__ -p __PORT__'
EnvironmentFile=%h/.config/cchub/env
KillMode=process
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
`;

const SYSTEMD_UPDATE_SERVICE = `[Unit]
Description=CC Hub update check

[Service]
Type=oneshot
ExecStart=__EXEC_PATH__ update --auto
`;

const SYSTEMD_UPDATE_TIMER = `[Unit]
Description=Check CC Hub updates daily

[Timer]
OnCalendar=daily
Persistent=true
RandomizedDelaySec=1h

[Install]
WantedBy=timers.target
`;

// ─── macOS: launchd ───

/**
 * Build the launchd plist for the cchub server.
 * The password is NOT embedded here — it is read from the macOS Keychain at
 * runtime by `cchub` itself, so the plist file stays free of secrets.
 */
function buildLaunchdPlist(execPath: string, port: number): string {
  const args = [execPath, '-p', String(port)];
  const logPath = join(homedir(), '.cc-hub', 'cchub.log');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.cchub.server</string>
  <key>ProgramArguments</key>
  <array>
${args.map(a => `    <string>${escapeXml(a)}</string>`).join('\n')}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(logPath)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>
`;
}

function buildLaunchdUpdatePlist(execPath: string): string {
  const logPath = join(homedir(), '.cc-hub', 'update.log');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.cchub.update</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(execPath)}</string>
    <string>update</string>
    <string>--auto</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>4</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>${escapeXml(logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(logPath)}</string>
</dict>
</plist>
`;
}

// ─── herdr provisioning ───

const HERDR_SYSTEMD_SERVICE = `[Unit]
Description=herdr terminal multiplexer server (CC Hub backend)

[Service]
Type=simple
ExecStart=__HERDR_PATH__ server
Restart=always
RestartSec=2
Environment=LANG=en_US.UTF-8

[Install]
WantedBy=default.target
`;

function buildHerdrLaunchdPlist(herdrPath: string): string {
  const logPath = join(homedir(), '.cc-hub', 'herdr.log');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.herdr.server</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(herdrPath)}</string>
    <string>server</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(logPath)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
    <key>LANG</key>
    <string>en_US.UTF-8</string>
  </dict>
</dict>
</plist>
`;
}

const HERDR_CONFIG_TOML = `# CC Hub herdr backend configuration (written by \`cchub setup\`)

[session]
# Restart agent panes (Claude Code etc.) in their native conversation
# sessions after a server restart.
resume_agents_on_restore = true

[experimental]
# Persist recent pane screen contents across server restarts.
pane_history = true
`;

/**
 * Provision the herdr backend: supervised server (systemd / launchd),
 * config.toml with agent-resume enabled, and native identity integrations for
 * the supported agents that herdr can integrate with.
 */
async function provisionHerdr(): Promise<void> {
  console.log('🐑 herdr バックエンドのセットアップ');

  const herdrPath = herdrBinaryPath();
  if (!herdrPath) {
    console.error('⚠️  herdr が見つかりません。先にインストールしてください:');
    console.error('   curl -fsSL https://herdr.dev/install.sh | sh  (または brew install herdr)');
    console.log('');
    return;
  }

  // config.toml: create with our defaults; never clobber an existing file.
  const herdrConfigDir = join(homedir(), '.config', 'herdr');
  const configPath = join(herdrConfigDir, 'config.toml');
  await mkdir(herdrConfigDir, { recursive: true });
  const existingConfig = await Bun.file(configPath)
    .text()
    .catch(() => null);
  if (existingConfig === null) {
    await writeFile(configPath, HERDR_CONFIG_TOML);
    console.log(`✅ herdr 設定を作成: ${configPath}`);
  } else if (!existingConfig.includes('resume_agents_on_restore')) {
    console.log('⚠️  既存の herdr config.toml に resume_agents_on_restore がありません。');
    console.log('   [session] resume_agents_on_restore = true の追記を推奨します');
  }

  // Supervised server.
  const wasRunning = Bun.spawnSync([herdrPath, 'status', 'server'])
    .stdout.toString()
    .includes('status: running');
  if (platform() === 'darwin') {
    const plistPath = join(homedir(), 'Library', 'LaunchAgents', 'com.herdr.server.plist');
    await writeFile(plistPath, buildHerdrLaunchdPlist(herdrPath));
    console.log(`✅ herdr サービスファイル: ${plistPath}`);
    if (wasRunning) {
      console.log('⚠️  herdr サーバが既に稼働中のため、launchd への切替は手動で行ってください:');
      console.log(`   herdr server stop && launchctl bootstrap gui/$(id -u) ${plistPath}`);
      console.log('   (resume_agents_on_restore 有効ならエージェント会話は自動復元されます)');
    } else {
      Bun.spawnSync(['launchctl', 'bootout', `gui/${process.getuid?.() ?? 501}`, plistPath]);
      Bun.spawnSync(['launchctl', 'bootstrap', `gui/${process.getuid?.() ?? 501}`, plistPath]);
      console.log('✅ herdr サーバを launchd で起動しました');
    }
  } else {
    const systemdDir = join(homedir(), '.config', 'systemd', 'user');
    await mkdir(systemdDir, { recursive: true });
    const unitPath = join(systemdDir, 'herdr.service');
    await writeFile(unitPath, HERDR_SYSTEMD_SERVICE.replace(/__HERDR_PATH__/g, herdrPath));
    console.log(`✅ herdr サービスファイル: ${unitPath}`);
    Bun.spawnSync(['systemctl', '--user', 'daemon-reload']);
    if (wasRunning && !isHerdrSystemdActive()) {
      Bun.spawnSync(['systemctl', '--user', 'enable', 'herdr']);
      console.log('⚠️  herdr サーバが systemd 管理外で稼働中です。切替は手動で:');
      console.log('   herdr server stop && systemctl --user start herdr');
      console.log('   (resume_agents_on_restore 有効ならエージェント会話は自動復元されます)');
    } else {
      const res = Bun.spawnSync(['systemctl', '--user', 'enable', '--now', 'herdr']);
      if (res.exitCode === 0) {
        console.log('✅ herdr サーバを systemd で常駐化しました');
      } else {
        console.error('⚠️  herdr サービスの起動に失敗しました');
        console.error(res.stderr.toString());
      }
    }
  }

  // Native session identity is authoritative in CC Hub. Install every herdr
  // integration available for our supported agents; without one, that
  // provider stays visible as a terminal but conversation history is disabled.
  for (const agent of ['claude', 'codex'] as const) {
    const integ = Bun.spawnSync([herdrPath, 'integration', 'install', agent]);
    if (integ.exitCode === 0) {
      console.log(`✅ herdr ${agent} integration を設定しました`);
    } else {
      console.error(`⚠️  herdr integration install ${agent} に失敗しました:`);
      console.error(integ.stderr.toString());
    }
  }
  try {
    const migration = await migrateCodexHooksToJson(join(homedir(), '.codex'));
    if (migration.changed) {
      console.log('✅ Codex hook を ~/.codex/hooks.json に統合しました');
    }
  } catch (error) {
    console.error('⚠️  Codex hook の hooks.json 統合に失敗しました:');
    console.error(error instanceof Error ? error.message : String(error));
  }
  console.log('');
}

function isHerdrSystemdActive(): boolean {
  return (
    Bun.spawnSync(['systemctl', '--user', 'is-active', 'herdr']).stdout.toString().trim() ===
    'active'
  );
}

// ─── Setup entry point ───

export async function setupService(port: number, password?: string): Promise<void> {
  await provisionHerdr();
  if (platform() === 'darwin') {
    await setupLaunchd(port, password);
  } else {
    await setupSystemd(port, password);
  }
}

async function setupLaunchd(port: number, password?: string): Promise<void> {
  const home = homedir();
  const launchAgentsDir = join(home, 'Library', 'LaunchAgents');
  const logDir = join(home, '.cc-hub');
  const execPath = process.execPath;

  console.log('🔧 CC Hub セットアップ (macOS)');
  console.log('');

  await mkdir(launchAgentsDir, { recursive: true });
  await mkdir(logDir, { recursive: true });

  // Store password in macOS Keychain instead of embedding in plist (which is
  // world-readable). cchub at runtime reads it back via `security`.
  if (password) {
    if (storePasswordInKeychain(password)) {
      console.log('🔐 パスワードを Keychain に保存しました (service: cchub)');
    } else {
      console.log('⚠️  Keychain への保存に失敗しました');
    }
  }

  // Main service plist (no password embedded — read from Keychain at runtime)
  const plistPath = join(launchAgentsDir, 'com.cchub.server.plist');
  await writeFile(plistPath, buildLaunchdPlist(execPath, port));
  console.log(`✅ サービスファイル: ${plistPath}`);

  // Update plist
  const updatePlistPath = join(launchAgentsDir, 'com.cchub.update.plist');
  await writeFile(updatePlistPath, buildLaunchdUpdatePlist(execPath));
  console.log(`✅ 更新サービスファイル: ${updatePlistPath}`);

  console.log('');

  // Unload if already loaded (ignore errors)
  Bun.spawnSync(['launchctl', 'bootout', `gui/${process.getuid?.() ?? 501}`, plistPath]);

  // Load service
  const loadResult = Bun.spawnSync(['launchctl', 'bootstrap', `gui/${process.getuid?.() ?? 501}`, plistPath]);
  if (loadResult.exitCode === 0) {
    console.log('✅ サービスを起動しました');
  } else {
    // Fallback to legacy load
    const legacyResult = Bun.spawnSync(['launchctl', 'load', plistPath]);
    if (legacyResult.exitCode === 0) {
      console.log('✅ サービスを起動しました');
    } else {
      console.error('⚠️  サービスの起動に失敗しました');
      console.error(legacyResult.stderr.toString());
    }
  }

  // Load update service
  Bun.spawnSync(['launchctl', 'bootout', `gui/${process.getuid?.() ?? 501}`, updatePlistPath]);
  Bun.spawnSync(['launchctl', 'bootstrap', `gui/${process.getuid?.() ?? 501}`, updatePlistPath]);
  console.log('✅ 自動更新を有効化しました（毎日4:00）');

  console.log('');
  console.log('📋 管理コマンド:');
  console.log('  launchctl list | grep cchub        # Status');
  console.log(`  launchctl kickstart -k gui/$(id -u)/com.cchub.server  # Restart`);
  console.log(`  launchctl bootout gui/$(id -u)/com.cchub.server       # Stop`);
  console.log(`  tail -f ~/.cc-hub/cchub.log        # Logs`);
  console.log('');
}

async function setupSystemd(port: number, password?: string): Promise<void> {
  const home = homedir();
  const configDir = join(home, '.config', 'cchub');
  const systemdDir = join(home, '.config', 'systemd', 'user');
  const execPath = process.execPath;

  console.log('🔧 CC Hub セットアップ');
  console.log('');

  await mkdir(configDir, { recursive: true });
  await mkdir(systemdDir, { recursive: true });

  // Environment file
  const envContent = password ? `PASSWORD=${password}\n` : '# PASSWORD=yourpassword\n';
  const envPath = join(configDir, 'env');
  await writeFile(envPath, envContent);
  await chmod(envPath, 0o600);
  console.log(`✅ 環境変数ファイル: ${envPath}`);

  // Main service
  const shell = process.env.SHELL || '/bin/bash';
  const serviceContent = SYSTEMD_SERVICE
    .replace(/__SHELL__/g, shell)
    .replace(/__EXEC_PATH__/g, execPath)
    .replace(/__PORT__/g, String(port));
  const servicePath = join(systemdDir, 'cchub.service');
  await writeFile(servicePath, serviceContent);
  console.log(`✅ サービスファイル: ${servicePath}`);

  // Update service
  const updateServicePath = join(systemdDir, 'cchub-update.service');
  await writeFile(updateServicePath, SYSTEMD_UPDATE_SERVICE.replace(/__EXEC_PATH__/g, execPath));
  console.log(`✅ 更新サービスファイル: ${updateServicePath}`);

  // Update timer
  const updateTimerPath = join(systemdDir, 'cchub-update.timer');
  await writeFile(updateTimerPath, SYSTEMD_UPDATE_TIMER);
  console.log(`✅ 更新タイマーファイル: ${updateTimerPath}`);

  console.log('');

  // Reload and enable
  Bun.spawnSync(['systemctl', '--user', 'daemon-reload']);

  const enableResult = Bun.spawnSync(['systemctl', '--user', 'enable', '--now', 'cchub']);
  if (enableResult.exitCode === 0) {
    console.log(`✅ ${t('setup.serviceEnabled')}`);
  } else {
    console.error('⚠️  Failed to enable service');
    console.error(enableResult.stderr.toString());
  }

  const timerResult = Bun.spawnSync(['systemctl', '--user', 'enable', '--now', 'cchub-update.timer']);
  if (timerResult.exitCode === 0) {
    console.log('✅ 自動更新タイマーを有効化しました');
  }

  console.log('');
  console.log(`📋 ${t('setup.commands')}`);
  console.log('  systemctl --user status cchub    # Status');
  console.log(`  ${t('setup.cmdRestart')}`);
  console.log(`  ${t('setup.cmdStop')}`);
  console.log(`  ${t('setup.cmdLogs')}`);
  console.log('');

  // Enable linger
  const lingerResult = Bun.spawnSync(['loginctl', 'show-user', process.env.USER || '', '--property=Linger']);
  if (!lingerResult.stdout.toString().includes('Linger=yes')) {
    console.log(`🔄 ${t('setup.enablingAutostart')}`);
    const result = Bun.spawnSync(['loginctl', 'enable-linger', process.env.USER || '']);
    if (result.exitCode === 0) {
      console.log(`✅ ${t('setup.autostartEnabled')}`);
    } else {
      console.log(`⚠️  ${t('setup.autostartFailed')}`);
      console.log(`   ${t('setup.autostartCommand')}`);
    }
    console.log('');
  }

  if (!password) {
    console.log(`⚠️  ${t('setup.passwordNotSetEnv')}`);
  }
}
