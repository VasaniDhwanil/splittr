'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Reveal } from '@/components/groups/reveal';
import { SummaryRow } from '@/components/create/summary-row';
import { formatCurrency } from '@/lib/calculations';
import { formatClock, formatDay, formatTimeLeft } from '@/lib/agent-ui';

interface Proposal {
  id: string;
  name: string;
  items: { name: string; price: number; quantity: number }[];
  subtotal: number;
  tax: number;
  tip_amount: number;
  total: number;
  split_mode: 'items' | 'even' | 'custom';
  created_at: string;
  expires_at: string;
  token_name: string | null;
  warnings: string[];
}

type View =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'gone' }
  | { kind: 'expired' }
  | { kind: 'error' }
  | { kind: 'ready'; proposal: Proposal };

const SPLIT_COPY: Record<Proposal['split_mode'], string> = {
  items: 'Everyone taps the items they had. Each person pays for those, plus a share of the tax and tip.',
  even: 'Split evenly between everyone who joins.',
  custom: 'You set each person’s amount yourself.',
};

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

export default function ApprovePage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [busy, setBusy] = useState<'approve' | 'decline' | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/agent-bills/${id}`, { cache: 'no-store' });
      if (res.status === 401) return setView({ kind: 'signed-out' });
      if (res.status === 404) return setView({ kind: 'gone' });
      if (!res.ok) return setView({ kind: 'error' });
      const proposal = (await res.json()) as Proposal;
      setView({ kind: 'ready', proposal: { ...proposal, warnings: proposal.warnings ?? [] } });
    } catch {
      setView({ kind: 'error' });
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Only a press on the button approves. Nothing here runs on load.
  const act = async (action: 'approve' | 'decline') => {
    if (busy) return;
    setBusy(action);
    try {
      const res = await fetch(`/api/agent-bills/${id}/${action}`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (res.status === 401) return setView({ kind: 'signed-out' });
      if (res.status === 404) return setView({ kind: 'gone' });
      if (res.status === 410) return setView({ kind: 'expired' });
      if (!res.ok) throw new Error();
      if (action === 'approve') {
        toast.success('Bill approved. It is live now, so you can share it.');
        router.push(`/bill/${body.bill_id ?? id}`);
      } else {
        toast.success('Proposal declined. Nothing was created.');
        router.push('/');
      }
    } catch {
      toast.error('That did not go through. Please try again.');
    } finally {
      setBusy(null);
    }
  };

  if (view.kind === 'loading') {
    return (
      <PageShell>
        <div className="animate-pulse space-y-6" aria-busy="true" aria-label="Loading proposal">
          <div className="h-9 w-64 max-w-full rounded-md bg-white/[0.05]" />
          <div className="h-4 w-full rounded-md bg-white/[0.04]" />
          <div className="surface h-64 rounded-2xl" />
        </div>
      </PageShell>
    );
  }

  if (view.kind === 'signed-out') {
    return (
      <PageShell>
        <Message title="Sign in to approve">
          <p>
            Your agent proposed a bill for you. To look at it and approve it, you need to be signed in to your Splittr
            account.
          </p>
          <Button asChild size="lg" className="mt-4 w-full">
            <Link href={`/signin?next=/approve/${id}`}>Sign in</Link>
          </Button>
        </Message>
      </PageShell>
    );
  }

  if (view.kind === 'gone') {
    return (
      <PageShell>
        <Message title="Nothing to approve here">
          <p>This proposal is not waiting for you. It may already be approved or declined, or it may have run out of time.</p>
          <p>If your agent is still working on it, ask it to propose the bill again.</p>
          <Button asChild variant="secondary" className="mt-2">
            <Link href="/">Go to your bills</Link>
          </Button>
        </Message>
      </PageShell>
    );
  }

  if (view.kind === 'expired') {
    return (
      <PageShell>
        <Message title="This proposal ran out of time">
          <p>Proposals only last 24 hours. Nothing was created. Ask your agent to propose the bill again.</p>
          <Button asChild variant="secondary" className="mt-2">
            <Link href="/">Go to your bills</Link>
          </Button>
        </Message>
      </PageShell>
    );
  }

  if (view.kind === 'error') {
    return (
      <PageShell>
        <Message title="Could not load this">
          <p>Something went wrong on our side. Check your connection and try again.</p>
          <Button variant="secondary" className="mt-2" onClick={() => { setView({ kind: 'loading' }); void load(); }}>
            Try again
          </Button>
        </Message>
      </PageShell>
    );
  }

  const p = view.proposal;
  return (
    <PageShell>
      <div className="space-y-8">
        <Reveal index={0}>
          <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">Approve this bill?</h1>
          <p className="mt-2 text-sm leading-relaxed text-white/50">
            {p.token_name ? (
              <>
                Your agent, using the token <span className="text-white/70">{p.token_name}</span>, proposed this bill.
              </>
            ) : (
              'Your agent proposed this bill.'
            )}{' '}
            Until you approve it, nobody else can see it, join it or claim anything on it.
          </p>
        </Reveal>

        {p.warnings.length > 0 && (
          <Reveal index={1}>
            <div role="note" aria-label="Things to check" className="border-l-2 border-white/25 pl-4">
              <p className="text-sm font-medium text-white">Check these before you approve</p>
              <ul className="mt-1.5 space-y-1 text-sm leading-relaxed text-white/60">
                {p.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          </Reveal>
        )}

        <Reveal index={2}>
          <section className="surface rounded-2xl p-5" aria-label="The proposed bill">
            <p className="text-xs font-medium text-white/40">Written by your agent</p>
            <h2 className="mt-2 break-words text-xl font-semibold tracking-tight text-white">{p.name}</h2>

            <ul className="mt-4 divide-y divide-white/[0.06] border-t border-white/[0.06]">
              {p.items.map((item, i) => (
                <li key={i} className="flex items-baseline justify-between gap-4 py-3">
                  <span className="min-w-0 break-words text-sm text-white">{item.name}</span>
                  <span className="shrink-0 whitespace-nowrap text-sm text-white/60">
                    {item.quantity > 1 && (
                      <span className="tabular-nums">
                        {item.quantity} &times; {formatCurrency(item.price)}
                        <span className="mx-2 text-white/25" aria-hidden>
                          &middot;
                        </span>
                      </span>
                    )}
                    <span className="font-money text-white">{formatCurrency(item.price * item.quantity)}</span>
                  </span>
                </li>
              ))}
            </ul>

            <div className="space-y-1.5 border-t border-white/[0.06] pt-4">
              <SummaryRow label="Subtotal">{formatCurrency(p.subtotal)}</SummaryRow>
              <SummaryRow label="Tax">{formatCurrency(p.tax)}</SummaryRow>
              <SummaryRow label="Tip">{formatCurrency(p.tip_amount)}</SummaryRow>
              <div className="pt-1.5">
                <SummaryRow label="Total" strong>
                  {formatCurrency(p.total)}
                </SummaryRow>
              </div>
            </div>
          </section>
        </Reveal>

        <Reveal index={3} className="space-y-4 border-t border-white/10 pt-6">
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs font-medium text-white/40">How it will be split</dt>
              <dd className="mt-0.5 leading-relaxed text-white/70">{SPLIT_COPY[p.split_mode] ?? SPLIT_COPY.items}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-white/40">Proposed by</dt>
              <dd className="mt-0.5 text-white/70">{p.token_name ?? 'A token that has since been removed'}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-white/40">This proposal expires</dt>
              <dd className="mt-0.5 text-white/70">
                {formatDay(p.expires_at)} at {formatClock(p.expires_at)} ({formatTimeLeft(p.expires_at)})
              </dd>
            </div>
          </dl>
        </Reveal>

        <Reveal index={4} className="space-y-3">
          <Button size="lg" className="w-full" disabled={busy !== null} onClick={() => void act('approve')}>
            {busy === 'approve' ? (
              <>
                <Loader2 className="animate-spin" />
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
            onClick={() => void act('decline')}
          >
            {busy === 'decline' ? (
              <>
                <Loader2 className="animate-spin" />
                Declining...
              </>
            ) : (
              'Decline'
            )}
          </Button>
          <p className="text-xs leading-relaxed text-white/35">
            Approving makes it a normal bill you can share. Declining deletes it. If you decline several in a short
            time, Splittr pauses that token.
          </p>
        </Reveal>
      </div>
    </PageShell>
  );
}
