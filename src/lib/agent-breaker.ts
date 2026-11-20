/**
 * Circuit breaker (spec G4). A token whose proposals keep being refused by the
 * input policy, or declined by its owner, is paused and its owner told. Counts
 * come from the audit log, so every instance agrees.
 *
 * Only these count: policy refusals that mean the agent is misbehaving or
 * confused (caps, too many items, duplicates) and the owner's declines.
 * Invalid input, the daily cap and not-found results never do: anyone who can
 * put a bill id in front of an agent could otherwise get it suspended.
 */
import { auditAgentCall } from '@/lib/agent-access';
import { buildAgentTokenStoppedEmail } from '@/lib/agent-emails';
import { sendEmail } from '@/lib/email';
import { agentSiteOrigin } from '@/lib/site-origin';
import { createAdminClient } from '@/lib/supabase/admin';

export const BREAKER = { windowMinutes: 60, maxRefusals: 5, maxDeclines: 3 } as const;

const COUNTED_REFUSALS = ['too_many_items', 'unit_price_cap', 'total_cap', 'duplicate'] as const;
export const isBreakerRefusal = (code: string) => (COUNTED_REFUSALS as readonly string[]).includes(code);

export const DECLINE_OUTCOME = 'approval_declined';
export const APPROVE_OUTCOME = 'approval_approved';
/** Audit tool name for what the owner does with a proposal. */
export const APPROVAL_TOOL = 'approval';

/** Pauses the token if it crossed a threshold. Never throws: it runs after the call it describes. */
export async function evaluateBreaker(tokenId: string | null): Promise<void> {
  if (!tokenId) return;
  try {
    const db = createAdminClient();
    const windowStart = new Date(Date.now() - BREAKER.windowMinutes * 60_000).toISOString();

    // Resuming a token starts a fresh count, or its next refusal would pause it again
    const { data: resumed } = await db
      .from('agent_audit_log')
      .select('created_at')
      .eq('token_id', tokenId)
      .eq('tool', 'token')
      .eq('outcome', 'resumed')
      .gte('created_at', windowStart)
      .order('created_at', { ascending: false })
      .limit(1);
    const since = resumed?.[0]?.created_at ?? windowStart;

    const [refusals, declines] = await Promise.all([
      db
        .from('agent_audit_log')
        .select('id', { count: 'exact', head: true })
        .eq('token_id', tokenId)
        .eq('tool', 'create_bill')
        .in('outcome', COUNTED_REFUSALS.map((code) => `refused:${code}`))
        .gt('created_at', since),
      db
        .from('agent_audit_log')
        .select('id', { count: 'exact', head: true })
        .eq('token_id', tokenId)
        .eq('tool', APPROVAL_TOOL)
        .eq('outcome', DECLINE_OUTCOME)
        .gt('created_at', since),
    ]);

    let reason: string | null = null;
    if ((declines.count ?? 0) >= BREAKER.maxDeclines) {
      reason = `You declined ${BREAKER.maxDeclines} or more of the bills it proposed within an hour, so it was paused.`;
    } else if ((refusals.count ?? 0) >= BREAKER.maxRefusals) {
      reason = `${BREAKER.maxRefusals} or more of the bills it proposed within an hour were refused (over the limits, or repeated), so it was paused.`;
    }
    if (!reason) return;

    // Only the call that flips the flag sends the email
    const { data: paused } = await db
      .from('agent_tokens')
      .update({ suspended_at: new Date().toISOString(), suspended_reason: reason })
      .eq('id', tokenId)
      .is('suspended_at', null)
      .is('revoked_at', null)
      .select('id, user_id, name');
    const row = paused?.[0];
    if (!row) return;

    await auditAgentCall({ tokenId, userId: row.user_id, tool: 'token', outcome: 'suspended' });
    const { data: owner } = await db.auth.admin.getUserById(row.user_id);
    const to = owner?.user?.email;
    if (!to) return;
    const email = buildAgentTokenStoppedEmail({
      tokenName: row.name,
      state: 'suspended',
      reason,
      profileUrl: `${agentSiteOrigin()}/profile`,
    });
    await sendEmail({ to, ...email });
  } catch {
    console.error('agent breaker failed');
  }
}
