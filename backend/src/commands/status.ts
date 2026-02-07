// cchub status command - show systemd service status

import { VERSION } from '../cli';
import { t } from '../i18n';

export async function showStatus(): Promise<void> {
  console.log(`CC Hub v${VERSION}`);
  console.log('');

  // Check main service status
  const serviceResult = Bun.spawnSync(['systemctl', '--user', 'status', 'cchub', '--no-pager'], {
    stdout: 'pipe',
    stderr: 'pipe',
  });

  if (serviceResult.exitCode === 0) {
    console.log('📦 Service status:');
    console.log(serviceResult.stdout.toString());
  } else if (serviceResult.exitCode === 3) {
    // Service exists but not running
    console.log('📦 Service status: Stopped');
    console.log('');
    console.log(t('status.startCommand'));
  } else if (serviceResult.exitCode === 4) {
    // Service not found
    console.log('📦 Service status: Not registered');
    console.log('');
    console.log('To setup: cchub setup');
  } else {
    console.log('📦 Service status: Unknown');
    console.log(serviceResult.stderr.toString());
  }

  console.log('');

  // Check update timer status
  const timerResult = Bun.spawnSync(['systemctl', '--user', 'is-active', 'cchub-update.timer'], {
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const timerActive = timerResult.stdout.toString().trim() === 'active';
  console.log(`🔄 Auto-update: ${timerActive ? 'Enabled' : 'Disabled'}`);

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
      if (!Number.isNaN(usec)) {
        const date = new Date(usec / 1000);
        console.log(`   Next check: ${date.toLocaleString()}`);
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
      const hostname = status.Self?.DNSName?.replace(/\.$/, '') || 'unknown';
      console.log(`🔗 ${t('status.tailscaleConnected')}`);
      console.log(`   Hostname: ${hostname}`);
    } catch {
      console.log('🔗 Tailscale: Unknown');
    }
  } else {
    console.log(`🔗 ${t('status.tailscaleDisconnected')}`);
  }
}
