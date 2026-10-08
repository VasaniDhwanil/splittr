import type { ReactNode } from 'react';
import { SiteNav } from '@/components/landing/site-nav';
import { SiteFooter } from '@/components/landing/site-footer';

// Static pages: the nav shows the signed-out state and never calls sign out.
const noop = () => {};

export default function GuidesLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-2xl px-4">
      <SiteNav user={null} onSignOut={noop} />
      <main>{children}</main>
      <SiteFooter signedIn={false} />
    </div>
  );
}
