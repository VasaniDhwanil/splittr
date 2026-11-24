'use client';

import Link from 'next/link';
import { useClaudeConnectEnabled } from '@/components/agent/use-claude-connect';

/** Footer link to /connect, shown only once the server says Claude can connect. */
export function ConnectFooterLink() {
  const enabled = useClaudeConnectEnabled();
  if (!enabled) return null;
  return (
    <Link href="/connect" className="whitespace-nowrap transition-colors hover:text-white">
      Use with Claude
    </Link>
  );
}
