import { Hono } from 'hono';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const upload = new Hono();

// Directory for uploaded images (accessible from terminal sessions)
const UPLOAD_DIR = '/tmp/cchub-images';

// Ensure upload directory exists
async function ensureUploadDir() {
  try {
    await mkdir(UPLOAD_DIR, { recursive: true });
  } catch {
    // Directory might already exist
  }
}

// Generate unique filename
function generateFilename(originalName: string): string {
  const ext = originalName.split('.').pop()?.toLowerCase() || 'png';
  const id = randomBytes(8).toString('hex');
  const timestamp = Date.now();
  return `${timestamp}-${id}.${ext}`;
}

// Upload image
upload.post('/image', async (c) => {
  try {
    await ensureUploadDir();

    const formData = await c.req.formData();
    const file = formData.get('image');

    if (!file || !(file instanceof File)) {
      return c.json({ error: 'No image file provided' }, 400);
    }

    // Validate file type
    const allowedTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      return c.json({ error: 'Invalid file type. Allowed: PNG, JPEG, GIF, WebP' }, 400);
    }

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      return c.json({ error: 'File too large. Max 10MB' }, 400);
    }

    // Generate filename and save
    const filename = generateFilename(file.name);
    const filepath = join(UPLOAD_DIR, filename);

    const buffer = await file.arrayBuffer();
    await writeFile(filepath, Buffer.from(buffer));

    return c.json({
      success: true,
      path: filepath,
      filename,
    });
  } catch (err) {
    console.error('Upload error:', err);
    return c.json({ error: 'Failed to upload image' }, 500);
  }
});

export { upload };
