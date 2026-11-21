'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Section } from '@/components/groups/section';
import { ConfirmDialog } from '@/components/groups/group-dialog';
import { formatRelativeDate } from '@/lib/format-date';
import {
  SCOPE_LABELS,
  formatDay,
  revokedReasonText,
  type TokenRow,
} from '@/lib/agent-ui';
import { CopyButton } from './copy-button';
import { CreateTokenDialog } from './create-token-dialog';

interface TokenList {
  mcpUrl: string;
  tokens: TokenRow[];
}

/** One line of state: a dot and a plain word. Only an active token is green. */
function TokenState({ token }: { token: TokenRow }) {
  const active = token.status === 'active';
  let text = 'Active';
  if (token.status === 'suspended') {
    text = token.suspended_reason ? `Paused: ${token.suspended_reason}` : 'Paused';
  } else if (token.status === 'expired') {
    text = 'Expired';
  } else if (token.status === 'revoked') {
    text = revokedReasonText(token.revoked_reason).replace(/^./, (c) => c.toUpperCase());
  }
  return (
    <span className="inline-flex items-start gap-1.5">
      <span
        className={`mt-[5px] size-1.5 shrink-0 rounded-full ${active ? 'bg-primary' : 'bg-white/25'}`}
        aria-hidden
      />
      <span>{text}</span>
    </span>
  );
}

