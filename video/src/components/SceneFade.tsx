import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";

type Props = {
  readonly duration: number;
  readonly fadeIn?: number;
  readonly fadeOut?: number;
  readonly children: React.ReactNode;
};

/** Short fades at a scene's edges so cuts land softly on black. */
export const SceneFade: React.FC<Props> = ({ duration, fadeIn = 8, fadeOut = 8, children }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(
    frame,
    [0, Math.max(1, fadeIn), duration - Math.max(1, fadeOut), duration],
    [fadeIn === 0 ? 1 : 0, 1, 1, fadeOut === 0 ? 1 : 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};
