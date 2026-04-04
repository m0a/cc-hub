// cchub update command - check and apply updates from GitHub Releases

import { copyFile, rename, chmod, readFile } from 'node:fs/promises';
import { platform } from 'node:os';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { VERSION } from '../cli';
import { t } from '../i18n';

/** Read the binary path registered in the systemd/launchd service file */
async function getServiceBinaryPath(): Promise<string | null> {
  const isDarwin = platform() === 'darwin';
  try {
    if (isDarwin) {
      const plistPath = join(homedir(), 'Library', 'LaunchAgents', 'com.cchub.server.plist');
      const content = await readFile(plistPath, 'utf-8');
      // Extract first <string> after <key>ProgramArguments</key> array
      const match = content.match(/<key>ProgramArguments<\/key>\s*<array>\s*<string>([^<]+)<\/string>/);
      return match?.[1] ?? null;
    } else {
      const servicePath = join(homedir(), '.config', 'systemd', 'user', 'cchub.service');
      const content = await readFile(servicePath, 'utf-8');
      // Extract exec path from: ExecStart=/bin/zsh -lc 'exec /path/to/cchub ...'
      const match = content.match(/exec\s+(\S+cchub)\b/) || content.match(/ExecStart=(\S+cchub)\b/);
      return match?.[1] ?? null;
    }
  } catch {
    return null;
  }
}

const GITHUB_REPO = 'm0a/cc-hub';

function getBinaryName(): string {
  const platform = process.platform; // 'linux', 'darwin', etc.
  const arch = process.arch; // 'x64', 'arm64', etc.

  if (platform === 'linux' && arch === 'x64') {
    return 'cchub-linux-x64';
  }
  if (platform === 'darwin' && arch === 'arm64') {
    return 'cchub-macos-arm64';
  }

  // Fallback: try platform-arch pattern
  const platformName = platform === 'darwin' ? 'macos' : platform;
  return `cchub-${platformName}-${arch}`;
}

interface GitHubRelease {
  tag_name: string;
  assets: {
    name: string;
    browser_download_url: string;
  }[];
}

async function getLatestRelease(): Promise<GitHubRelease | null> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': `cchub/${VERSION}`,
        },
      }
    );

    if (!response.ok) {
      if (response.status === 404) {
        return null; // No releases yet
      }
      throw new Error(`GitHub API error: ${response.status}`);
    }

    return await response.json();
  } catch (_error) {
    console.error(`❌ ${t('update.githubConnectionFailed')}`);
    return null;
  }
}

function parseVersion(version: string): number[] {
  // Remove 'v' prefix if present
  const clean = version.replace(/^v/, '');
  return clean.split('.').map(n => parseInt(n, 10));
}

function isNewerVersion(latest: string, current: string): boolean {
  const latestParts = parseVersion(latest);
  const currentParts = parseVersion(current);

  for (let i = 0; i < Math.max(latestParts.length, currentParts.length); i++) {
    const l = latestParts[i] || 0;
    const c = currentParts[i] || 0;
    if (l > c) return true;
    if (l < c) return false;
  }
  return false;
}

async function downloadBinary(url: string, destPath: string): Promise<boolean> {
  try {
    console.log('📥 ダウンロード中...');
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Download failed: ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    await Bun.write(destPath, buffer);
    await chmod(destPath, 0o755);

    return true;
  } catch (error) {
    console.error('❌ ダウンロードに失敗しました:', error);
    return false;
  }
}

