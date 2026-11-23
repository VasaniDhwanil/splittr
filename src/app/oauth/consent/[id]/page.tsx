'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FIELD_INPUT, Field } from '@/components/create/field';
import { Reveal } from '@/components/groups/reveal';
import { CheckRow } from '@/components/oauth/check-row';
import { createClient } from '@/lib/supabase/client';
import { formatDay, SCOPE_LABELS } from '@/lib/agent-ui';
import {
  askerText,
  connectionName,
  consentErrorMessage,
  LOOPBACK_WARNING,
  PHISHING_WARNING,
  REQUEST_GONE_TEXT,
  type OAuthDestination,
} from '@/lib/oauth-ui';

interface ConsentRequest {
  id: string;
  destination: OAuthDestination;
  destination_label: string;
  redirect_host: string;
  client_name: string;
  requested_scopes: string[];
  expires_at: string;
  account_email: string | null;
  step_up: { fresh_sign_in_ok: boolean; code_required: boolean; code_sent: boolean };
  existing: { id: string; destination: OAuthDestination; connected_at: string; scopes: string[] }[];
  replace_default: boolean;
}

type View =
  | { kind: 'loading' }
  | { kind: 'gone' }
  | { kind: 'expired' }
  | { kind: 'error' }
  | { kind: 'returning'; url: string }
  | { kind: 'ready'; request: ConsentRequest };

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-dvh py-8">
      <div className="container mx-auto max-w-lg px-4">
        <Link
          href="/"
          className="mb-8 inline-flex h-11 items-center gap-2 text-sm text-white/40 transition-colors hover:text-white"
        >
          <ArrowLeft className="size-4" />
          Back to home
        </Link>
        {children}
      </div>
    </main>
  );
}

function Message({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Reveal>
      <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">{title}</h1>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-white/50">{children}</div>
    </Reveal>
  );
}

