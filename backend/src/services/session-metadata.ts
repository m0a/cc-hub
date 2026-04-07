import { join } from 'node:path';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { ensureDataDir } from '../utils/storage';
import type { SessionTheme } from '../../../shared/types';

const METADATA_FILE = 'session-metadata.json';
const LAST_KNOWN_FILE = 'last-known-sessions.json';

interface SessionMeta {
  theme?: SessionTheme;
  title?: string;
}

export interface LastKnownSession {
  id: string;
  name: string;
  currentPath?: string;
  theme?: SessionTheme;
  customTitle?: string;
  ccSessionId?: string;
}

interface MetadataStore {
  sessions: Record<string, SessionMeta>;
  sessionOrder?: string[];
}

async function getFilePath(): Promise<string> {
  const dataDir = await ensureDataDir();
  return join(dataDir, METADATA_FILE);
}

async function getLastKnownFilePath(): Promise<string> {
  const dataDir = await ensureDataDir();
  return join(dataDir, LAST_KNOWN_FILE);
}

let migrated = false;

async function load(): Promise<MetadataStore> {
  const filePath = await getFilePath();
  try {
    const data = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(data) as MetadataStore & { lastKnownSessions?: LastKnownSession[] };
    // Migrate: if lastKnownSessions exists in metadata file, move to separate file
    if (parsed.lastKnownSessions) {
      const lkPath = await getLastKnownFilePath();
      await writeFile(lkPath, JSON.stringify(parsed.lastKnownSessions, null, 2)).catch(() => {});
      delete parsed.lastKnownSessions;
      await writeFile(filePath, JSON.stringify(parsed, null, 2)).catch(() => {});
    }
    return { sessions: parsed.sessions || {}, sessionOrder: parsed.sessionOrder };
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
  }
  // Auto-delete old files after migration
  try { await unlink(join(dataDir, 'session-themes.json')); } catch { /* already deleted */ }
  try { await unlink(join(dataDir, 'session-titles.json')); } catch { /* already deleted */ }
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

export async function getSessionOrder(): Promise<string[]> {
  const data = await load();
  return data.sessionOrder || [];
}

export async function setSessionOrder(order: string[]): Promise<void> {
  const data = await load();
  data.sessionOrder = order;
  await save(data);
}

// Last known sessions: separate file to avoid race conditions with metadata writes
export async function getLastKnownSessions(): Promise<LastKnownSession[]> {
  const filePath = await getLastKnownFilePath();
  try {
    const data = await readFile(filePath, 'utf-8');
    return JSON.parse(data) as LastKnownSession[];
  } catch {
    return [];
  }
}

export async function saveLastKnownSessions(sessions: LastKnownSession[]): Promise<void> {
  const filePath = await getLastKnownFilePath();
  await writeFile(filePath, JSON.stringify(sessions, null, 2));
}

export async function removeLastKnownSession(sessionId: string): Promise<void> {
  const sessions = await getLastKnownSessions();
  const filtered = sessions.filter(s => s.id !== sessionId);
  if (filtered.length !== sessions.length) {
    await saveLastKnownSessions(filtered);
  }
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
