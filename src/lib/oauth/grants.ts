/**
 * What follows the server revoking a grant on its own initiative (reuse of a
 * refresh token, replay of a code) or at the client's request: the audit row,
 * the grant's unapproved proposals, and, for the first two, an email to the
 * owner.
 */
import { auditAgentCall } from '@/lib/agent-access';
import { deleteUnapprovedProposals } from '@/lib/agent-bills';
import { buildAgentTokenStoppedEmail } from '@/lib/agent-emails';
import { sendEmail } from '@/lib/email';
import { oauthIssuer } from '@/lib/oauth/config';
import { createAdminClient } from '@/lib/supabase/admin';

export type RevocationKind = 'refresh_reuse_revoked' | 'code_replay_revoked' | 'revoked_by_client';

const REASON: Record<Exclude<RevocationKind, 'revoked_by_client'>, string> = {
  refresh_reuse_revoked:
    'A refresh token it had already used was presented again. That can mean the connection was copied, so it was disconnected.',
  code_replay_revoked:
    'The one-time code that created this connection was presented a second time. That can mean it was intercepted, so the connection was disconnected.',
};

/** Never throws and never fails the response it follows. */
export async function afterGrantRevoked(input: {
  kind: RevocationKind;
  grantId: string;
  userId: string;
  grantName: string;
  ip: string;
}): Promise<void> {
  try {
    await auditAgentCall({ tokenId: input.grantId, userId: input.userId, tool: 'oauth', outcome: input.kind, ip: input.ip });
    await deleteUnapprovedProposals([input.grantId]);
    if (input.kind === 'revoked_by_client') return;
    const { data: owner } = await createAdminClient().auth.admin.getUserById(input.userId);
    const to = owner?.user?.email;
    if (!to) return;
    const email = buildAgentTokenStoppedEmail({
      tokenName: input.grantName,
      state: 'revoked',
      reason: REASON[input.kind],
      profileUrl: `${oauthIssuer()}/profile`,
    });
    await sendEmail({ to, ...email });
  } catch {
    console.error('oauth grant revocation follow-up failed');
  }
}
