import type { Metadata } from "next";
import { loadBillPreview } from "@/lib/bill-preview";

// Bill data is live (people join and claim items), so never cache the preview.
export const dynamic = "force-dynamic";

// Bills are private and ephemeral: keep them out of search indexes.
const ROBOTS: Metadata["robots"] = { index: false, follow: false };

const GENERIC_DESCRIPTION = "Split the bill by what you ordered.";

const GENERIC: Metadata = {
  title: { absolute: "Splittr" },
  description: GENERIC_DESCRIPTION,
  robots: ROBOTS,
  openGraph: {
    title: "Splittr",
    description: GENERIC_DESCRIPTION,
    type: "website",
    siteName: "Splittr",
    locale: "en_US",
  },
  twitter: { card: "summary_large_image", title: "Splittr", description: GENERIC_DESCRIPTION },
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;

  try {
    // A bill waiting for approval gets the same generic preview as a missing one
    const bill = await loadBillPreview(id);
    if (!bill) return GENERIC;

    const billName = bill.name;
    const host = bill.host;
    const count = bill.count;

    const title = `${billName} · Splittr`;
    const description = [
      host ? `Hosted by ${host}.` : null,
      `${count} ${count === 1 ? "person" : "people"} so far.`,
      "Tap what you ordered and see your share.",
    ]
      .filter(Boolean)
      .join(" ");

    // The image comes from ./opengraph-image.tsx and ./twitter-image.tsx,
    // which Next attaches automatically for this segment.
    return {
      title: { absolute: title },
      description,
      robots: ROBOTS,
      openGraph: {
        title,
        description,
        url: `/bill/${id}`,
        type: "website",
        siteName: "Splittr",
        locale: "en_US",
      },
      twitter: { card: "summary_large_image", title, description },
    };
  } catch {
    return GENERIC;
  }
}

export default function BillLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
