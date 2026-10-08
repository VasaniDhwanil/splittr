import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { FONT, useLayout } from "../theme";

const WORDS = ["Pay", "for", "what", "you", "ordered."] as const;

/** 2.5 to 5.5 s: the promise, word by word. */
export const Headline: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { portrait } = useLayout();
  const fontSize = portrait ? 96 : 110;

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          columnGap: fontSize * 0.26,
          maxWidth: portrait ? 700 : 1600,
          fontFamily: FONT,
          fontSize,
          fontWeight: 600,
          letterSpacing: "-0.035em",
          lineHeight: 1.08,
          color: "#ffffff",
        }}
      >
        {WORDS.map((word, i) => {
          const s = spring({ frame: frame - 6 - i * 6, fps, config: { damping: 20, stiffness: 80, mass: 1 } });
          return (
            <span
              key={word}
              style={{
                display: "inline-block",
                opacity: interpolate(s, [0, 0.5], [0, 1], { extrapolateRight: "clamp" }),
                translate: `0px ${interpolate(s, [0, 1], [fontSize * 0.45, 0])}px`,
                filter: `blur(${interpolate(s, [0, 1], [12, 0])}px)`,
              }}
            >
              {word}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
