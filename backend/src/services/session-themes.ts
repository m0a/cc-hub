import { join } from 'node:path';
import { readFile, writeFile, } from 'node:fs/promises';
import { ensureDataDir } from '../utils/storage';
import type { SessionTheme } from '../../../shared/types';

const THEMES_FILE = 'session-themes.json';

interface ThemesData {
  themes: Record<string, SessionTheme>;
}

async function getThemesFilePath(): Promise<string> {
  const dataDir = await ensureDataDir();
  return join(dataDir, THEMES_FILE);
}

async function loadThemes(): Promise<ThemesData> {
  const filePath = await getThemesFilePath();
  try {
    const data = await readFile(filePath, 'utf-8');
    return JSON.parse(data) as ThemesData;
  } catch {
    return { themes: {} };
  }
}

async function saveThemes(data: ThemesData): Promise<void> {
  const filePath = await getThemesFilePath();
  await writeFile(filePath, JSON.stringify(data, null, 2));
}

export async function getSessionTheme(sessionId: string): Promise<SessionTheme | undefined> {
  const data = await loadThemes();
  return data.themes[sessionId];
}

export async function setSessionTheme(sessionId: string, theme: SessionTheme | null): Promise<void> {
  const data = await loadThemes();
  if (theme === null) {
    delete data.themes[sessionId];
  } else {
    data.themes[sessionId] = theme;
  }
  await saveThemes(data);
}

export async function getAllSessionThemes(): Promise<Record<string, SessionTheme>> {
  const data = await loadThemes();
  return data.themes;
}

export async function deleteSessionTheme(sessionId: string): Promise<void> {
  await setSessionTheme(sessionId, null);
}
