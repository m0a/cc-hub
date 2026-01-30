import { join } from 'node:path';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
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

export async function readJsonFile<T>(filename: string): Promise<T | null> {
  const filePath = join(getDataDir(), filename);
  try {
    const data = await readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export async function writeJsonFile<T>(filename: string, data: T): Promise<void> {
  await ensureDataDir();
  const filePath = join(getDataDir(), filename);
  await writeFile(filePath, JSON.stringify(data, null, 2));
}

export async function fileExists(filename: string): Promise<boolean> {
  const filePath = join(getDataDir(), filename);
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