function TokenItem({
  token,
  onRevoke,
  onResume,
  resuming,
}: {
  token: TokenRow;
  onRevoke: () => void;
  onResume: () => void;
  resuming: boolean;
}) {
  const dead = token.status === 'expired' || token.status === 'revoked';
  return (
    <li className={`px-4 py-4 ${dead ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words font-medium text-white">{token.name}</p>
          <p className="mt-0.5 text-xs text-white/45">
            <TokenState token={token} />
          </p>
        </div>
        <span className="font-mono shrink-0 text-xs text-white/35" aria-label={`Ends in ${token.last4}`}>
          ...{token.last4}
        </span>
      </div>

      <ul className="mt-2 space-y-0.5 text-sm text-white/60">
        {token.scopes.map((s) => (
          <li key={s}>{SCOPE_LABELS[s] ?? s}</li>
        ))}
      </ul>

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-5 gap-y-1 text-xs">
        <dt className="text-white/35">Created</dt>
        <dd className="text-white/60">{formatDay(token.created_at)}</dd>
        <dt className="text-white/35">{token.status === 'expired' ? 'Expired' : 'Expires'}</dt>
        <dd className="text-white/60">{formatDay(token.expires_at)}</dd>
        <dt className="text-white/35">Last used</dt>
        <dd className="break-words text-white/60">
          {token.last_used_at
            ? `${formatRelativeDate(token.last_used_at)}${token.last_used_ip && token.last_used_ip !== 'unknown' ? `, from ${token.last_used_ip}` : ''}`
            : 'Never used'}
        </dd>
      </dl>

      {(token.status === 'active' || token.status === 'suspended') && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {token.status === 'suspended' && (
            <Button type="button" variant="secondary" size="sm" onClick={onResume} disabled={resuming}>
              Turn back on
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={`text-white/60 hover:bg-white/[0.06] hover:text-white ${token.status === 'active' ? '-ml-3.5' : ''}`}
            onClick={onRevoke}
            aria-label={`Revoke ${token.name}`}
          >
            Revoke
          </Button>
        </div>
      )}
    </li>
  );
}

/**
 * Profile section for agent tokens. Renders nothing when the feature is off or the
 * list cannot be loaded, so it can never break the profile page.
 */
export function AgentAccess({ index = 4 }: { index?: number }) {
  const router = useRouter();
  const [data, setData] = useState<TokenList | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [revoking, setRevoking] = useState<TokenRow | null>(null);
  const [revokeAllOpen, setRevokeAllOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [resumingId, setResumingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/agent-tokens', { cache: 'no-store' });
      if (!res.ok) return;
      const body = await res.json();
      if (!body || body.enabled !== true || !Array.isArray(body.tokens)) {
        setData(null);
        return;
      }
      setData({ mcpUrl: String(body.mcp_url ?? ''), tokens: body.tokens as TokenRow[] });
    } catch {
      // The section just stays hidden.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!data) return null;

  const post = async (url: string, method: 'POST' | 'DELETE' = 'POST') => {
    const res = await fetch(url, { method });
    const body = await res.json().catch(() => ({}));
    return { res, body };
  };

  const confirmRevoke = async () => {
    if (!revoking) return;
    setPending(true);
    try {
      const { res } = await post(`/api/agent-tokens/${revoking.id}`, 'DELETE');
      if (!res.ok) throw new Error();
      toast.success(`${revoking.name} no longer works`);
      setRevoking(null);
      await load();
    } catch {
      toast.error('Could not revoke that token. Please try again.');
    } finally {
      setPending(false);
    }
  };

  const resume = async (token: TokenRow) => {
    setResumingId(token.id);
    try {
      const { res } = await post(`/api/agent-tokens/${token.id}/resume`);
      if (!res.ok) throw new Error();
      toast.success(`${token.name} is back on`);
      await load();
    } catch {
      toast.error('Could not turn that token back on. Please try again.');
    } finally {
      setResumingId(null);
    }
  };

  const revokeAll = async () => {
    setPending(true);
    try {
      const { res, body } = await post('/api/agent-tokens/revoke-all');
      if (!res.ok) throw new Error();
      if (body.signed_out === false) {
        toast.error('Tokens are revoked, but we could not sign you out everywhere. Sign out on your other devices by hand.');
        setRevokeAllOpen(false);
        await load();
        return;
      }
      router.push('/signin');
    } catch {
      toast.error('That did not go through. Please try again.');
    } finally {
      setPending(false);
    }
  };

  const hasLive = data.tokens.some((t) => t.status === 'active' || t.status === 'suspended');

  return (
    <>
      <Section
        index={index}
        title="Agent access"
        description="Let your own AI agent, such as Claude Code or Cursor, look at your bills and balances. It can also draft a bill for you, but a draft stays invisible until you approve it here on Splittr."
        action={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setCreateOpen(true)}
            className="text-white/60 hover:bg-white/[0.06] hover:text-white"
          >
            <Plus />
            New token
          </Button>
        }
      >
        <div className="space-y-6">
          {data.mcpUrl && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-white/70">Address your agent connects to</p>
              <div className="surface flex items-center gap-3 rounded-2xl py-2 pr-2 pl-4">
                <code className="min-w-0 flex-1 break-all font-mono text-xs leading-relaxed text-white/80">
                  {data.mcpUrl}
                </code>
                <CopyButton value={data.mcpUrl} label="Copy" ariaLabel="Copy address" />
              </div>
              <p className="text-xs text-white/35">
                Your agent also needs a token. Make one below; it is a password only that agent uses.
              </p>
            </div>
          )}

          {data.tokens.length > 0 ? (
            <ul className="surface divide-y divide-white/[0.06] overflow-hidden rounded-2xl" aria-label="Your agent tokens">
              {data.tokens.map((t) => (
                <TokenItem
                  key={t.id}
                  token={t}
                  onRevoke={() => setRevoking(t)}
                  onResume={() => void resume(t)}
                  resuming={resumingId === t.id}
                />
              ))}
            </ul>
          ) : (
            <p className="surface rounded-2xl px-4 py-5 text-sm text-white/45">
              No tokens yet. Make one when you are ready to connect an agent.
            </p>
          )}

          {hasLive && (
            <div className="space-y-1">
              <Button
                type="button"
                variant="ghost"
                className="-ml-5 text-white/60 hover:bg-white/[0.06] hover:text-white"
                onClick={() => setRevokeAllOpen(true)}
              >
                Revoke all and sign out everywhere
              </Button>
              <p className="text-xs text-white/35">
                Use this if you think someone else has your account or a token.
              </p>
            </div>
          )}
        </div>
      </Section>

      <CreateTokenDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        mcpUrl={data.mcpUrl}
        onCreated={() => void load()}
      />

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && !pending && setRevoking(null)}
        title="Revoke this token?"
        description={
          revoking
            ? `${revoking.name} stops working right away. Any agent using it will lose access. This cannot be undone; you would make a new token.`
            : undefined
        }
        confirmLabel="Revoke"
        onConfirm={() => void confirmRevoke()}
        isPending={pending}
      />

      <ConfirmDialog
        open={revokeAllOpen}
        onOpenChange={(open) => !pending && setRevokeAllOpen(open)}
        title="Revoke all and sign out everywhere?"
        description="Every agent token stops working. This account is also signed out on every device, including this one, and you will go to the sign-in page."
        confirmLabel="Revoke all and sign out"
        onConfirm={() => void revokeAll()}
        isPending={pending}
      />
    </>
  );
}
