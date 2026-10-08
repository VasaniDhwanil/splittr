import { ImageResponse } from "next/og";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatCurrency } from "@/lib/calculations";

// The admin client (service-role key, supabase-js) runs on Node.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const alt = "A Splittr bill: tap what you ordered and see your share";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const GREEN = "#4ade80";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface BillImageRow {
  name: string | null;
  subtotal: number | string | null;
  tax: number | string | null;
  tip_amount: number | string | null;
  participants: { name: string | null; is_creator: boolean | null }[] | null;
}

interface BillCard {
  name: string;
  host: string | null;
  count: number;
  total: number;
}

function clampText(text: string, max = 70): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

async function loadBill(id: string): Promise<BillCard | null> {
  if (!UUID_RE.test(id)) return null;
  try {
    const { data } = await createAdminClient()
      .from("bills")
      .select("name, subtotal, tax, tip_amount, participants(name, is_creator)")
      .eq("id", id)
      .maybeSingle<BillImageRow>();
    if (!data) return null;
    const people = data.participants ?? [];
    return {
      name: data.name?.trim() || "A shared bill",
      host: people.find((p) => p.is_creator)?.name?.trim() || null,
      count: people.length,
      total: Number(data.subtotal ?? 0) + Number(data.tax ?? 0) + Number(data.tip_amount ?? 0),
    };
  } catch {
    return null;
  }
}

function Mark({ px }: { px: number }) {
  // Brand mark: the split disc from src/app/icon.svg
  return (
    <svg width={px} height={px} viewBox="14 10 36 44">
      <path fill={GREEN} d="M43.31 20.69A16 16 0 0 0 20.69 43.31Z" transform="translate(-1.2 -4.2)" />
      <path fill={GREEN} d="M43.31 20.69A16 16 0 0 1 20.69 43.31Z" transform="translate(1.2 4.2)" />
    </svg>
  );
}

const frame: React.CSSProperties = {
  width: "100%",
  height: "100%",
  display: "flex",
  flexDirection: "column",
  justifyContent: "space-between",
  padding: "80px 96px",
  backgroundColor: "#0b0b0d",
  backgroundImage:
    "radial-gradient(circle at 78% 30%, rgba(74,222,128,0.28) 0%, rgba(74,222,128,0.08) 32%, rgba(11,11,13,0) 62%)",
  color: "#fff",
};

const wordmark: React.CSSProperties = {
  fontSize: 56,
  fontWeight: 700,
  letterSpacing: -2,
  lineHeight: 1.1,
  paddingBottom: 4,
  backgroundImage: "linear-gradient(90deg, #86efac 0%, #4ade80 50%, #22c55e 100%)",
  backgroundClip: "text",
  color: "transparent",
};

function GenericCard({ headline, sub }: { headline: string; sub: string }) {
  return (
    <div style={frame}>
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <Mark px={64} />
        <div style={wordmark}>Splittr</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 72, fontWeight: 700, letterSpacing: -2, lineHeight: 1.1 }}>{headline}</div>
        <div style={{ marginTop: 24, fontSize: 34, color: "rgba(255,255,255,0.6)" }}>{sub}</div>
      </div>
    </div>
  );
}

export default async function BillOpengraphImage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bill = await loadBill(id);

  if (!bill) {
    return new ImageResponse(
      <GenericCard headline="Pay for what you ordered." sub="Scan the receipt, share a link, everyone taps their items." />,
      size,
    );
  }

  const name = clampText(bill.name);
  const people = `${bill.count} ${bill.count === 1 ? "person" : "people"}`;
  const meta = bill.host ? `Hosted by ${clampText(bill.host, 18)} · ${people}` : people;
  const headlineSize = name.length > 40 ? 60 : name.length > 24 ? 68 : 80;

  return new ImageResponse(
    (
      <div style={frame}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <Mark px={64} />
          <div style={wordmark}>Splittr</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "block",
              maxWidth: 1008,
              fontSize: headlineSize,
              fontWeight: 700,
              letterSpacing: -2,
              lineHeight: 1.12,
              // Two lines max; the 70-char cut above keeps this a backstop.
              maxHeight: Math.ceil(headlineSize * 1.12 * 2),
              overflow: "hidden",
              lineClamp: 2,
            }}
          >
            {name}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "space-between",
              marginTop: 32,
              gap: 40,
            }}
          >
            <div style={{ display: "flex", fontSize: 34, color: "rgba(255,255,255,0.6)", whiteSpace: "nowrap" }}>
              {meta}
            </div>
            <div
              style={{ display: "flex", flexShrink: 0, fontSize: 56, fontWeight: 700, color: GREEN, letterSpacing: -1 }}
            >
              {formatCurrency(bill.total)}
            </div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
