import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { auditAgentCall, noStore, requestIp } from '@/lib/agent-access';
import { destinationText } from '@/lib/oauth/clients';
import { guardConsent } from '@/lib/oauth/consent';
import { emailedCodeRequired, HOSTED_CLIENT_REQUIRES_EMAILED_CODE, readFreshSignIn } from '@/lib/oauth/stepup';
import type { AgentScope } from '@/lib/agent-tokens';

/** What the consent page shows (docs/specs/mcp-oauth.md section 14). Changes nothing. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const guard = await guardConsent(request, id, { post: false });
    if ('response' in guard) return guard.response;
    const { user, supabase, row, client } = guard;

    // The hosted client never takes the shortcut, so skip the claims read for it
    const hostedAlwaysCoded = client.destination === 'claude.ai' && HOSTED_CLIENT_REQUIRES_EMAILED_CODE;
    const fresh = hostedAlwaysCoded ? false : await readFreshSignIn(supabase, user.id);
    const codeRequired = emailedCodeRequired(client, fresh);

    const { data: existing, error } = await createAdminClient()
      .from('agent_tokens')
      .select('id, oauth_destination, created_at, scopes')
      .eq('user_id', user.id)
      .eq('kind', 'oauth')
      .eq('oauth_client_id', client.clientId)
      .eq('oauth_status', 'live')
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });
    if (error) {
      console.error('oauth consent read failed:', error.code);
      return noStore(NextResponse.json({ error: 'Internal server error' }, { status: 500 }));
    }

    await auditAgentCall({ tokenId: null, userId: user.id, tool: 'oauth', outcome: 'consent_shown', ip: requestIp(request) });

    return noStore(
      NextResponse.json({
        id: row.id,
        destination: client.destination,
        destination_label: destinationText(client),
        redirect_host: new URL(row.redirect_uri).hostname,
        client_name: client.label,
        requested_scopes: row.scopes_requested as AgentScope[],
        expires_at: row.expires_at,
        account_email: user.email ?? null,
        step_up: {
          fresh_sign_in_ok: !codeRequired,
          code_required: codeRequired,
          code_sent: Boolean(row.code_hmac && row.code_expires_at && new Date(row.code_expires_at).getTime() > Date.now()),
        },
        existing: (existing ?? []).map((grant) => ({
          id: grant.id,
          destination: grant.oauth_destination,
          connected_at: grant.created_at,
          scopes: grant.scopes,
        })),
        // Hosted Claude has one connection per person in practice; Claude Code runs on several computers
        replace_default: client.destination === 'claude.ai',
      })
    );
  } catch (error) {
    console.error('Error in oauth consent GET:', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
