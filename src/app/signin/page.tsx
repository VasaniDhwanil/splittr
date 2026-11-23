'use client';

import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FIELD_INPUT } from '@/components/create/field';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Reveal } from '@/components/groups/reveal';
import { createClient } from '@/lib/supabase/client';
import { safeNext } from '@/lib/safe-next';

export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}

function SignInForm() {
  const searchParams = useSearchParams();
  const next = safeNext(searchParams.get('next'));
  const leadWithCode = next.startsWith('/oauth/consent/');
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    const error = searchParams.get('error');
    // GoTrue sometimes reports failures in the URL fragment, which never
    // reaches the server — check both places.
    const hashExpired =
      typeof window !== 'undefined' && window.location.hash.includes('otp_expired');
    if (error === 'otp_expired' || hashExpired) {
      toast.error(
        'That sign-in link has expired or was already used. Enter your email and we’ll send a fresh one.'
      );
    } else if (error === 'auth_failed') {
      toast.error('Sign-in didn’t go through. Enter your email to try again.');
    }
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setIsLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });

      if (error) {
        toast.error(error.message);
        return;
      }

      setSent(true);
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = code.trim();
    if (!/^\d{6}$/.test(token) || verifying) return;
    setVerifying(true);
    setCodeError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token, type: 'email' });
      if (error) {
        setCodeError('That code is not right or has expired. Check it, or use a new one: go back and ask for another email.');
        return;
      }
      // The link path creates the profile in /auth/callback; do the same here, on the server
      await fetch('/auth/finish', { method: 'POST' }).catch(() => null);
      window.location.assign(next);
    } catch {
      setCodeError('Something went wrong. Please try again.');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <main className="min-h-dvh flex flex-col items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <Link
          href="/"
          className="mb-8 inline-flex h-11 items-center gap-2 text-sm text-white/40 transition-colors hover:text-white"
        >
          <ArrowLeft className="size-4" />
          Back to home
        </Link>

        {!sent ? (
          <Reveal key="form">
            <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">Sign in</h1>
            <p className="mt-2 text-sm leading-relaxed text-white/40">
              {leadWithCode
                ? 'We’ll email you a 6-digit code. Entering it here keeps you in the window Claude opened. No password.'
                : 'We’ll email you a link and a 6-digit code. No password.'}
            </p>

            <form onSubmit={handleSubmit} className="mt-10 space-y-5">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-medium text-white/70">
                  Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  autoFocus
                  required
                  className={FIELD_INPUT}
                />
              </div>

              <Button type="submit" size="lg" disabled={isLoading || !email.trim()} className="w-full">
                {isLoading ? (
                  <>
                    <Loader2 className="animate-spin" />
                    Sending...
                  </>
                ) : (
                  leadWithCode ? 'Email me a code' : 'Email me a link'
                )}
              </Button>
            </form>
          </Reveal>
        ) : (
          <Reveal key="sent">
            <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">Check your email</h1>
            <p className="mt-2 text-sm leading-relaxed text-white/40">
              {leadWithCode ? 'We sent a 6-digit code and a sign-in link to' : 'We sent a sign-in link and a 6-digit code to'}
            </p>
            <p className="mt-1 break-all text-base font-medium text-white">{email}</p>

            <form onSubmit={handleVerify} className="mt-8 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="code" className="text-sm font-medium text-white/70">
                  Enter the 6-digit code from the email
                </Label>
                <Input
                  id="code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]*"
                  maxLength={6}
                  placeholder="123456"
                  autoFocus={leadWithCode}
                  className={`${FIELD_INPUT} font-mono text-lg tracking-[0.35em]`}
                />
                {codeError && (
                  <p role="alert" className="text-xs text-destructive">
                    {codeError}
                  </p>
                )}
                {leadWithCode && (
                  <p className="text-xs leading-relaxed text-white/35">
                    Use the code, not the link. Signing in here keeps you in the window Claude opened.
                  </p>
                )}
              </div>
              <Button type="submit" size="lg" disabled={verifying || code.length !== 6} className="w-full">
                {verifying ? (
                  <>
                    <Loader2 className="animate-spin" />
                    Checking...
                  </>
                ) : (
                  'Sign in'
                )}
              </Button>
            </form>

            <p className="mt-6 text-xs leading-relaxed text-white/35">
              Or open the link in the email on this device. The code works for a few minutes; the link for an hour.
            </p>
            <Button
              type="button"
              variant="ghost"
              className="-ml-5 mt-8 text-white/60 hover:text-white"
              onClick={() => {
                setSent(false);
                setEmail('');
                setCode('');
                setCodeError(null);
              }}
            >
              Use a different email
            </Button>
          </Reveal>
        )}
      </div>
    </main>
  );
}
