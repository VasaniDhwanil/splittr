import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { auditAgentCall, noStore, requestIp } from '@/lib/agent-access';
import { guardConsent } from '@/lib/oauth/consent';
import { clientRedirectUrl } from '@/lib/oauth/http';
import { hashOAuthSecret } from '@/lib/oauth/tokens';

/** Deny: close the request and send the browser back to the client with access_denied. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const guard = await guardConsent(request, id, { post: true });
    if ('response' in guard) return guard.response;
    const { user, row, binding } = guard;

    // Conditional: a request approved or denied meanwhile is not touched
    const { data, error } = await createAdminClient()
      .from('agent_oauth_requests')
      .update({ status: 'denied', code_hmac: null, code_expires_at: null })
      .eq('id', row.id)
      .eq('user_id', user.id)
      .eq('binding_hash', hashOAuthSecret(binding))
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .select('id');
    if (error) {
      console.error('oauth deny failed:', error.code);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
    if (!data || data.length === 0) return noStore(NextResponse.json({ error: 'Not found' }, { status: 404 }));

    await auditAgentCall({ tokenId: null, userId: user.id, tool: 'oauth', outcome: 'denied', ip: requestIp(request) });

    return noStore(
      NextResponse.json({
        redirect_url: clientRedirectUrl(row.redirect_uri, {
          error: 'access_denied',
          error_description: 'The person denied the request.',
          state: row.state,
        }),
      })
    );
  } catch (error) {
    console.error('Error in oauth consent deny:', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
