/**
 * Resolves an OAuth access token to the v1 Actor, for /api/mcp. Same shape as
 * resolveAgentToken in agent-access.ts so the endpoint can treat both kinds
 * alike. Malformed values are refused before any database call.
 */
import type { Actor } from '@/lib/agent-access';
import type { AgentScope } from '@/lib/agent-tokens';
import { sentinelIntact } from '@/lib/oauth/sentinel';
import { hashOAuthSecret, parseOAuthToken } from '@/lib/oauth/tokens';
import { createAdminClient } from '@/lib/supabase/admin';

export type OAuthResolveFailure = 'malformed' | 'unknown' | 'expired' | 'revoked' | 'unavailable';

export type OAuthResolveResult =
  | {
      ok: true;
      actor: Actor;
      /** A suspended grant authenticates but is refused with a 403 (S7), not a 401, so Claude does not restart sign-in. */
      suspended: boolean;
      /** Why it was suspended, when it was. */
      detail?: string;
    }
  | { ok: false; reason: OAuthResolveFailure };

interface GrantRow {
  id: string;
  user_id: string;
  scopes: string[];
  kind: string;
  oauth_status: string | null;
  expires_at: string;
  revoked_at: string | null;
  suspended_at: string | null;
  suspended_reason: string | null;
}

/**
 * The liveness join is the guarantee: a token works only while its grant is
 * live (not pending, not revoked, not expired), whatever else is in the table.
 * 'unavailable' means the database could not answer: the token may well be fine.
 */
export async function resolveOAuthAccessToken(token: unknown): Promise<OAuthResolveResult> {
  if (parseOAuthToken(token) !== 'access') return { ok: false, reason: 'malformed' };

  let data: { type: string; expires_at: string; grant: GrantRow | GrantRow[] | null } | null;
  try {
    const result = await createAdminClient()
      .from('agent_oauth_tokens')
      .select(
        'type, expires_at, grant:agent_tokens!inner(id, user_id, scopes, kind, oauth_status, expires_at, revoked_at, suspended_at, suspended_reason)'
      )
      .eq('hash', hashOAuthSecret(token as string))
      .maybeSingle();
    if (result.error) return { ok: false, reason: 'unavailable' };
    data = result.data as typeof data;
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
  // Not found is only believed while the database answers like itself (sentinel)
  if (!data) return (await sentinelIntact()) ? { ok: false, reason: 'unknown' } : { ok: false, reason: 'unavailable' };

  const grant = Array.isArray(data.grant) ? data.grant[0] : data.grant;
  if (data.type !== 'access' || !grant || grant.kind !== 'oauth') return { ok: false, reason: 'unknown' };

  if (grant.revoked_at) return { ok: false, reason: 'revoked' };
  if (grant.oauth_status !== 'live') return { ok: false, reason: 'unknown' };
  const now = Date.now();
  if (new Date(data.expires_at).getTime() <= now || new Date(grant.expires_at).getTime() <= now) {
    return { ok: false, reason: 'expired' };
  }

  return {
    ok: true,
    actor: { userId: grant.user_id, tokenId: grant.id, scopes: grant.scopes as AgentScope[] },
    suspended: grant.suspended_at !== null,
    ...(grant.suspended_at !== null && grant.suspended_reason ? { detail: grant.suspended_reason } : {}),
  };
}
