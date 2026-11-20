import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { createUser, db } from './helpers/db';

// Spec T-REV verification test: after a global sign-out (what revoke-all
// does), does an access token issued earlier still pass getUser()? The answer
// decides the residual-risk wording in D10, so this test records it.
describe('an access token issued before a global sign-out', () => {
  it('is rejected by getUser() afterwards', async () => {
    const user = await createUser('jwt');
    const { data: link, error } = await db().auth.admin.generateLink({ type: 'magiclink', email: user.email });
    expect(error).toBeNull();

    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: session, error: otpError } = await anon.auth.verifyOtp({
      type: 'magiclink',
      token_hash: link.properties!.hashed_token,
    });
    expect(otpError).toBeNull();
    const jwt = session.session!.access_token;
    expect((await anon.auth.getUser(jwt)).data.user?.id).toBe(user.id);

    await anon.auth.signOut({ scope: 'global' });

    const after = await anon.auth.getUser(jwt);
    expect(after.data.user).toBeNull();
  });
});
