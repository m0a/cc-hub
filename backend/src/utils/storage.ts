import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';

const DEFAULT_DATA_DIR = join(homedir(), '.cc-hub');

export function getDataDir(): string {
  return process.env.CC_HUB_DATA_DIR || DEFAULT_DATA_DIR;
}

export async function ensureDataDir(): Promise<string> {
  const dataDir = getDataDir();
  await mkdir(dataDir, { recursive: true });
  return dataDir;
}