export async function checkAndUpdate(checkOnly: boolean, autoMode: boolean): Promise<void> {
  const currentVersion = VERSION;

  if (!autoMode) {
    console.log(`🔍 更新を確認中... (現在: v${currentVersion})`);
  }

  const release = await getLatestRelease();

  if (!release) {
    if (!autoMode) {
      console.log('ℹ️  リリース情報を取得できませんでした');
    }
    return;
  }

  const latestVersion = release.tag_name;

  if (!isNewerVersion(latestVersion, currentVersion)) {
    if (!autoMode) {
      console.log(`✅ 最新版です (v${currentVersion})`);
    }
    return;
  }

  console.log(`⬆️  新しいバージョンがあります: ${latestVersion}`);

  if (checkOnly) {
    console.log('');
    console.log('更新するには: cchub update');
    return;
  }

  // Find the binary asset for current platform
  const binaryName = getBinaryName();
  const asset = release.assets.find(a => a.name === binaryName);
  if (!asset) {
    console.error(`❌ バイナリがリリースに見つかりません: ${binaryName}`);
    console.log('利用可能なアセット:', release.assets.map(a => a.name).join(', '));
    return;
  }

  // Determine the target binary path: prefer the service-registered path over process.execPath
  const servicePath = await getServiceBinaryPath();
  const currentPath = servicePath || process.execPath;
  if (servicePath && servicePath !== process.execPath) {
    console.log(`📋 サービス登録パス: ${servicePath}`);
  }

  // Download to temp location
  const tempPath = `${currentPath}.new`;
  const backupPath = `${currentPath}.bak`;

  const success = await downloadBinary(asset.browser_download_url, tempPath);
  if (!success) {
    return;
  }

  // Backup current binary
  try {
    await copyFile(currentPath, backupPath);
    console.log(`📦 バックアップ: ${backupPath}`);
  } catch {
    console.log('⚠️  バックアップをスキップしました');
  }

  // Also update the CLI binary if it's at a different path
  const cliPath = process.execPath;
  const updateCliBinary = servicePath && servicePath !== cliPath;

  const isDarwin = platform() === 'darwin';
  const uid = process.getuid?.() ?? 501;
  const plistPath = join(homedir(), 'Library', 'LaunchAgents', 'com.cchub.server.plist');

  // Stop service before replacing binary (macOS launchd holds the binary open)
  if (isDarwin) {
    Bun.spawnSync(['launchctl', 'bootout', `gui/${uid}`, plistPath]);
    console.log('⏸️  サービスを停止しました');
  }

  // Replace binary
  try {
    await rename(tempPath, currentPath);
    console.log(`✅ バイナリを更新しました: ${currentPath}`);
    // Also copy to CLI binary path if different from service path
    if (updateCliBinary) {
      try {
        await copyFile(currentPath, cliPath);
        console.log(`✅ CLIバイナリも更新しました: ${cliPath}`);
      } catch {
        console.log(`⚠️  CLIバイナリの更新をスキップ: ${cliPath}`);
      }
    }
  } catch (error) {
    console.error('❌ バイナリの置き換えに失敗しました:', error);
    if (isDarwin) {
      console.log('💡 ヒント: launchctl bootout gui/$(id -u)/com.cchub.server');
    } else {
      console.log('💡 ヒント: systemctl --user stop cchub');
    }
    // Try to restart service even if replace failed
    if (isDarwin) {
      Bun.spawnSync(['launchctl', 'bootstrap', `gui/${uid}`, plistPath]);
    }
    return;
  }

  // Restart service
  if (isDarwin) {
    const result = Bun.spawnSync(['launchctl', 'bootstrap', `gui/${uid}`, plistPath]);
    if (result.exitCode === 0) {
      console.log(`🔄 ${t('update.serviceRestarted')}`);
    } else {
      // Fallback to legacy load
      const legacyResult = Bun.spawnSync(['launchctl', 'load', plistPath]);
      if (legacyResult.exitCode === 0) {
        console.log(`🔄 ${t('update.serviceRestarted')}`);
      } else {
        console.log(`ℹ️  手動で再起動してください: launchctl bootstrap gui/$(id -u) ${plistPath}`);
      }
    }
  } else {
    const restartResult = Bun.spawnSync(['systemctl', '--user', 'restart', 'cchub']);
    if (restartResult.exitCode === 0) {
      console.log(`🔄 ${t('update.serviceRestarted')}`);
    } else {
      console.log(`ℹ️  ${t('update.manualRestartRequired')}`);
    }
  }

  console.log('');
  console.log(`✨ v${currentVersion} → ${latestVersion} に更新完了`);
}
