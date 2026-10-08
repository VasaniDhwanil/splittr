import {
  AbsoluteFill,
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Avatar } from "../components/Avatar";
import { Caption } from "../components/Caption";
import { FINAL_SHARE, hexFor, ITEMS, ME, money, PEOPLE, SUBTOTAL, TAX, TIP, type SampleItem } from "../data";
import { C, FONT, useLayout } from "../theme";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = Easing.bezier(0.16, 1, 0.3, 1);

/** Local frames for the story beats. */
const YUZU_AT = 58;
const CHURROS_AT = 92;
const COUNT_FROM = 60;
const COUNT_TO = 132;

/** Who holds each item before Ines arrives. */
const RESTING: Record<string, readonly string[]> = {
  birria: ["Rhythm"],
  elote: ["Marcus"],
  yuzu: [],
  churros: ["Tomás"],
  horchata: ["Tomás"],
};

const CARD_W = 640;
const MINE = hexFor(ME);

const Check: React.FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2}>
    <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

type RowProps = { readonly item: SampleItem; readonly index: number };

const Row: React.FC<RowProps> = ({ item, index }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame: frame - 10 - index * 5, fps, config: { damping: 24, stiffness: 110 } });

  const inesAt = item.id === "yuzu" ? YUZU_AT : item.id === "churros" ? CHURROS_AT : null;
  const land = inesAt === null ? 0 : spring({ frame: frame - inesAt, fps, config: { damping: 14, stiffness: 140 } });
  const tint = inesAt === null ? 0 : interpolate(frame, [inesAt, inesAt + 12], [0, 1], clamp);
  const press = inesAt === null ? 1 : interpolate(frame, [inesAt - 4, inesAt, inesAt + 10], [1, 0.975, 1], clamp);

  const resting = RESTING[item.id];
  const restHex = resting.length > 0 ? hexFor(resting[0]) : null;
  const multi = item.quantity > 1;

  const restingStyle: React.CSSProperties = restHex
    ? { backgroundColor: `${restHex}17`, boxShadow: `inset 0 0 0 1.5px ${restHex}40` }
    : { backgroundColor: "rgba(255,255,255,0.04)" };

  const claimedOverlay: React.CSSProperties =
    item.id === "yuzu"
      ? { backgroundColor: `${MINE}17`, boxShadow: `inset 0 0 0 1.5px ${MINE}73` }
      : {
          background: `linear-gradient(100deg, ${hexFor("Tomás")}1f 0%, ${MINE}1f 100%)`,
          boxShadow: `inset 0 0 0 1.5px ${MINE}59`,
        };

  const oldNote = multi ? "1/2 claimed" : null;
  const newNote = multi ? `Split 2 ways · ${money(item.price)} each` : null;

  return (
    <div
      style={{
        position: "relative",
        borderRadius: 12,
        padding: "16px 18px",
        opacity: interpolate(enter, [0, 0.6], [0, 1], clamp),
        translate: `0px ${interpolate(enter, [0, 1], [24, 0])}px`,
        scale: String(press),
        ...restingStyle,
      }}
    >
      {inesAt !== null && (
        <div style={{ position: "absolute", inset: 0, borderRadius: 12, opacity: tint, ...claimedOverlay }} />
      )}
      <div style={{ position: "relative", display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 500, color: "#fff" }}>
            {multi && <span style={{ color: C.faint }}>{item.quantity}× </span>}
            {item.name}
          </div>
          <div style={{ marginTop: 9, height: 26, display: "flex", alignItems: "center", gap: 9 }}>
            <div style={{ display: "flex" }}>
              {resting.map((name) => (
                <Avatar key={name} name={name} size={24} />
              ))}
              {inesAt !== null && (
                <Avatar
                  name={ME}
                  size={24}
                  style={{
                    marginLeft: resting.length > 0 ? -8 : 0,
                    opacity: interpolate(land, [0, 0.3], [0, 1], clamp),
                    scale: String(interpolate(land, [0, 1], [1.8, 1])),
                    translate: `0px ${interpolate(land, [0, 1], [-18, 0])}px`,
                  }}
                />
              )}
            </div>
            {oldNote && newNote && (
              <div style={{ position: "relative", fontSize: 13, color: C.muted, flex: 1, height: 18 }}>
                <span style={{ position: "absolute", left: 0, opacity: 1 - tint }}>{oldNote}</span>
                <span style={{ position: "absolute", left: 0, opacity: tint, whiteSpace: "nowrap" }}>{newNote}</span>
              </div>
            )}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 18, fontWeight: 600, color: "#fff", fontVariantNumeric: "tabular-nums" }}>
            {money(item.price * item.quantity)}
          </div>
          <div
            style={{
              marginTop: 6,
              height: 22,
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: 5,
              fontSize: 15,
              color: MINE,
              fontVariantNumeric: "tabular-nums",
              opacity: tint,
              translate: `0px ${interpolate(tint, [0, 1], [6, 0])}px`,
            }}
          >
            {inesAt !== null && (
              <>
                <Check size={16} color={MINE} />
                {multi ? `1× = ${money(item.price)}` : "Yours"}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

/** 5.5 to 11 s: the bill fills in, Ines claims two things, her share counts up. */
export const BillScene: React.FC<{ readonly duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { portrait } = useLayout();
  const card = spring({ frame, fps, config: { damping: 26, stiffness: 90 } });
  const share = interpolate(frame, [COUNT_FROM, COUNT_TO], [0, FINAL_SHARE], { ...clamp, easing: ease });

  return (
    <AbsoluteFill style={{ alignItems: "center", fontFamily: FONT }}>
      <div
        style={{
          position: "absolute",
          top: portrait ? 300 : 40,
          width: CARD_W,
          transformOrigin: "top center",
          scale: String(
            (portrait ? 1.32 : 1.0) * interpolate(frame, [0, duration], [1, 1.04], clamp),
          ),
          opacity: interpolate(card, [0, 0.5], [0, 1], clamp),
          translate: `0px ${interpolate(card, [0, 1], [30, 0])}px`,
          padding: 26,
          borderRadius: 16,
          backgroundColor: C.glassFill,
          border: `1px solid ${C.glassEdge}`,
          boxShadow: `${C.glassHighlight}, 0 40px 80px -40px ${C.green}40, 0 1px 2px rgba(0,0,0,0.4)`,
          backdropFilter: "blur(20px)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em", color: "#fff" }}>Friday tacos</div>
            <div style={{ marginTop: 3, fontSize: 15, color: C.faint }}>Hosted by Rhythm · 4 people</div>
          </div>
          <div style={{ display: "flex", paddingTop: 4 }}>
            {PEOPLE.map((name, i) => (
              <Avatar key={name} name={name} size={28} style={{ marginLeft: i === 0 ? 0 : -9 }} />
            ))}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {ITEMS.map((item, i) => (
            <Row key={item.id} item={item} index={i} />
          ))}
        </div>

        <div
          style={{
            marginTop: 20,
            paddingTop: 16,
            borderTop: "1px solid rgba(255,255,255,0.10)",
            display: "flex",
            flexDirection: "column",
            gap: 6,
            fontSize: 15,
            color: "rgba(255,255,255,0.5)",
            fontVariantNumeric: "tabular-nums",
            opacity: interpolate(frame, [32, 46], [0, 1], clamp),
          }}
        >
          {(
            [
              ["Subtotal", SUBTOTAL],
              ["Tax", TAX],
              ["Tip (20%)", TIP],
            ] as const
          ).map(([label, v]) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between" }}>
              <span>{label}</span>
              <span>{money(v)}</span>
            </div>
          ))}
        </div>

        <div
          style={{
            marginTop: 16,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderRadius: 12,
            padding: "14px 18px",
            backgroundColor: "rgba(255,255,255,0.04)",
            boxShadow: C.glassHighlight,
            opacity: interpolate(frame, [38, 52], [0, 1], clamp),
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Avatar name={ME} size={26} ring="transparent" />
            <span style={{ fontSize: 15, fontWeight: 500, color: "rgba(255,255,255,0.7)" }}>Your share</span>
          </div>
          <span
            style={{
              fontSize: 30,
              fontWeight: 700,
              letterSpacing: "-0.03em",
              color: C.green,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {money(share)}
          </span>
        </div>
      </div>

      <Caption text="Everyone taps their items." start={18} end={duration} />
    </AbsoluteFill>
  );
};
