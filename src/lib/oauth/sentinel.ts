/**
 * Is the database really answering? agent_oauth_sentinel always holds one row
 * (migration 019). A correctly keyed token or code that is "not found" is only
 * believed when this row can be read; otherwise the database may be waking up
 * with empty results, and the caller must answer 503, not invalid_grant.
 */
import { createAdminClient } from '@/lib/supabase/admin';

export async function sentinelIntact(): Promise<boolean> {
  try {
    const { data, error } = await createAdminClient().from('agent_oauth_sentinel').select('id').eq('id', 1).maybeSingle();
    return !error && data !== null;
  } catch {
    return false;
  }
}
