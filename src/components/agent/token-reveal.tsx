'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Segmented } from '@/components/create/segmented';
import { SCOPE_LABELS, formatDay, type AgentScope } from '@/lib/agent-ui';
import { CopyButton } from './copy-button';

export interface MintedToken {
  token: string;
  id: string;
  name: string;
  scopes: AgentScope[];
  last4: string;
  expires_at: string;
}

type Client = 'claude-code' | 'cursor' | 'other';

const CLIENTS = [
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'cursor', label: 'Cursor' },
  { value: 'other', label: 'Other' },
] as const;

/**
 * Setup text per client. The token itself is never inside a snippet; it goes in an
 * environment variable. Claude Code: https://code.claude.com/docs/en/mcp (${VAR}
 * expansion in .mcp.json headers). Cursor: https://cursor.com/docs/context/mcp
 * (${env:NAME} in mcp.json headers).
 */
export function setupSnippets(mcpUrl: string): Record<Client, { intro: string; file?: string; code: string }> {
  return {
    'claude-code': {
      intro:
        'Save the token in an environment variable named SPLITTR_TOKEN, then add Splittr to a Claude Code .mcp.json file. The file refers to the variable, so it holds no secret.',
      file: '.mcp.json',
      code: JSON.stringify(
        {
          mcpServers: {
            splittr: {
              type: 'http',
              url: mcpUrl,
              headers: { Authorization: 'Bearer ${SPLITTR_TOKEN}' },
            },
          },
        },
        null,
        2
      ),
    },
    cursor: {
      intro:
        'Save the token in an environment variable named SPLITTR_TOKEN, then add Splittr to ~/.cursor/mcp.json (or .cursor/mcp.json inside one project). The file refers to the variable, so it holds no secret.',
      file: 'mcp.json',
      code: JSON.stringify(
        {
          mcpServers: {
            splittr: {
              url: mcpUrl,
              headers: { Authorization: 'Bearer ${env:SPLITTR_TOKEN}' },
            },
          },
        },
        null,
        2
      ),
    },
    other: {
      intro: 'Any app that can connect to a remote MCP server over HTTP needs two things:',
      code: `URL: ${mcpUrl}\nHeader: Authorization: Bearer <your token>`,
    },
  };
}

/** Step three: shown once, never stored by us, never written to the URL or the browser. */
export function TokenReveal({ token, mcpUrl, onDone }: { token: MintedToken; mcpUrl: string; onDone: () => void }) {
  const [client, setClient] = useState<Client>('claude-code');
  const snippet = setupSnippets(mcpUrl)[client];

  return (
    <>
      <DialogHeader className="gap-1.5 text-left">
        <DialogTitle className="text-lg font-semibold tracking-tight text-white">Your token is ready</DialogTitle>
        <DialogDescription className="text-sm leading-relaxed text-white/50">
          Copy it now. We will not show it again, and we cannot look it up for you later. If you lose it, make a new one.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3">
        <p className="text-sm font-medium text-white/70">{token.name}</p>
        <div className="surface rounded-xl p-3">
          <code
            data-testid="agent-token-value"
            className="block break-all font-mono text-sm leading-relaxed text-white select-all"
          >
            {token.token}
          </code>
        </div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-white/40">Stops working on {formatDay(token.expires_at)}.</p>
          <CopyButton value={token.token} label="Copy token" />
        </div>
        <ul className="space-y-0.5 text-xs text-white/40">
          {token.scopes.map((s) => (
            <li key={s}>{SCOPE_LABELS[s]}</li>
          ))}
        </ul>
      </div>

      <div className="space-y-2 border-t border-white/10 pt-5">
        <h3 className="text-sm font-semibold text-white">Keep it private</h3>
        <ul className="space-y-2 text-sm leading-relaxed text-white/55">
          <li>
            Anyone who has this token can read your bills as you. Keep it out of files that get shared or committed,
            for example a project&apos;s .mcp.json.
          </li>
          <li>
            Do not paste it into a connector that a whole team shares on claude.ai. Everyone on that team would then
            act as you.
          </li>
        </ul>
      </div>

      <div className="space-y-4 border-t border-white/10 pt-5">
        <h3 className="text-sm font-semibold text-white">Connect your agent</h3>
        <Segmented
          ariaLabel="Which app you are connecting"
          options={CLIENTS}
          value={client}
          onChange={(v) => setClient(v as Client)}
        />
        <p className="text-sm leading-relaxed text-white/55">{snippet.intro}</p>
        {client !== 'other' && (
          <div className="space-y-1.5">
            <p className="text-xs text-white/40">In your terminal, with your token in place of the dots:</p>
            <pre className="surface overflow-x-auto rounded-xl p-3 font-mono text-xs leading-relaxed text-white/80">
              {'export SPLITTR_TOKEN="spl_pat_..."'}
            </pre>
          </div>
        )}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-white/40">{snippet.file ? `In ${snippet.file}:` : 'Settings:'}</p>
            <CopyButton value={snippet.code} label="Copy" ariaLabel="Copy setup text" />
          </div>
          <pre
            data-testid="agent-setup-snippet"
            className="surface whitespace-pre-wrap break-all rounded-xl p-3 font-mono text-xs leading-relaxed text-white/80"
          >
            {snippet.code}
          </pre>
        </div>
      </div>

      <Button size="lg" className="w-full" onClick={onDone}>
        I have saved my token
      </Button>
    </>
  );
}
