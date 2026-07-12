import { createAdminClient } from '@/lib/supabase/admin';
import type { User } from '@supabase/supabase-js';

/**
 * First sign-in bootstrap: make sure every authenticated user has a profile
 * row, so the profile page has something to load and group joins get a
 * display name. Never overwrites an existing profile.
 */
export async function ensureProfile(user: User): Promise<void> {
  try {
    const db = createAdminClient();
    await db.from('profiles').upsert(
      {
        user_id: user.id,
        display_name: user.email?.split('@')[0] || 'Member',
      },
      { onConflict: 'user_id', ignoreDuplicates: true }
    );
  } catch (err) {
    // Non-fatal: sign-in must still succeed even if the bootstrap fails.
    console.error('ensureProfile failed:', err);
  }
}
