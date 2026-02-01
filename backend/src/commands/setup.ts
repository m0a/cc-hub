// cchub setup command - systemd service registration

import { mkdir, writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const SERVICE_TEMPLATE = `[Unit]
Description=CC Hub - Claude Code Session Manager
After=network.target tailscaled.service

[Service]
Type=simple
ExecStart=__SHELL__ -lc 'exec __EXEC_PATH__ -p __PORT__'
EnvironmentFile=%h/.config/cchub/env
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
`;

const UPDATE_SERVICE_TEMPLATE = `[Unit]
Description=CC Hub update check

[Service]
Type=oneshot
ExecStart=__EXEC_PATH__ update --auto
`;

const UPDATE_TIMER_TEMPLATE = `[Unit]
Description=Check CC Hub updates daily

[Timer]
OnCalendar=daily
Persistent=true
RandomizedDelaySec=1h

[Install]
WantedBy=timers.target
`;

export async function setupSystemd(port: number, password?: string): Promise<void> {
  const home = homedir();
  const configDir = join(home, '.config', 'cchub');
  const systemdDir = join(home, '.config', 'systemd', 'user');

  // Get the path to the cchub binary
  const execPath = process.execPath;

  console.log('🔧 CC Hub セットアップ');
  console.log('');

  // Create directories
  await mkdir(configDir, { recursive: true });
  await mkdir(systemdDir, { recursive: true });

  // Create environment file (password only, PATH/TERM come from login shell)
  const envContent = password ? `PASSWORD=${password}\n` : '# PASSWORD=yourpassword\n';
  const envPath = join(configDir, 'env');
  await writeFile(envPath, envContent);
  await chmod(envPath, 0o600);
  console.log(`✅ 環境変数ファイル: ${envPath}`);

  // Create main service file
  const shell = process.env.SHELL || '/bin/bash';
  const serviceContent = SERVICE_TEMPLATE
    .replace(/__SHELL__/g, shell)
    .replace(/__EXEC_PATH__/g, execPath)
    .replace(/__PORT__/g, String(port));
  const servicePath = join(systemdDir, 'cchub.service');
  await writeFile(servicePath, serviceContent);
  console.log(`✅ サービスファイル: ${servicePath}`);

  // Create update service file
  const updateServiceContent = UPDATE_SERVICE_TEMPLATE
    .replace(/__EXEC_PATH__/g, execPath);
  const updateServicePath = join(systemdDir, 'cchub-update.service');
  await writeFile(updateServicePath, updateServiceContent);
  console.log(`✅ 更新サービスファイル: ${updateServicePath}`);

  // Create update timer file
  const updateTimerPath = join(systemdDir, 'cchub-update.timer');
  await writeFile(updateTimerPath, UPDATE_TIMER_TEMPLATE);
  console.log(`✅ 更新タイマーファイル: ${updateTimerPath}`);

  console.log('');

  // Reload systemd
  const reloadResult = Bun.spawnSync(['systemctl', '--user', 'daemon-reload']);
  if (reloadResult.exitCode !== 0) {
    console.error('⚠️  systemctl daemon-reload に失敗しました');
  }

  // Enable and start service
  const enableResult = Bun.spawnSync(['systemctl', '--user', 'enable', '--now', 'cchub']);
  if (enableResult.exitCode === 0) {
    console.log('✅ サービスを有効化・起動しました');
  } else {
    console.error('⚠️  サービスの有効化に失敗しました');
    console.error(enableResult.stderr.toString());
  }

  // Enable update timer
  const timerResult = Bun.spawnSync(['systemctl', '--user', 'enable', '--now', 'cchub-update.timer']);
  if (timerResult.exitCode === 0) {
    console.log('✅ 自動更新タイマーを有効化しました');
  } else {
    console.error('⚠️  タイマーの有効化に失敗しました');
  }

  console.log('');
  console.log('📋 操作コマンド:');
  console.log('  systemctl --user status cchub    # 状態確認');
  console.log('  systemctl --user restart cchub   # 再起動');
  console.log('  systemctl --user stop cchub      # 停止');
  console.log('  journalctl --user -u cchub -f    # ログ確認');
  console.log('');

  // Enable linger for boot-time startup
  const lingerResult = Bun.spawnSync(['loginctl', 'show-user', process.env.USER || '', '--property=Linger']);
  const lingerOutput = lingerResult.stdout.toString();
  if (!lingerOutput.includes('Linger=yes')) {
    console.log('🔄 PC起動時の自動起動を有効化中...');
    const enableResult = Bun.spawnSync(['loginctl', 'enable-linger', process.env.USER || '']);
    if (enableResult.exitCode === 0) {
      console.log('✅ PC起動時の自動起動を有効化しました');
    } else {
      console.log('⚠️  自動起動の有効化に失敗しました。手動で実行してください:');
      console.log(`   loginctl enable-linger ${process.env.USER}`);
    }
    console.log('');
  }

  if (!password) {
    console.log('⚠️  パスワード未設定: ~/.config/cchub/env を編集してください');
  }
}
