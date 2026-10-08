import type { SupabaseClient } from '@supabase/supabase-js';
import { ZELLE_QR_BUCKET } from '@/lib/zelle-qr';

/** Long enough to scan at the table; the bill page re-fetches (and re-signs) on wake. */
const SIGNED_URL_TTL_SECONDS = 60 * 60;

/** Short-lived URL for a private Zelle QR object, or null if there is none. */
export async function signZelleQr(db: SupabaseClient, path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await db.storage.from(ZELLE_QR_BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error) {
    console.error('Error signing Zelle QR:', error);
    return null;
  }
  return data.signedUrl;
}

/** Profile row as the client sees it: storage path swapped for a signed URL. */
export async function presentProfile<T extends { zelle_qr_path?: string | null }>(
  db: SupabaseClient,
  profile: T
): Promise<Omit<T, 'zelle_qr_path'> & { zelle_qr_url: string | null }> {
  const { zelle_qr_path, ...rest } = profile;
  return { ...rest, zelle_qr_url: await signZelleQr(db, zelle_qr_path) };
}
