import { interpolate, useCurrentFrame } from "remotion";

type Props = {
  /** Position as a fraction of the 390x844 phone screen. */
  readonly x: number;
  readonly y: number;
  /** Local frame of the tap. */
  readonly at: number;
  readonly size: number;
};

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** A soft touch indicator: a white dot that presses in, then a ring that expands and fades. */
export const TapDot: React.FC<Props> = ({ x, y, at, size }) => {
  const f = useCurrentFrame() - at;
  if (f < -6 || f > 22) return null;
  const dot = interpolate(f, [-6, 0, 8, 16], [0, 0.5, 0.35, 0], clamp);
  const ring = interpolate(f, [0, 20], [0.6, 1.8], clamp);
  const ringOpacity = interpolate(f, [0, 4, 20], [0, 0.6, 0], clamp);
  const base: React.CSSProperties = {
    position: "absolute",
    left: `${x * 100}%`,
    top: `${y * 100}%`,
    width: size,
    height: size,
    marginLeft: -size / 2,
    marginTop: -size / 2,
    borderRadius: "50%",
  };
  return (
    <>
      <div style={{ ...base, backgroundColor: `rgba(255,255,255,${dot})` }} />
      <div
        style={{
          ...base,
          border: "2px solid rgba(255,255,255,0.9)",
          opacity: ringOpacity,
          scale: String(ring),
        }}
      />
    </>
  );
};
