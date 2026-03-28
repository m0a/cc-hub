// cchub setup command - service registration (systemd on Linux, launchd on macOS)

import { mkdir, writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';
import { t } from '../i18n';

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

function buildLaunchdPlist(execPath: string, port: number, password?: string): string {
  const args = [execPath, '-p', String(port)];
  if (password) args.push('-P', password);

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.cchub.server</string>
  <key>ProgramArguments</key>
  <array>
${args.map(a => `    <string>${a}</string>`).join('\n')}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${join(homedir(), '.cc-hub', 'cchub.log')}</string>
  <key>StandardErrorPath</key>
  <string>${join(homedir(), '.cc-hub', 'cchub.log')}</string>
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
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.cchub.update</string>
  <key>ProgramArguments</key>
  <array>
    <string>${execPath}</string>
    <string>update</string>
    <string>--auto</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>4</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>${join(homedir(), '.cc-hub', 'update.log')}</string>
  <key>StandardErrorPath</key>
  <string>${join(homedir(), '.cc-hub', 'update.log')}</string>
</dict>
</plist>
`;
}

// ─── Setup entry point ───

export async function setupService(port: number, password?: string): Promise<void> {
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

  // Main service plist
  const plistPath = join(launchAgentsDir, 'com.cchub.server.plist');
  await writeFile(plistPath, buildLaunchdPlist(execPath, port, password));
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
