import { NextRequest, NextResponse } from 'next/server';
import { clearMintLock, guardAgentSession, revokeAccountTokens } from '@/lib/agent-access';
import { deleteReplacedGrantProposals, deleteUnapprovedProposals } from '@/lib/agent-bills';

/** Revokes every live token, then ends the account's sessions everywhere. */
export async function POST(request: NextRequest) {
  try {
    const guard = await guardAgentSession(request);
    if ('response' in guard) return guard.response;
    const { user, supabase } = guard;

    // Under the account's advisory lock, rows in id order: it cannot deadlock with a redemption
    const revoked = await revokeAccountTokens(user.id, 'revoke_all', false);
    if ('error' in revoked) {
      console.error('agent-tokens revoke-all failed:', revoked.error);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
    const data = revoked.ids.map((id) => ({ id }));

    await deleteUnapprovedProposals(data.map((row) => row.id));
    await deleteReplacedGrantProposals(user.id);

    let signed_out = false;
    try {
      const { error: signOutError } = await supabase.auth.signOut({ scope: 'global' });
      signed_out = !signOutError;
    } catch {
      signed_out = false;
    }
    // Only a confirmed global sign-out counts as a fresh start for minting
    if (signed_out) await clearMintLock(user.id);

    return NextResponse.json({ revoked: data.length, signed_out });
  } catch (error) {
    console.error('Error in agent-tokens revoke-all:', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
