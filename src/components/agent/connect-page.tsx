'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Reveal } from '@/components/groups/reveal';
import { Section } from '@/components/groups/section';
import { SiteNav } from '@/components/landing/site-nav';
import { SiteFooter } from '@/components/landing/site-footer';
import { createClient } from '@/lib/supabase/client';
import { CANONICAL_ORIGIN } from '@/lib/site-origin';
import { formatRelativeDate } from '@/lib/format-date';
import { connectionTitle } from '@/lib/oauth-ui';
import { formatDay, SCOPE_LABELS, type TokenRow } from '@/lib/agent-ui';
import { ClaudeCodeSteps, ClaudeWebSteps, McpAddress } from './connect-claude';
import { fetchClaudeConnectEnabled } from './use-claude-connect';

const FALLBACK_URL = `${CANONICAL_ORIGIN}/api/mcp`;

const EXAMPLES = [
  { ask: 'What do I owe Sam this month?', note: null },
  { ask: 'Split this receipt with Priya and Alex.', note: 'Attach a photo of the receipt.' },
  { ask: 'Add last night’s dinner to Splittr.', note: null },
];

type View =
  | { kind: 'loading' }
  | { kind: 'off' }
  | { kind: 'on'; email: string | null; mcpUrl: string; connections: TokenRow[] | null };

function Skeleton() {
  return (
    <div className="space-y-4 pt-12" aria-busy="true" aria-label="Loading">
      <div className="h-9 w-3/4 animate-pulse rounded-md bg-white/[0.05] motion-reduce:animate-none" />
      <div className="h-4 w-full animate-pulse rounded-md bg-white/[0.04] motion-reduce:animate-none" />
      <div className="h-4 w-2/3 animate-pulse rounded-md bg-white/[0.04] motion-reduce:animate-none" />
    </div>
  );
}

function ComingSoon() {
  return (
    <Reveal className="pt-10 pb-20 sm:pt-14">
      <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">Coming soon</h1>
      <p className="mt-5 max-w-[65ch] text-[17px] leading-relaxed text-white/70">
        Soon you will be able to connect Claude to Splittr, ask about your bills and balances, and have Claude draft
        bills for you to approve. It is not switched on yet.
      </p>
      <Button
        asChild
        variant="ghost"
        className="mt-8 border border-white/10 text-white hover:bg-white/[0.06] hover:text-white"
      >
        <Link href="/">Back to Splittr</Link>
      </Button>
    </Reveal>
  );
}

