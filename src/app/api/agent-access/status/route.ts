import { NextResponse } from 'next/server';
import { isAgentAccessEnabled } from '@/lib/agent-tokens';
import { isOAuthEnabled } from '@/lib/oauth/config';

// Public on purpose: it answers one boolean, the same for everyone, so the
// connect page and the entry points can decide whether to show themselves
// before anyone signs in. Claude can connect only when both switches are on.
export async function GET() {
  return NextResponse.json(
    { enabled: isAgentAccessEnabled() && isOAuthEnabled() },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
