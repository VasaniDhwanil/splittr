import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Wordmark } from "../components/Wordmark";
import { C, FONT, useLayout } from "../theme";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** 21 to 24 s: wordmark, the call to action and the address, then black. */
export const EndCard: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { portrait } = useLayout();
  const cta = spring({ frame: frame - 26, fps, config: { damping: 22, stiffness: 90 } });
  const url = interpolate(frame, [38, 54], [0, 1], clamp);

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", fontFamily: FONT }}>
      <Wordmark markSize={portrait ? 120 : 130} fontSize={portrait ? 124 : 132} delay={0} />
      <div
        style={{
          marginTop: portrait ? 64 : 52,
          padding: portrait ? "24px 56px" : "22px 52px",
          borderRadius: 999,
          backgroundColor: C.green,
          color: "#052e16",
          fontSize: portrait ? 44 : 40,
          fontWeight: 600,
          letterSpacing: "-0.01em",
          boxShadow: `0 20px 60px -20px ${C.green}99, inset 0 1px 0 rgba(255,255,255,0.35)`,
          opacity: interpolate(cta, [0, 0.5], [0, 1], clamp),
          scale: String(interpolate(cta, [0, 1], [0.9, 1])),
        }}
      >
        Split a Bill
      </div>
      <div
        style={{
          marginTop: portrait ? 44 : 36,
          fontSize: portrait ? 40 : 36,
          color: C.muted,
          letterSpacing: "0.01em",
          opacity: url,
          translate: `0px ${interpolate(url, [0, 1], [10, 0])}px`,
        }}
      >
        splittr.cash
      </div>
    </AbsoluteFill>
  );
};
