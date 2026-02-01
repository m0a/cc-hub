import { Hono } from 'hono';
import { readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { FileService } from '../services/file-service';
import { FileChangeTracker } from '../services/file-change-tracker';
import type { FileListResponse, FileReadResponse, FileChangesResponse } from '../../../shared/types';

const fileService = new FileService();
const changeTracker = new FileChangeTracker();

export const files = new Hono();

/**
 * GET /files/list - List directory contents
 * Query params:
 *   - path: Directory path to list
 *   - sessionWorkingDir: Working directory of the session (for security)
 */
files.get('/list', async (c) => {
  const path = c.req.query('path');
  const sessionWorkingDir = c.req.query('sessionWorkingDir');

  if (!path || !sessionWorkingDir) {
    return c.json({ error: 'Missing path or sessionWorkingDir parameter' }, 400);
  }

  try {
    const files = await fileService.listDirectory(path, sessionWorkingDir);
    const parentPath = fileService.getParentPath(path, sessionWorkingDir);

    const response: FileListResponse = {
      path,
      files,
      parentPath,
    };

    return c.json(response);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Access denied')) {
      return c.json({ error: 'Access denied' }, 403);
    }
    return c.json({ error: 'Failed to list directory' }, 500);
  }
});

/**
 * GET /files/read - Read file contents
 * Query params:
 *   - path: File path to read
 *   - sessionWorkingDir: Working directory of the session (for security)
 *   - maxSize: Optional max file size in bytes (default 1MB)
 */
files.get('/read', async (c) => {
  const path = c.req.query('path');
  const sessionWorkingDir = c.req.query('sessionWorkingDir');
  const maxSizeParam = c.req.query('maxSize');
  const maxSize = maxSizeParam ? parseInt(maxSizeParam, 10) : undefined;

  if (!path || !sessionWorkingDir) {
    return c.json({ error: 'Missing path or sessionWorkingDir parameter' }, 400);
  }

  try {
    const file = await fileService.readFile(path, sessionWorkingDir, maxSize);

    const response: FileReadResponse = {
      file,
    };

    return c.json(response);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('Access denied')) {
        return c.json({ error: 'Access denied' }, 403);
      }
      if (error.message.includes('Cannot read directory')) {
        return c.json({ error: 'Cannot read directory as file' }, 400);
      }
    }
    return c.json({ error: 'Failed to read file' }, 500);
  }
});

/**
 * GET /files/changes/:sessionWorkingDir - Get changed files for a session
 * Path params:
 *   - sessionWorkingDir: URL-encoded working directory of the session
 */
files.get('/changes/:sessionWorkingDir', async (c) => {
  const sessionWorkingDir = decodeURIComponent(c.req.param('sessionWorkingDir'));

  if (!sessionWorkingDir) {
    return c.json({ error: 'Missing sessionWorkingDir parameter' }, 400);
  }

  try {
    const changes = await changeTracker.getChangesForWorkingDir(sessionWorkingDir);

    const response: FileChangesResponse = {
      sessionId: sessionWorkingDir,
      changes,
    };

    return c.json(response);
  } catch (error) {
    return c.json({ error: 'Failed to get changes' }, 500);
  }
});

/**
 * GET /files/language - Get language identifier for syntax highlighting
 * Query params:
 *   - path: File path
 */
files.get('/language', async (c) => {
  const path = c.req.query('path');

  if (!path) {
    return c.json({ error: 'Missing path parameter' }, 400);
  }

  const language = fileService.getLanguageFromPath(path);
  const isImage = fileService.isImage(path);
  const isText = fileService.isTextFile(path);

  return c.json({ language, isImage, isText });
});

/**
 * GET /files/images/:filename - Serve conversation images
 * Only serves images from /tmp/cchub-images/ for security
 */
const IMAGES_DIR = '/tmp/cchub-images';

files.get('/images/:filename', async (c) => {
  const filename = c.req.param('filename');

  // Security: only allow alphanumeric, dash, dot for filename
  if (!filename || !/^[\w\-.]+\.(png|jpg|jpeg|gif|webp)$/i.test(filename)) {
    return c.json({ error: 'Invalid filename' }, 400);
  }

  const filePath = join(IMAGES_DIR, basename(filename));

  try {
    const data = await readFile(filePath);
    const ext = filename.split('.').pop()?.toLowerCase();
    const mimeTypes: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
    };

    return new Response(data, {
      headers: {
        'Content-Type': mimeTypes[ext || 'png'] || 'application/octet-stream',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch {
    return c.json({ error: 'Image not found' }, 404);
  }
});
