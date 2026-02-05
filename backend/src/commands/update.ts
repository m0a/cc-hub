// cchub update command - check and apply updates from GitHub Releases

import { copyFile, rename, chmod } from 'node:fs/promises';
import { VERSION } from '../cli';
import { t } from '../i18n';

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
  } catch (error) {
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

  // Download to temp location
  const currentPath = process.execPath;
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

  // Replace binary
  try {
    await rename(tempPath, currentPath);
    console.log('✅ バイナリを更新しました');
  } catch (error) {
    console.error('❌ バイナリの置き換えに失敗しました:', error);
    console.log('💡 ヒント: サービスを停止してから再試行してください');
    console.log('   systemctl --user stop cchub');
    return;
  }

  // Restart service if running via systemd
  const restartResult = Bun.spawnSync(['systemctl', '--user', 'restart', 'cchub']);
  if (restartResult.exitCode === 0) {
    console.log(`🔄 ${t('update.serviceRestarted')}`);
  } else {
    console.log(`ℹ️  ${t('update.manualRestartRequired')}`);
  }

  console.log('');
  console.log(`✨ v${currentVersion} → ${latestVersion} に更新完了`);
}
