import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { isOAuthAccessToken } from '@/lib/supabase/oauth-guard'

// Keeps the Supabase session cookie fresh on every page and API request.
export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // OAuth access tokens never authenticate the web app (R-O1): a session
  // cookie holding one is dropped, for this request and in the browser.
  const { data } = await supabase.auth.getSession()
  if (isOAuthAccessToken(data.session?.access_token)) {
    const names = request.cookies
      .getAll()
      .map(({ name }) => name)
      .filter((name) => /^sb-.+-auth-token(\.\d+)?$/.test(name) || /^sb-.+-auth-token-code-verifier$/.test(name))
    names.forEach((name) => request.cookies.delete(name))
    const cleared = NextResponse.next({ request })
    names.forEach((name) => cleared.cookies.set(name, '', { maxAge: 0, path: '/' }))
    return cleared
  }

  await supabase.auth.getUser()
  return supabaseResponse
}

export const config = {
  matcher: [
    // /api/mcp is left out on purpose: it authenticates with a bearer token
    // only, and must never read or set session cookies. So are the OAuth
    // token and revocation endpoints and the discovery documents. The
    // session-bound consent APIs (/api/agent-oauth) and /oauth/* pages stay in.
    '/((?!api/mcp|api/oauth/|\\.well-known/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
