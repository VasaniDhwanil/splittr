import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";

// Bill data is live (people join and claim items), so never cache the preview.
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

interface PreviewParticipant {
  name: string | null;
  is_creator: boolean | null;
}

interface BillPreviewRow {
  name: string | null;
  participants: PreviewParticipant[] | null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  if (!UUID_RE.test(id)) return GENERIC;

  try {
    // Service-role read of public-facing fields only; never select tokens.
    const { data } = await createAdminClient()
      .from("bills")
      .select("name, participants(name, is_creator)")
      .eq("id", id)
      .maybeSingle<BillPreviewRow>();
    if (!data) return GENERIC;

    const billName = data.name?.trim() || "A shared bill";
    const people = data.participants ?? [];
    const host = people.find((p) => p.is_creator)?.name?.trim();
    const count = people.length;

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
