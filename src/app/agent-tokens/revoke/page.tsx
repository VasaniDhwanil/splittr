'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Reveal } from '@/components/groups/reveal';

export default function RevokeLinkPage() {
  return (
    <Suspense>
      <RevokeLink />
    </Suspense>
  );
}

type Result = { kind: 'idle' } | { kind: 'done'; revoked: number } | { kind: 'invalid' } | { kind: 'error' };

function RevokeLink() {
  const secret = useSearchParams().get('s') ?? '';
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>({ kind: 'idle' });

  // Opening this page changes nothing (mail scanners open links). Only the button does.
  const revoke = async () => {
    if (busy || !secret) return;
    setBusy(true);
    try {
      const res = await fetch('/api/agent-tokens/revoke-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret }),
      });
      if (res.status === 404) return setResult({ kind: 'invalid' });
      if (!res.ok) return setResult({ kind: 'error' });
      const body = await res.json().catch(() => ({}));
      setResult({ kind: 'done', revoked: typeof body.revoked === 'number' ? body.revoked : 0 });
    } catch {
      setResult({ kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const invalid = !secret || result.kind === 'invalid';

  return (
    <main className="min-h-dvh flex flex-col items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        {result.kind === 'done' ? (
          <Reveal>
            <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              {result.revoked === 0
                ? 'No tokens left to revoke'
                : `${result.revoked} ${result.revoked === 1 ? 'token' : 'tokens'} revoked`}
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-white/50">
              {result.revoked === 0
                ? 'Every agent token on that account was already turned off.'
                : 'Every agent token on that account has stopped working.'}
            </p>
            <p className="mt-3 text-sm leading-relaxed text-white/50">
              If you think someone else got into your account, sign in and use &ldquo;Revoke all and sign out
              everywhere&rdquo; on your profile. That also signs out every device.
            </p>
            <Button asChild size="lg" className="mt-8 w-full">
              <Link href="/signin?next=/profile">Sign in</Link>
            </Button>
          </Reveal>
        ) : invalid ? (
          <Reveal>
            <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">This link does not work</h1>
            <p className="mt-3 text-sm leading-relaxed text-white/50">
              It is not valid, or it was already used. Nothing was changed. If you are worried about an agent token,
              sign in and revoke it from your profile.
            </p>
            <Button asChild variant="secondary" size="lg" className="mt-8 w-full">
              <Link href="/signin?next=/profile">Sign in</Link>
            </Button>
          </Reveal>
        ) : (
          <Reveal>
            <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">Revoke agent tokens?</h1>
            <p className="mt-3 text-sm leading-relaxed text-white/50">
              You opened this from an email about a new agent token on your Splittr account. Pressing the button turns
              off every agent token on the account that email was sent for. Any AI agent using one loses access at
              once.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-white/50">
              You do not need to be signed in. Nothing happens until you press it.
            </p>
            {result.kind === 'error' && (
              <p role="alert" className="mt-4 text-sm text-destructive">
                That did not go through. Please try again.
              </p>
            )}
            <Button
              variant="destructive"
              size="lg"
              className="mt-8 w-full"
              disabled={busy}
              onClick={() => void revoke()}
            >
              {busy ? (
                <>
                  <Loader2 className="animate-spin" />
                  Revoking...
                </>
              ) : (
                'Revoke all agent tokens'
              )}
            </Button>
          </Reveal>
        )}
      </div>
    </main>
  );
}
