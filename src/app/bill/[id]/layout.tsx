import type { Metadata } from "next";

// Bills are private and ephemeral: keep them out of search indexes.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function BillLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
