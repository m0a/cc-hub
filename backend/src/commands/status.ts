// cchub status command - show systemd service status

import { VERSION } from '../cli';

export async function showStatus(): Promise<void> {
  console.log(`CC Hub v${VERSION}`);
  console.log('');

  // Check main service status
  const serviceResult = Bun.spawnSync(['systemctl', '--user', 'status', 'cchub', '--no-pager'], {
    stdout: 'pipe',
    stderr: 'pipe',
  });

  if (serviceResult.exitCode === 0) {
    console.log('📦 サービス状態:');
    console.log(serviceResult.stdout.toString());
  } else if (serviceResult.exitCode === 3) {
    // Service exists but not running
    console.log('📦 サービス状態: 停止中');
    console.log('');
    console.log('起動するには: systemctl --user start cchub');
  } else if (serviceResult.exitCode === 4) {
    // Service not found
    console.log('📦 サービス状態: 未登録');
    console.log('');
    console.log('セットアップするには: cchub setup');
  } else {
    console.log('📦 サービス状態: 不明');
    console.log(serviceResult.stderr.toString());
  }

  console.log('');

  // Check update timer status
  const timerResult = Bun.spawnSync(['systemctl', '--user', 'is-active', 'cchub-update.timer'], {
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const timerActive = timerResult.stdout.toString().trim() === 'active';
  console.log(`🔄 自動更新: ${timerActive ? '有効' : '無効'}`);

  // Show next update check time
  if (timerActive) {
    const nextResult = Bun.spawnSync(
      ['systemctl', '--user', 'show', 'cchub-update.timer', '--property=NextElapseUSecRealtime'],
      { stdout: 'pipe' }
    );
    const nextOutput = nextResult.stdout.toString();
    const match = nextOutput.match(/NextElapseUSecRealtime=(.+)/);
    if (match && match[1] !== 'n/a') {
      // Convert microseconds to readable date
      const usec = parseInt(match[1], 10);
      if (!isNaN(usec)) {
        const date = new Date(usec / 1000);
        console.log(`   次回チェック: ${date.toLocaleString('ja-JP')}`);
      }
    }
  }

  console.log('');

  // Check Tailscale status
  const tailscaleResult = Bun.spawnSync(['tailscale', 'status', '--json'], {
    stdout: 'pipe',
    stderr: 'pipe',
  });

  if (tailscaleResult.exitCode === 0) {
    try {
      const status = JSON.parse(tailscaleResult.stdout.toString());
      const hostname = status.Self?.DNSName?.replace(/\.$/, '') || '不明';
      console.log(`🔗 Tailscale: 接続中`);
      console.log(`   ホスト名: ${hostname}`);
    } catch {
      console.log('🔗 Tailscale: 状態不明');
    }
  } else {
    console.log('🔗 Tailscale: 未接続');
  }
}
