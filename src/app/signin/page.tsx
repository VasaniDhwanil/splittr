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

export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}

function SignInForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get('next') || '/';
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
              We&apos;ll email you a link. No password.
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
                  'Email me a link'
                )}
              </Button>
            </form>
          </Reveal>
        ) : (
          <Reveal key="sent">
            <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">Check your email</h1>
            <p className="mt-2 text-sm leading-relaxed text-white/40">We sent a sign-in link to</p>
            <p className="mt-1 break-all text-base font-medium text-white">{email}</p>
            <p className="mt-4 text-xs leading-relaxed text-white/35">
              Open it on this device to sign in. It expires in 1 hour.
            </p>
            <Button
              type="button"
              variant="ghost"
              className="-ml-5 mt-8 text-white/60 hover:text-white"
              onClick={() => {
                setSent(false);
                setEmail('');
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
