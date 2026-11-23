import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ensureProfile } from '@/lib/auth-profile'
import { clearMintLock } from '@/lib/agent-access'
import { readFreshSignIn } from '@/lib/oauth/stepup'
import { ALLOWED_ORIGINS } from '@/lib/site-origin'
import { isOAuthAccessToken } from '@/lib/supabase/oauth-guard'

/**
 * Called by /signin right after it verified the emailed 6-digit code in the
 * browser. The link path does this in /auth/callback; the code path has no
 * server step, so this does the same bootstrap: make sure a profile exists and,
 * only for a session that really just signed in by email, lift the agent-token
 * wrong-code lock. Changes nothing for a session that did not.
 */
export async function POST(request: Request) {
  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin && !ALLOWED_ORIGINS.has(origin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabase.auth.getSession()
  if (isOAuthAccessToken(data.session?.access_token)) {
    await supabase.auth.signOut()
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  await ensureProfile(user)
  if (await readFreshSignIn(supabase, user.id)) await clearMintLock(user.id)
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
}
