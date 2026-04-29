import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

// Storage abstraction. Two backends:
//   - Supabase Storage: when SUPABASE_URL + SUPABASE_SECRET_KEY are set.
//     Files survive redeploys, no volume needed. Public URL returned.
//   - Local filesystem: fallback for dev / when those env vars are missing.
//     Files are at <uploadDir>/<filename> and served from /uploads/<filename>.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_KEY;
const BUCKET = process.env.SUPABASE_BUCKET || 'images';

let supabase = null;
export const STORAGE_MODE =
  SUPABASE_URL && SUPABASE_KEY ? 'supabase' : 'local';

if (STORAGE_MODE === 'supabase') {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  console.log(`[storage] mode=supabase bucket=${BUCKET}`);
} else {
  console.log('[storage] mode=local (set SUPABASE_URL + SUPABASE_SECRET_KEY for cloud storage)');
}

/**
 * @param {{buffer: Buffer, filename: string, mimetype: string, localDir: string}} args
 * @returns {Promise<{ url: string }>}
 */
export async function uploadImage({ buffer, filename, mimetype, localDir }) {
  if (STORAGE_MODE === 'supabase') {
    const key = filename;
    const { error } = await supabase
      .storage
      .from(BUCKET)
      .upload(key, buffer, {
        contentType: mimetype,
        upsert: false,
        cacheControl: '604800', // 7 days
      });
    if (error) throw new Error(`supabase: ${error.message}`);
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(key);
    return { url: data.publicUrl };
  }

  fs.mkdirSync(localDir, { recursive: true });
  const fullPath = path.join(localDir, filename);
  fs.writeFileSync(fullPath, buffer);
  return { url: `/uploads/${filename}` };
}
