import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { clearMintLock, guardAgentSession } from '@/lib/agent-access';
import { deleteUnapprovedProposals } from '@/lib/agent-bills';

/** Revokes every live token, then ends the account's sessions everywhere. */
export async function POST(request: NextRequest) {
  try {
    const guard = await guardAgentSession(request);
    if ('response' in guard) return guard.response;
    const { user, supabase } = guard;

    const { data, error } = await createAdminClient()
      .from('agent_tokens')
      .update({ revoked_at: new Date().toISOString(), revoked_reason: 'revoke_all' })
      .eq('user_id', user.id)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .select('id');
    if (error) {
      console.error('agent-tokens revoke-all failed:', error.code);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    await deleteUnapprovedProposals((data ?? []).map((row) => row.id));

    let signed_out = false;
    try {
      const { error: signOutError } = await supabase.auth.signOut({ scope: 'global' });
      signed_out = !signOutError;
    } catch {
      signed_out = false;
    }
    // Only a confirmed global sign-out counts as a fresh start for minting
    if (signed_out) await clearMintLock(user.id);

    return NextResponse.json({ revoked: data?.length ?? 0, signed_out });
  } catch (error) {
    console.error('Error in agent-tokens revoke-all:', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
