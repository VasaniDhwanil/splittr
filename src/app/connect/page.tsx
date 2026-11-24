import type { Metadata } from 'next';
import { ConnectPage } from '@/components/agent/connect-page';

const TITLE = 'Use Splittr from Claude';
const DESCRIPTION =
  'Connect Claude to your Splittr account to ask about your bills and balances, or have Claude draft a bill that waits for your approval.';

// Not indexed until the launch.
export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/connect' },
  robots: { index: false, follow: false },
  openGraph: { url: '/connect', title: TITLE, description: DESCRIPTION },
};

export default function Connect() {
  return <ConnectPage />;
}
