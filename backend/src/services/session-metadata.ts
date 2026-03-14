import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { ensureDataDir } from '../utils/storage';
import type { SessionTheme } from '../../../shared/types';

const METADATA_FILE = 'session-metadata.json';

interface SessionMeta {
  theme?: SessionTheme;
  title?: string;
}

interface MetadataStore {
  sessions: Record<string, SessionMeta>;
}

async function getFilePath(): Promise<string> {
  const dataDir = await ensureDataDir();
  return join(dataDir, METADATA_FILE);
}

let migrated = false;

async function load(): Promise<MetadataStore> {
  const filePath = await getFilePath();
  try {
    const data = await readFile(filePath, 'utf-8');
    return JSON.parse(data) as MetadataStore;
  } catch {
    if (!migrated) {
      migrated = true;
      return await migrateFromOldFiles();
    }
    return { sessions: {} };
  }
}

async function migrateFromOldFiles(): Promise<MetadataStore> {
  const dataDir = await ensureDataDir();
  const sessions: Record<string, SessionMeta> = {};

  try {
    const themesData = JSON.parse(await readFile(join(dataDir, 'session-themes.json'), 'utf-8'));
    if (themesData.themes) {
      for (const [id, theme] of Object.entries(themesData.themes)) {
        sessions[id] = { theme: theme as SessionTheme };
      }
    }
  } catch { /* no old themes file */ }

  try {
    const titlesData = JSON.parse(await readFile(join(dataDir, 'session-titles.json'), 'utf-8'));
    if (titlesData.titles) {
      for (const [id, title] of Object.entries(titlesData.titles)) {
        if (!sessions[id]) sessions[id] = {};
        sessions[id].title = title as string;
      }
    }
  } catch { /* no old titles file */ }

  const store: MetadataStore = { sessions };
  if (Object.keys(sessions).length > 0) {
    await save(store);
    // Old files (session-themes.json, session-titles.json) can be manually deleted after confirming migration
  }
  return store;
}

async function save(data: MetadataStore): Promise<void> {
  const filePath = await getFilePath();
  for (const [id, meta] of Object.entries(data.sessions)) {
    if (!meta.theme && !meta.title) {
      delete data.sessions[id];
    }
  }
  await writeFile(filePath, JSON.stringify(data, null, 2));
}

export async function getAllSessionMetadata(): Promise<Record<string, SessionMeta>> {
  const data = await load();
  return data.sessions;
}

export async function setSessionTheme(sessionId: string, theme: SessionTheme | null): Promise<void> {
  const data = await load();
  if (!data.sessions[sessionId]) data.sessions[sessionId] = {};
  if (theme === null) {
    delete data.sessions[sessionId].theme;
  } else {
    data.sessions[sessionId].theme = theme;
  }
  await save(data);
}

export async function setSessionTitle(sessionId: string, title: string | null): Promise<void> {
  const data = await load();
  if (!data.sessions[sessionId]) data.sessions[sessionId] = {};
  if (title === null || title === '') {
    delete data.sessions[sessionId].title;
  } else {
    data.sessions[sessionId].title = title;
  }
  await save(data);
}
