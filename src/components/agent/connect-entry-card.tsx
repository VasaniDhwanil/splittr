'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { useClaudeConnectEnabled } from './use-claude-connect';

/** Quiet row on the signed-in home page. Renders nothing while Claude cannot connect. */
export function ConnectEntryCard() {
  const enabled = useClaudeConnectEnabled();
  if (!enabled) return null;
  return (
    <Link
      href="/connect"
      className="surface tactile group mt-10 flex items-center justify-between gap-4 rounded-2xl px-5 py-4 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <span className="min-w-0">
        <span className="block font-medium tracking-tight text-white">Use Splittr from Claude</span>
        <span className="mt-0.5 block text-sm text-white/45">
          Ask about your bills and balances, or have Claude draft a bill for you to approve.
        </span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-white/30" aria-hidden />
    </Link>
  );
}
