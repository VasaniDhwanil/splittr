import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { FONT, useLayout } from "../theme";

type Props = {
  readonly text: string;
  /** Local frames: fade in from `start`, fade out ending at `end`. */
  readonly start: number;
  readonly end: number;
};

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** One-line caption in the bottom third, fading and rising in, fading out. */
export const Caption: React.FC<Props> = ({ text, start, end }) => {
  const frame = useCurrentFrame();
  const { portrait } = useLayout();
  const opacity = interpolate(frame, [start, start + 14, end - 12, end], [0, 1, 1, 0], clamp);
  const rise = interpolate(frame, [start, start + 20], [18, 0], {
    ...clamp,
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        alignItems: "center",
        paddingBottom: portrait ? 230 : 70,
      }}
    >
      <div
        style={{
          fontFamily: FONT,
          fontSize: portrait ? 50 : 52,
          fontWeight: 500,
          letterSpacing: "-0.02em",
          color: "#ffffff",
          whiteSpace: "nowrap",
          opacity,
          translate: `0px ${rise}px`,
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};
