import { NextResponse } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { ensureProfile } from '@/lib/auth-profile'
import { clearMintLock } from '@/lib/agent-access'
import { ALLOWED_ORIGINS } from '@/lib/site-origin'
import { isOAuthAccessToken } from '@/lib/supabase/oauth-guard'

/** Only ever redirect to a same-site path — never to an arbitrary URL. */
function safePath(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/'
  return raw
}

/**
 * Handles both magic-link shapes:
 *
 *  - ?token_hash=...&type=email&redirect_to=<original emailRedirectTo>
 *    (custom email template — verified server-side, works no matter which
 *    browser opens the link, since it doesn't depend on PKCE state)
 *
 *  - ?code=...&next=/path
 *    (default {{ .ConfirmationURL }} template / PKCE round-trip — only works
 *    in the browser that requested the link)
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const tokenHash = searchParams.get('token_hash')

  // Where to land after auth: an explicit ?next=/path, or unwrap it from the
  // redirect_to the email template passed through.
  const redirectToRaw = searchParams.get('redirect_to')
  let next = searchParams.get('next')
  let redirectToUrl: URL | null = null
  if (redirectToRaw) {
    try {
      redirectToUrl = new URL(redirectToRaw)
    } catch {
      redirectToUrl = null
    }
    if (redirectToUrl && !next) {
      next =
        redirectToUrl.pathname === '/auth/callback'
          ? redirectToUrl.searchParams.get('next')
          : redirectToUrl.pathname + redirectToUrl.search
    }
  }
  const dest = safePath(next)

  // The email link always points at the production Site URL. If sign-in was
  // requested from a different allowed origin (e.g. localhost during dev),
  // forward the untouched token there so the session cookie lands on the
  // host the user is actually on.
  if (
    tokenHash &&
    redirectToUrl &&
    ALLOWED_ORIGINS.has(redirectToUrl.origin) &&
    redirectToUrl.origin !== origin
  ) {
    return NextResponse.redirect(
      `${redirectToUrl.origin}/auth/callback?${searchParams.toString()}`
    )
  }

  const supabase = await createClient()

  /** OAuth access tokens never authenticate the web app (R-O1): drop such a session. */
  const refuseOAuthSession = async (accessToken: string | undefined) => {
    if (!isOAuthAccessToken(accessToken)) return null
    await supabase.auth.signOut()
    return NextResponse.redirect(`${origin}/signin?error=auth_failed`)
  }

  if (tokenHash) {
    const type = (searchParams.get('type') as EmailOtpType) || 'email'
    const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
    if (!error) {
      const refused = await refuseOAuthSession(data.session?.access_token)
      if (refused) return refused
      if (data.user) {
        await ensureProfile(data.user)
        // A verified magic link is a fresh sign-in: lift any agent-token lock
        await clearMintLock(data.user.id)
      }
      return NextResponse.redirect(`${origin}${dest}`)
    }
    return NextResponse.redirect(
      `${origin}/signin?error=otp_expired&next=${encodeURIComponent(dest)}`
    )
  }

  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      const refused = await refuseOAuthSession(data.session?.access_token)
      if (refused) return refused
      if (data.user) {
        await ensureProfile(data.user)
        await clearMintLock(data.user.id)
      }
      return NextResponse.redirect(`${origin}${dest}`)
    }
  }

  // GoTrue reports verify failures via error_code in the redirect.
  const reason =
    searchParams.get('error_code') === 'otp_expired' ? 'otp_expired' : 'auth_failed'
  return NextResponse.redirect(
    `${origin}/signin?error=${reason}&next=${encodeURIComponent(dest)}`
  )
}