export default function ConsentPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const consentPath = `/oauth/consent/${id}`;

  const [view, setView] = useState<View>({ kind: 'loading' });
  const [proposeBills, setProposeBills] = useState(false);
  const [replace, setReplace] = useState(false);
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [codeNote, setCodeNote] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState<'approve' | 'deny' | 'switch' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [grantLimit, setGrantLimit] = useState(false);

  const goSignIn = useCallback(() => {
    router.replace(`/signin?next=${consentPath}`);
  }, [router, consentPath]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/agent-oauth/requests/${id}`, { cache: 'no-store' });
      if (res.status === 401) return goSignIn();
      if (res.status === 404) return setView({ kind: 'gone' });
      if (!res.ok) return setView({ kind: 'error' });
      const request = (await res.json()) as ConsentRequest;
      setReplace(Boolean(request.replace_default) && request.existing.length > 0);
      setCodeSent(Boolean(request.step_up.code_sent));
      setView({ kind: 'ready', request });
    } catch {
      setView({ kind: 'error' });
    }
  }, [id, goSignIn]);

  useEffect(() => {
    void load();
  }, [load]);

  // The browser must navigate itself: the CSP's form-action blocks a form post that redirects off-site.
  const leaveTo = (url: string) => {
    setView({ kind: 'returning', url });
    window.location.assign(url);
  };

  const fail = (res: Response): boolean => {
    if (res.status === 401) {
      goSignIn();
      return true;
    }
    if (res.status === 404) {
      setView({ kind: 'gone' });
      return true;
    }
    return false;
  };

  const sendCode = async () => {
    if (sending) return;
    setSending(true);
    setProblem(null);
    try {
      const res = await fetch(`/api/agent-oauth/requests/${id}/code`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (fail(res)) return;
      if (!res.ok) {
        setProblem(consentErrorMessage(body.code, body));
        return;
      }
      setCodeSent(true);
      setCode('');
      const minutes = body.code_expires_at
        ? Math.max(1, Math.round((new Date(body.code_expires_at).getTime() - Date.now()) / 60000))
        : 10;
      setCodeNote(`It works for ${minutes} minutes.`);
      toast.success('Code sent. Check your inbox.');
    } catch {
      setProblem(consentErrorMessage(undefined));
    } finally {
      setSending(false);
    }
  };

  // Only a press on a button approves or denies. Nothing here runs on load.
  const approve = async (request: ConsentRequest) => {
    if (busy) return;
    setBusy('approve');
    setProblem(null);
    setGrantLimit(false);
    try {
      const res = await fetch(`/api/agent-oauth/requests/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scopes: proposeBills ? ['read', 'bills:write'] : ['read'],
          replace: request.existing.length > 0 && replace,
          ...(request.step_up.code_required ? { code: code.trim() } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && typeof body.redirect_url === 'string') return leaveTo(body.redirect_url);
      if (fail(res)) return;
      if (body.code === 'expired') return setView({ kind: 'expired' });
      if (body.code === 'grant_limit') return setGrantLimit(true);
      if (body.code === 'wrong_code' || (body.code === 'code_required' && body.attempts_left === 0)) {
        setCode('');
        if (body.attempts_left === 0) setCodeSent(false);
      }
      setProblem(consentErrorMessage(body.code, body));
    } catch {
      setProblem(consentErrorMessage(undefined));
    } finally {
      setBusy((b) => (b === 'approve' ? null : b));
    }
  };

  const deny = async () => {
    if (busy) return;
    setBusy('deny');
    setProblem(null);
    try {
      const res = await fetch(`/api/agent-oauth/requests/${id}/deny`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (res.ok && typeof body.redirect_url === 'string') return leaveTo(body.redirect_url);
      if (fail(res)) return;
      setProblem(consentErrorMessage(body.code, body));
    } catch {
      setProblem(consentErrorMessage(undefined));
    } finally {
      setBusy((b) => (b === 'deny' ? null : b));
    }
  };

  const switchAccount = async () => {
    if (busy) return;
    setBusy('switch');
    try {
      await createClient().auth.signOut();
    } catch {
      // Signing in again below replaces the session either way.
    }
    router.replace(`/signin?next=${consentPath}`);
  };

  if (view.kind === 'loading') {
    return (
      <PageShell>
        <div className="animate-pulse space-y-6" aria-busy="true" aria-label="Loading request">
          <div className="h-9 w-72 max-w-full rounded-md bg-white/[0.05]" />
          <div className="h-4 w-full rounded-md bg-white/[0.04]" />
          <div className="surface h-56 rounded-2xl" />
        </div>
      </PageShell>
    );
  }

  if (view.kind === 'gone' || view.kind === 'expired') {
    return (
      <PageShell>
        <Message title="This request is no longer open">
          <p>{REQUEST_GONE_TEXT}</p>
        </Message>
      </PageShell>
    );
  }

  if (view.kind === 'error') {
    return (
      <PageShell>
        <Message title="Could not load this">
          <p>Something went wrong on our side. Check your connection and try again.</p>
          <Button
            variant="secondary"
            className="mt-2"
            onClick={() => {
              setView({ kind: 'loading' });
              void load();
            }}
          >
            Try again
          </Button>
        </Message>
      </PageShell>
    );
  }

  if (view.kind === 'returning') {
    return (
      <PageShell>
        <div role="status">
          <Message title="Returning you to Claude…">
            <p className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
              This takes a moment.
            </p>
            <p>
              Nothing happened?{' '}
              <a href={view.url} className="text-white underline underline-offset-4">
                Continue
              </a>
            </p>
          </Message>
        </div>
      </PageShell>
    );
  }

  const r = view.request;
  const loopback = r.destination === 'loopback';
  const name = connectionName(r.destination);
  const needsCode = r.step_up.code_required;
  const codeReady = !needsCode || /^\d{6}$/.test(code.trim());
  const heading = loopback ? 'Let an app on this computer connect to Splittr?' : 'Let Claude connect to Splittr?';
  const existingFrom = r.existing.length === 1 ? formatDay(r.existing[0].connected_at) : null;

  return (
    <PageShell>
      <div className="space-y-8">
        <Reveal index={0}>
          <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">{heading}</h1>
          <p className="mt-2 text-sm leading-relaxed text-white/50">
            If you approve, it can see your Splittr bills. You choose below what else it can do, and you can disconnect it
            any time on your profile.
          </p>
        </Reveal>

        <Reveal index={1}>
          <section className="surface rounded-2xl p-5" aria-label="Who is asking">
            <dl className="space-y-4 text-sm">
              <div>
                <dt className="text-xs font-medium text-white/40">Who is asking</dt>
                <dd className="mt-0.5 leading-relaxed text-white">{askerText(r.destination)}</dd>
                {r.client_name && (
                  <dd className="mt-0.5 break-words text-xs text-white/40">calls itself &ldquo;{r.client_name}&rdquo;</dd>
                )}
              </div>
              <div>
                <dt className="text-xs font-medium text-white/40">You will be sent back to</dt>
                <dd className="mt-0.5 break-all font-mono text-sm text-white/80">{r.redirect_host}</dd>
              </div>
              <div className="border-t border-white/[0.06] pt-4">
                <dt className="text-xs font-medium text-white/40">The Splittr account it will connect</dt>
                <dd className="mt-0.5 break-all text-lg font-semibold tracking-tight text-white">
                  {r.account_email ?? 'Your account'}
                </dd>
                <dd className="mt-1">
                  <button
                    type="button"
                    onClick={() => void switchAccount()}
                    disabled={busy !== null}
                    className="-ml-1 inline-flex min-h-11 items-center px-1 text-sm text-white/50 underline-offset-4 transition-colors hover:text-white hover:underline disabled:opacity-50"
                  >
                    Not you? Switch account
                  </button>
                </dd>
              </div>
            </dl>
          </section>
        </Reveal>

        <Reveal index={2}>
          <div role="note" aria-label="Before you continue" className="space-y-2 border-l-2 border-white/25 pl-4">
            <p className="text-sm leading-relaxed text-white/80">{PHISHING_WARNING}</p>
            {loopback && <p className="text-sm leading-relaxed text-white/60">{LOOPBACK_WARNING}</p>}
          </div>
        </Reveal>

        <Reveal index={3}>
          <section className="space-y-1" aria-label="What it will be able to do">
            <h2 className="text-base font-semibold tracking-tight text-white">What it will be able to do</h2>
            <div className="surface mt-3 divide-y divide-white/[0.06] rounded-2xl px-4 py-1.5">
              <div className="py-3">
                <p className="text-sm text-white">{SCOPE_LABELS.read}</p>
                <p className="mt-0.5 text-xs text-white/40">Always included. It can only look.</p>
              </div>
              <CheckRow
                checked={proposeBills}
                onChange={setProposeBills}
                label="Propose new bills (each one waits for your approval on Splittr)"
                helper="It can draft a bill for you. Nobody else sees a draft until you approve it on Splittr."
              />
            </div>
            <p className="pt-3 text-sm text-white/50">
              This lasts 90 days. After that it stops working until you connect again.
            </p>
          </section>
        </Reveal>

        {r.existing.length > 0 && (
          <Reveal index={4}>
            <div className="surface rounded-2xl px-4 py-1.5">
              <CheckRow
                checked={replace}
                onChange={setReplace}
                label={
                  existingFrom
                    ? `Replace my existing ${name} connection from ${existingFrom}`
                    : `Replace my existing ${name} connections`
                }
                helper={
                  loopback
                    ? 'Leave this off to keep other computers connected.'
                    : 'The old one stops working once this one is connected.'
                }
              />
            </div>
          </Reveal>
        )}

        <Reveal index={5} className="space-y-3 border-t border-white/10 pt-6">
          {needsCode ? (
            <div className="space-y-3">
              <h2 className="text-base font-semibold tracking-tight text-white">Check it is you</h2>
              {!codeSent ? (
                <>
                  <p className="text-sm leading-relaxed text-white/50">
                    We will email a 6-digit code to {r.account_email ?? 'your account'}. Enter it here to approve.
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full sm:w-auto"
                    onClick={() => void sendCode()}
                    disabled={sending || busy !== null}
                  >
                    {sending ? (
                      <>
                        <Loader2 className="animate-spin motion-reduce:animate-none" />
                        Sending...
                      </>
                    ) : (
                      'Send me a code'
                    )}
                  </Button>
                </>
              ) : (
                <>
                  <Field
                    htmlFor="consent-code"
                    label="6-digit code"
                    helper={
                      <>
                        We emailed it to {r.account_email ?? 'you'}. {codeNote ?? ''}{' '}
                        <button
                          type="button"
                          onClick={() => void sendCode()}
                          disabled={sending}
                          className="text-white/60 underline underline-offset-4 hover:text-white disabled:opacity-50"
                        >
                          Send a new code
                        </button>
                      </>
                    }
                  >
                    <Input
                      id="consent-code"
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]*"
                      maxLength={6}
                      placeholder="123456"
                      className={`${FIELD_INPUT} font-mono text-lg tracking-[0.35em]`}
                    />
                  </Field>
                </>
              )}
            </div>
          ) : (
            <p className="text-sm leading-relaxed text-white/50">
              You signed in a moment ago, so no extra code is needed.
            </p>
          )}

          {problem && (
            <p role="alert" className="text-sm leading-relaxed text-destructive">
              {problem}
            </p>
          )}
          {grantLimit && (
            <p role="alert" className="text-sm leading-relaxed text-destructive">
              You have 5 connections already. Remove one on your{' '}
              <Link href="/profile" className="underline underline-offset-4">
                profile
              </Link>{' '}
              first.
            </p>
          )}

          <div className="space-y-3 pt-2">
            <Button
              size="lg"
              className="w-full"
              disabled={busy !== null || !codeReady}
              onClick={() => void approve(r)}
            >
              {busy === 'approve' ? (
                <>
                  <Loader2 className="animate-spin motion-reduce:animate-none" />
                  Approving...
                </>
              ) : (
                'Approve'
              )}
            </Button>
            <Button
              size="lg"
              variant="ghost"
              className="w-full border border-white/10 text-white/70 hover:bg-white/[0.06] hover:text-white"
              disabled={busy !== null}
              onClick={() => void deny()}
            >
              {busy === 'deny' ? (
                <>
                  <Loader2 className="animate-spin motion-reduce:animate-none" />
                  Denying...
                </>
              ) : (
                'Deny'
              )}
            </Button>
          </div>
        </Reveal>
      </div>
    </PageShell>
  );
}
