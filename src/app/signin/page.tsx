'use client';

import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { ArrowLeft, Loader2, Mail, CheckCircle2 } from 'lucide-react';
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
        {/* Back link */}
        <Link
          href="/"
          className="inline-flex items-center text-white/40 hover:text-white mb-10 transition-smooth text-sm"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to home
        </Link>

        {/* Card */}
        <div className="bg-white/5 border border-white/10 backdrop-blur-sm rounded-2xl p-8">
          {!sent ? (
            <>
              {/* Heading */}
              <div className="mb-8">
                <h1 className="text-3xl font-bold text-white mb-2">
                  Sign in to{' '}
                  <span className="bg-gradient-to-r from-emerald-300 via-green-400 to-lime-300 bg-clip-text text-transparent">
                    Splittr
                  </span>
                </h1>
                <p className="text-white/50 text-sm leading-relaxed">
                  We&apos;ll send you a magic link. No password needed.
                </p>
              </div>

              {/* Form */}
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-white/60 text-sm">
                    Email address
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
                    className="bg-white/5 border-white/10 text-white placeholder:text-white/30 focus-visible:ring-white/20 focus-visible:border-white/30"
                  />
                </div>

                <Button
                  type="submit"
                  size="lg"
                  disabled={isLoading || !email.trim()}
                  className="w-full bg-white text-black hover:bg-white/90 transition-smooth hover:scale-105 rounded-full font-medium"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <Mail className="mr-2 h-4 w-4" />
                      Send magic link
                    </>
                  )}
                </Button>
              </form>
            </>
          ) : (
            <>
              {/* Success state */}
              <div className="text-center py-4">
                <div className="w-14 h-14 bg-white/5 border border-white/10 rounded-full flex items-center justify-center mx-auto mb-6">
                  <CheckCircle2 className="h-7 w-7 text-green-400" />
                </div>
                <h2 className="text-2xl font-bold text-white mb-3">Check your email</h2>
                <p className="text-white/50 text-sm leading-relaxed mb-2">
                  We sent a magic link to
                </p>
                <p className="text-white font-medium text-sm mb-6 bg-white/5 border border-white/10 rounded-lg px-4 py-2 inline-block">
                  {email}
                </p>
                <p className="text-white/40 text-xs leading-relaxed mb-8">
                  Click the link in the email to sign in. It expires in 1 hour.
                </p>
                <button
                  onClick={() => {
                    setSent(false);
                    setEmail('');
                  }}
                  className="text-white/50 hover:text-white text-sm transition-smooth underline underline-offset-4"
                >
                  Use a different email
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
