// cchub uninstall command - remove service registration (systemd on Linux, launchd on macOS)

import { unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';
import { t } from '../i18n';

export async function uninstallService(): Promise<void> {
  if (platform() === 'darwin') {
    await uninstallLaunchd();
  } else {
    await uninstallSystemd();
  }
}

async function uninstallLaunchd(): Promise<void> {
  const home = homedir();
  const launchAgentsDir = join(home, 'Library', 'LaunchAgents');
  const plistPath = join(launchAgentsDir, 'com.cchub.server.plist');
  const updatePlistPath = join(launchAgentsDir, 'com.cchub.update.plist');
  const uid = process.getuid?.() ?? 501;

  console.log(`🗑️  ${t('uninstall.title')}`);
  console.log('');

  // Stop services
  if (existsSync(plistPath)) {
    Bun.spawnSync(['launchctl', 'bootout', `gui/${uid}`, plistPath]);
    await unlink(plistPath);
    console.log(`✅ ${t('uninstall.removedService')}: ${plistPath}`);
  } else {
    console.log(`⏭️  ${t('uninstall.notFound')}: ${plistPath}`);
  }

  if (existsSync(updatePlistPath)) {
    Bun.spawnSync(['launchctl', 'bootout', `gui/${uid}`, updatePlistPath]);
    await unlink(updatePlistPath);
    console.log(`✅ ${t('uninstall.removedUpdate')}: ${updatePlistPath}`);
  } else {
    console.log(`⏭️  ${t('uninstall.notFound')}: ${updatePlistPath}`);
  }

  console.log('');
  console.log(`✅ ${t('uninstall.done')}`);

  const logDir = join(home, '.cc-hub');
  if (existsSync(logDir)) {
    console.log('');
    console.log(`💡 ${t('uninstall.logsHint')}: rm -rf ${logDir}`);
  }
}

async function uninstallSystemd(): Promise<void> {
  const home = homedir();
  const systemdDir = join(home, '.config', 'systemd', 'user');
  const servicePath = join(systemdDir, 'cchub.service');
  const updateServicePath = join(systemdDir, 'cchub-update.service');
  const updateTimerPath = join(systemdDir, 'cchub-update.timer');

  console.log(`🗑️  ${t('uninstall.title')}`);
  console.log('');

  // Stop and disable services
  Bun.spawnSync(['systemctl', '--user', 'stop', 'cchub']);
  Bun.spawnSync(['systemctl', '--user', 'disable', 'cchub']);
  Bun.spawnSync(['systemctl', '--user', 'stop', 'cchub-update.timer']);
  Bun.spawnSync(['systemctl', '--user', 'disable', 'cchub-update.timer']);

  for (const [path, label] of [
    [servicePath, t('uninstall.removedService')],
    [updateServicePath, t('uninstall.removedUpdate')],
    [updateTimerPath, t('uninstall.removedTimer')],
  ] as const) {
    if (existsSync(path)) {
      await unlink(path);
      console.log(`✅ ${label}: ${path}`);
    } else {
      console.log(`⏭️  ${t('uninstall.notFound')}: ${path}`);
    }
  }

  Bun.spawnSync(['systemctl', '--user', 'daemon-reload']);

  console.log('');
  console.log(`✅ ${t('uninstall.done')}`);

  const configDir = join(home, '.config', 'cchub');
  if (existsSync(configDir)) {
    console.log('');
    console.log(`💡 ${t('uninstall.configHint')}: rm -rf ${configDir}`);
  }
}
