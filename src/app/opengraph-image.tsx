import { ImageResponse } from "next/og";

export const alt = "Splittr: pay for what you ordered";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const GREEN = "#4ade80";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 96px",
          backgroundColor: "#0b0b0d",
          backgroundImage:
            "radial-gradient(circle at 78% 30%, rgba(74,222,128,0.28) 0%, rgba(74,222,128,0.08) 32%, rgba(11,11,13,0) 62%)",
          color: "#fff",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          {/* Brand mark: the split disc from src/app/icon.svg */}
          <svg width="112" height="112" viewBox="14 10 36 44">
            <path fill={GREEN} d="M43.31 20.69A16 16 0 0 0 20.69 43.31Z" transform="translate(-1.2 -4.2)" />
            <path fill={GREEN} d="M43.31 20.69A16 16 0 0 1 20.69 43.31Z" transform="translate(1.2 4.2)" />
          </svg>
          <div
            style={{
              fontSize: 120,
              fontWeight: 700,
              letterSpacing: -4,
              lineHeight: 1.1,
              paddingBottom: 8,
              backgroundImage: "linear-gradient(90deg, #86efac 0%, #4ade80 50%, #22c55e 100%)",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            Splittr
          </div>
        </div>
        <div style={{ marginTop: 40, fontSize: 64, fontWeight: 700, letterSpacing: -1.5 }}>
          Pay for what you ordered.
        </div>
        <div style={{ marginTop: 20, fontSize: 32, color: "rgba(255,255,255,0.6)" }}>
          Scan the receipt, share a link, everyone taps their items.
        </div>
      </div>
    ),
    size,
  );
}
