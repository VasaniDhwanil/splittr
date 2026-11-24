'use client';

import { useEffect, useState } from 'react';

/** Reads the public status route. Null until it answers; false on any failure. */
export async function fetchClaudeConnectEnabled(): Promise<boolean> {
  try {
    const res = await fetch('/api/agent-access/status', { cache: 'no-store' });
    if (!res.ok) return false;
    const body = await res.json();
    return body?.enabled === true;
  } catch {
    return false;
  }
}

/** True only once the server has said Claude can connect. Entry points render nothing until then. */
export function useClaudeConnectEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let live = true;
    void fetchClaudeConnectEnabled().then((on) => {
      if (live) setEnabled(on);
    });
    return () => {
      live = false;
    };
  }, []);
  return enabled;
}
