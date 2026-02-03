// CLI argument parser and commands

const VERSION = '0.0.15';

// 開発モード判定（bun run --watch で実行されている場合）
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
CC Hub v${VERSION} - Claude Code セッションマネージャー

使い方:
  cchub [オプション]           サーバー起動
  cchub setup [オプション]     systemdサービス登録
  cchub update [オプション]    更新確認・適用
  cchub status                 サービス状態確認

オプション:
  -p, --port <port>      ポート番号 (デフォルト: 本番5923/開発3000)
  -H, --host <host>      バインドアドレス (デフォルト: 0.0.0.0)
  -P, --password <pass>  認証パスワード

updateオプション:
  --check                確認のみ（更新しない）
  --auto                 自動更新モード（timerから使用）

その他:
  -h, --help             このヘルプを表示
  -v, --version          バージョンを表示

例:
  cchub                      サーバー起動（本番: 5923）
  cchub -p 8080 -P secret    ポート8080、パスワード付きで起動
  cchub setup -P secret      systemdに登録
  cchub update               最新版に更新
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
          console.error('❌ エラー: 無効なポート番号');
          process.exit(1);
        }
        break;
      case '-H':
      case '--host':
        i++;
        options.host = args[i];
        if (!options.host) {
          console.error('❌ エラー: ホストが指定されていません');
          process.exit(1);
        }
        break;
      case '-P':
      case '--password':
        i++;
        options.password = args[i];
        if (!options.password) {
          console.error('❌ エラー: パスワードが指定されていません');
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
          console.error(`❌ エラー: 不明なオプション: ${arg}`);
          console.error('ヘルプ: cchub --help');
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
