import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { FONT, WORDMARK_GRADIENT } from "../theme";
import { Mark } from "./Mark";

type Props = {
  readonly markSize: number;
  readonly fontSize: number;
  /** Local frame the mark starts drawing. The word follows 26 frames later. */
  readonly delay?: number;
};

/** Mark plus the gradient "Splittr" word, springing in beside it. */
export const Wordmark: React.FC<Props> = ({ markSize, fontSize, delay = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const word = spring({ frame: frame - delay - 26, fps, config: { damping: 22, stiffness: 90, mass: 1 } });

  return (
    <div style={{ display: "flex", alignItems: "center", gap: fontSize * 0.24 }}>
      <Mark size={markSize} delay={delay} />
      <div
        style={{
          fontFamily: FONT,
          fontSize,
          fontWeight: 700,
          letterSpacing: "-0.04em",
          lineHeight: 1.15,
          paddingBottom: fontSize * 0.06,
          backgroundImage: WORDMARK_GRADIENT,
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          color: "transparent",
          opacity: interpolate(word, [0, 0.6], [0, 1], { extrapolateRight: "clamp" }),
          translate: `${interpolate(word, [0, 1], [-fontSize * 0.25, 0])}px 0px`,
          filter: `blur(${interpolate(word, [0, 1], [10, 0])}px)`,
        }}
      >
        Splittr
      </div>
    </div>
  );
};
