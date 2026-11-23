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
import { connectionTitle } from '@/lib/oauth-ui';
import { CopyButton } from './copy-button';
import { CreateTokenDialog } from './create-token-dialog';

interface TokenList {
  mcpUrl: string;
  tokens: TokenRow[];
}

const labelOf = (t: TokenRow) => (t.kind === 'oauth' ? connectionTitle(t.destination) : t.name);

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
  const oauth = token.kind === 'oauth';
  const title = oauth ? connectionTitle(token.destination) : token.name;
  return (
    <li className={`px-4 py-4 ${dead ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words font-medium text-white">{title}</p>
          <p className="mt-0.5 text-xs text-white/45">
            <TokenState token={token} />
          </p>
        </div>
        {!oauth && token.last4 && (
          <span className="font-mono shrink-0 text-xs text-white/35" aria-label={`Ends in ${token.last4}`}>
            ...{token.last4}
          </span>
        )}
      </div>

      <ul className="mt-2 space-y-0.5 text-sm text-white/60">
        {token.scopes.map((s) => (
          <li key={s}>{SCOPE_LABELS[s] ?? s}</li>
        ))}
      </ul>

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-5 gap-y-1 text-xs">
        <dt className="text-white/35">{oauth ? 'Connected' : 'Created'}</dt>
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
            aria-label={`Revoke ${title}`}
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
      toast.success(`${labelOf(revoking)} no longer works`);
      setRevoking(null);
      await load();
    } catch {
      toast.error('Could not revoke that. Please try again.');
    } finally {
      setPending(false);
    }
  };

  const resume = async (token: TokenRow) => {
    setResumingId(token.id);
    try {
      const { res } = await post(`/api/agent-tokens/${token.id}/resume`);
      if (!res.ok) throw new Error();
      toast.success(`${labelOf(token)} is back on`);
      await load();
    } catch {
      toast.error('Could not turn that back on. Please try again.');
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
  const connections = data.tokens.filter((t) => t.kind === 'oauth');
  const personal = data.tokens.filter((t) => t.kind !== 'oauth');
  const claudeCodeCommand = `claude mcp add --transport http splittr ${data.mcpUrl}`;

  const renderList = (rows: TokenRow[], label: string) => (
    <ul className="surface divide-y divide-white/[0.06] overflow-hidden rounded-2xl" aria-label={label}>
      {rows.map((t) => (
        <TokenItem
          key={t.id}
          token={t}
          onRevoke={() => setRevoking(t)}
          onResume={() => void resume(t)}
          resuming={resumingId === t.id}
        />
      ))}
    </ul>
  );

  return (
    <>
      <Section
        index={index}
        title="Agent access"
        description="Let Claude, or another AI agent, look at your bills and balances. It can also draft a bill for you, but a draft stays invisible until you approve it here on Splittr."
      >
        <div className="space-y-8">
          {data.mcpUrl && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-white/70">Connect Claude</h3>
              <div className="surface space-y-5 rounded-2xl p-4">
                <div className="space-y-2">
                  <p className="text-xs font-medium text-white/40">Splittr&apos;s address</p>
                  <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] py-2 pr-2 pl-4">
                    <code className="min-w-0 flex-1 break-all font-mono text-xs leading-relaxed text-white/80">
                      {data.mcpUrl}
                    </code>
                    <CopyButton value={data.mcpUrl} label="Copy" ariaLabel="Copy address" />
                  </div>
                  <p className="text-xs leading-relaxed text-white/40">
                    Type it exactly as shown: with <span className="font-mono">www</span>, and nothing after{' '}
                    <span className="font-mono">/api/mcp</span>. Leaving out <span className="font-mono">www</span> or
                    adding a <span className="font-mono">/</span> at the end will not connect.
                  </p>
                </div>

                <div className="space-y-2 border-t border-white/[0.06] pt-5">
                  <p className="text-sm font-medium text-white">In Claude on the web, the Desktop app or your phone</p>
                  <ol className="list-decimal space-y-1 pl-5 text-sm leading-relaxed text-white/60 marker:text-white/30">
                    <li>
                      On claude.ai or in the Desktop app, open Customize, then Connectors.
                    </li>
                    <li>Choose Add, then Add custom connector.</li>
                    <li>Give it a name, such as Splittr, and paste the address above.</li>
                    <li>Sign in to Splittr when Claude asks. Once it is added, it is there on your phone too.</li>
                  </ol>
                </div>

                <div className="space-y-2 border-t border-white/[0.06] pt-5">
                  <p className="text-sm font-medium text-white">In Claude Code</p>
                  <ol className="list-decimal space-y-1 pl-5 text-sm leading-relaxed text-white/60 marker:text-white/30">
                    <li>Run this command in your terminal.</li>
                    <li>In Claude Code, run /mcp, pick Splittr, and follow the steps in your browser to sign in.</li>
                  </ol>
                  <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] py-2 pr-2 pl-4">
                    <code className="min-w-0 flex-1 break-all font-mono text-xs leading-relaxed text-white/80">
                      {claudeCodeCommand}
                    </code>
                    <CopyButton value={claudeCodeCommand} label="Copy" ariaLabel="Copy command" />
                  </div>
                </div>
              </div>
            </div>
          )}

          {connections.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-white/70">Connections</h3>
              {renderList(connections, 'Your Claude connections')}
            </div>
          )}

          <div className="space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h3 className="text-sm font-medium text-white/70">Personal tokens</h3>
                <p className="mt-0.5 text-xs leading-relaxed text-white/40">
                  For other apps, or if you prefer not to sign in. A token is a password only one agent uses.
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setCreateOpen(true)}
                className="-mr-2 shrink-0 text-white/60 hover:bg-white/[0.06] hover:text-white"
              >
                <Plus />
                New token
              </Button>
            </div>
            {personal.length > 0 ? (
              renderList(personal, 'Your agent tokens')
            ) : (
              <p className="surface rounded-2xl px-4 py-5 text-sm text-white/45">
                No tokens yet. Make one when you are ready to connect an agent.
              </p>
            )}
          </div>

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
                Use this if you think someone else has your account, a connection or a token.
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
        title={revoking?.kind === 'oauth' ? 'Revoke this connection?' : 'Revoke this token?'}
        description={
          revoking
            ? revoking.kind === 'oauth'
              ? `${labelOf(revoking)} stops working right away. To use it again, connect again from Claude. This cannot be undone.`
              : `${revoking.name} stops working right away. Any agent using it will lose access. This cannot be undone; you would make a new token.`
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
