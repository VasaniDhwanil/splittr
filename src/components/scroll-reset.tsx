'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

/**
 * The app scrolls inside #app-scroll (not the document), so the browser's
 * automatic scroll-to-top on navigation doesn't apply — do it ourselves.
 */
export function ScrollReset() {
  const pathname = usePathname();
  useEffect(() => {
    document.getElementById('app-scroll')?.scrollTo(0, 0);
  }, [pathname]);
  return null;
}
