// CLI argument parser and commands
import pkg from '../../package.json';
import { t } from './i18n';

const VERSION = pkg.version;

// Development mode detection (running with bun run --watch)
const isDev = process.argv.some(arg => arg.includes('--watch'));
const DEFAULT_PORT = isDev ? 3000 : 5923;

interface CliOptions {
  command: 'serve' | 'setup' | 'update' | 'status' | 'help' | 'version';
  port: number;
  host: string;
  password?: string;
  updateCheck?: boolean;
  updateAuto?: boolean;
}

function printHelp(): void {
  console.log(`
CC Hub v${VERSION} - Claude Code Session Manager

${t('cli.usage')}
  ${t('cli.serverStart')}
  cchub setup [options]     systemd service setup
  cchub update [options]    Check and apply updates
  cchub status              Show service status

${t('cli.options')}
  ${t('cli.optionPort')}
  ${t('cli.optionHost')}
  ${t('cli.optionPassword')}

update options:
  --check                Check only (no update)
  --auto                 Auto-update mode (for timer)

${t('cli.examples')}
  ${t('cli.exampleStart')}
  ${t('cli.exampleWithPort')}
  cchub setup -P secret      Setup systemd service
  cchub update               Update to latest
`);
}

function printVersion(): void {
  console.log(`cchub v${VERSION}`);
}

export function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    command: 'serve',
    port: DEFAULT_PORT,
    host: '0.0.0.0',
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    switch (arg) {
      case 'setup':
        options.command = 'setup';
        break;
      case 'update':
        options.command = 'update';
        break;
      case 'status':
        options.command = 'status';
        break;
      case '-h':
      case '--help':
        options.command = 'help';
        break;
      case '-v':
      case '--version':
        options.command = 'version';
        break;
      case '-p':
      case '--port':
        i++;
        options.port = parseInt(args[i], 10);
        if (Number.isNaN(options.port) || options.port < 1 || options.port > 65535) {
          console.error(`❌ ${t('cli.errorInvalidPort')}`);
          process.exit(1);
        }
        break;
      case '-H':
      case '--host':
        i++;
        options.host = args[i];
        if (!options.host) {
          console.error(`❌ ${t('cli.errorNoHost')}`);
          process.exit(1);
        }
        break;
      case '-P':
      case '--password':
        i++;
        options.password = args[i];
        if (!options.password) {
          console.error(`❌ ${t('cli.errorNoPassword')}`);
          process.exit(1);
        }
        break;
      case '--check':
        options.updateCheck = true;
        break;
      case '--auto':
        options.updateAuto = true;
        break;
      default:
        if (arg.startsWith('-')) {
          console.error(`❌ ${t('cli.errorUnknownOption', { option: arg })}`);
          console.error('Help: cchub --help');
          process.exit(1);
        }
    }
    i++;
  }

  return options;
}

export async function runCli(options: CliOptions): Promise<'serve' | 'exit'> {
  switch (options.command) {
    case 'help':
      printHelp();
      return 'exit';

    case 'version':
      printVersion();
      return 'exit';

    case 'setup':
      await runSetup(options);
      return 'exit';

    case 'update':
      await runUpdate(options);
      return 'exit';

    case 'status':
      await runStatus();
      return 'exit';

    case 'serve':
      return 'serve';
  }
}

async function runSetup(options: CliOptions): Promise<void> {
  const { setupSystemd } = await import('./commands/setup');
  await setupSystemd(options.port, options.password);
}

async function runUpdate(options: CliOptions): Promise<void> {
  const { checkAndUpdate } = await import('./commands/update');
  await checkAndUpdate(options.updateCheck ?? false, options.updateAuto ?? false);
}

async function runStatus(): Promise<void> {
  const { showStatus } = await import('./commands/status');
  await showStatus();
}

export { VERSION };