function Connections({ rows }: { rows: TokenRow[] }) {
  const live = rows.filter((t) => t.kind === 'oauth' && (t.status === 'active' || t.status === 'suspended'));
  return (
    <Section
      index={6}
      title="Your connections"
      action={
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="text-white/60 hover:bg-white/[0.06] hover:text-white"
        >
          <Link href="/profile">Manage on your profile</Link>
        </Button>
      }
    >
      {live.length > 0 ? (
        <ul className="surface divide-y divide-white/[0.06] overflow-hidden rounded-2xl" aria-label="Your Claude connections">
          {live.map((t) => (
            <li key={t.id} className="px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 break-words font-medium text-white">{connectionTitle(t.destination)}</p>
                <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-white/45">
                  <span
                    className={`size-1.5 rounded-full ${t.status === 'active' ? 'bg-primary' : 'bg-white/25'}`}
                    aria-hidden
                  />
                  {t.status === 'active' ? 'Active' : 'Paused'}
                </span>
              </div>
              <p className="mt-1 text-sm text-white/55">
                {t.scopes.map((s) => SCOPE_LABELS[s] ?? s).join('. ')}
              </p>
              <p className="mt-2 text-xs text-white/40">
                {`Connected ${formatDay(t.created_at)}. ${t.last_used_at ? `Last used ${formatRelativeDate(t.last_used_at)}.` : 'Never used.'}`}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="surface rounded-2xl px-4 py-5 text-sm text-white/45">
          No Claude connections yet. Follow the steps above and it will show up here.
        </p>
      )}
    </Section>
  );
}

export function ConnectPage() {
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [signedOut, setSignedOut] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      const [enabled, auth] = await Promise.all([
        fetchClaudeConnectEnabled(),
        createClient()
          .auth.getUser()
          .then(({ data }) => data.user)
          .catch(() => null),
      ]);
      if (!live) return;
      if (!enabled) {
        setView({ kind: 'off' });
        return;
      }
      let mcpUrl = FALLBACK_URL;
      let connections: TokenRow[] | null = null;
      if (auth) {
        try {
          const res = await fetch('/api/agent-tokens', { cache: 'no-store' });
          if (res.ok) {
            const body = await res.json();
            if (typeof body?.mcp_url === 'string' && body.mcp_url) mcpUrl = body.mcp_url;
            if (body?.enabled === true && Array.isArray(body.tokens)) connections = body.tokens as TokenRow[];
          }
        } catch {
          // The steps still work without the list.
        }
      }
      if (!live) return;
      setView({ kind: 'on', email: auth?.email ?? null, mcpUrl, connections });
    })();
    return () => {
      live = false;
    };
  }, []);

  const signOut = async () => {
    await createClient().auth.signOut();
    setSignedOut(true);
    toast.success('Signed out');
  };

  const email = view.kind === 'on' && !signedOut ? view.email : null;
  const nav =
    view.kind === 'loading' ? undefined : view.kind === 'on' && email ? { email } : null;

  return (
    <div className="mx-auto w-full max-w-2xl px-4">
      <SiteNav user={nav} onSignOut={() => void signOut()} />
      <main>
        {view.kind === 'loading' && <Skeleton />}
        {view.kind === 'off' && <ComingSoon />}
        {view.kind === 'on' && (
          <div className="pt-10 pb-20 sm:pt-14">
            <Reveal>
              <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">Use Splittr from Claude</h1>
              <p className="mt-5 max-w-[65ch] text-[17px] leading-relaxed text-white/70">
                Connect Claude to your Splittr account and ask about your bills in plain words. Claude can look at your
                bills, groups and balances, and it can draft a new bill for you to approve.
              </p>
            </Reveal>

            <div className="mt-10 space-y-10">
              <Section index={1} title="Things you can ask">
                <ul className="surface divide-y divide-white/[0.06] overflow-hidden rounded-2xl">
                  {EXAMPLES.map((e) => (
                    <li key={e.ask} className="px-5 py-4">
                      <p className="text-white">{e.ask}</p>
                      {e.note && <p className="mt-0.5 text-sm text-white/40">{e.note}</p>}
                    </li>
                  ))}
                </ul>
              </Section>

              <Section index={2} title="What stays in your hands">
                <ul className="space-y-3 text-sm leading-relaxed text-white/60">
                  <li>Claude can read your bills, groups and balances.</li>
                  <li>
                    Claude can only propose bills. Each one waits for your approval on Splittr, and nobody else can see
                    it until you approve.
                  </li>
                  <li>You can disconnect at any time on your profile.</li>
                </ul>
              </Section>

              <Section
                index={3}
                title="Connect Claude"
                description="Claude cannot add Splittr with one click yet, so you paste Splittr's address once."
              >
                <div className="space-y-5">
                  {!email && (
                    <p className="text-sm leading-relaxed text-white/50">
                      You do not need to sign in first. Claude will ask you to sign in to Splittr when you connect.
                    </p>
                  )}
                  <McpAddress mcpUrl={view.mcpUrl} />

                  <div className="surface space-y-3 rounded-2xl p-4">
                    <h3 className="text-sm font-medium text-white">claude.ai, Desktop and mobile</h3>
                    <ClaudeWebSteps />
                  </div>

                  <div className="surface space-y-3 rounded-2xl p-4">
                    <h3 className="text-sm font-medium text-white">Claude Code</h3>
                    <ClaudeCodeSteps mcpUrl={view.mcpUrl} />
                  </div>
                </div>
              </Section>

              <Section index={4} title="Other apps">
                <p className="text-sm leading-relaxed text-white/60">
                  Using Cursor or another app? Make a personal token in Agent access on your{' '}
                  <Link
                    href="/profile"
                    className="text-white underline underline-offset-4 decoration-white/30 transition-colors hover:decoration-white"
                  >
                    profile
                  </Link>
                  .
                </p>
              </Section>

              {email && view.connections && <Connections rows={view.connections} />}
            </div>
          </div>
        )}
      </main>
      {view.kind !== 'loading' && <SiteFooter signedIn={!!email} />}
    </div>
  );
}
