import { CopyButton } from './copy-button';

/** The exact command that adds Splittr to Claude Code. */
export const claudeCodeCommand = (mcpUrl: string) => `claude mcp add --transport http splittr ${mcpUrl}`;

function CodeRow({ value, copyLabel }: { value: string; copyLabel: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] py-2 pr-2 pl-4">
      <code className="min-w-0 flex-1 break-words font-mono text-xs leading-relaxed text-white/80">{value}</code>
      <CopyButton value={value} label="Copy" ariaLabel={copyLabel} />
    </div>
  );
}

/** Splittr's address with a copy button, and the plain warning to type it exactly. */
export function McpAddress({ mcpUrl }: { mcpUrl: string }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-white/40">Splittr&apos;s address</p>
      <CodeRow value={mcpUrl} copyLabel="Copy address" />
      <p className="text-xs leading-relaxed text-white/40">
        Type it exactly as shown: with <span className="font-mono">www</span>, and nothing after{' '}
        <span className="font-mono">/api/mcp</span>. Leaving out <span className="font-mono">www</span> or adding a{' '}
        <span className="font-mono">/</span> at the end will not connect.
      </p>
    </div>
  );
}

const STEPS = 'list-decimal space-y-1 pl-5 text-sm leading-relaxed text-white/60 marker:text-white/30';

/** Steps for claude.ai, the Desktop app and the mobile apps. */
export function ClaudeWebSteps() {
  return (
    <ol className={STEPS}>
      <li>On claude.ai or in the Desktop app, open Customize, then Connectors.</li>
      <li>Choose Add, then Add custom connector.</li>
      <li>Give it a name, such as Splittr, and paste the address above.</li>
      <li>Sign in to Splittr when Claude asks. Once it is added, it is there on your phone too.</li>
    </ol>
  );
}

/** Steps for Claude Code, with the copyable command. */
export function ClaudeCodeSteps({ mcpUrl }: { mcpUrl: string }) {
  return (
    <>
      <ol className={STEPS}>
        <li>Run this command in your terminal.</li>
        <li>In Claude Code, run /mcp, pick Splittr, and follow the steps in your browser to sign in.</li>
      </ol>
      <CodeRow value={claudeCodeCommand(mcpUrl)} copyLabel="Copy command" />
    </>
  );
}
