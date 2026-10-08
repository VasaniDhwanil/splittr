import { Easing, interpolate, useCurrentFrame } from "remotion";
import { C } from "../theme";

type Props = {
  readonly size: number;
  /** Frame (local) at which the draw-in starts. */
  readonly delay?: number;
};

const ease = Easing.bezier(0.16, 1, 0.3, 1);
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/**
 * The split-disc mark from src/app/icon.svg. A circle outline draws itself, the two
 * halves fill in, then slide apart along the diagonal into the split.
 */
export const Mark: React.FC<Props> = ({ size, delay = 0 }) => {
  const f = useCurrentFrame() - delay;
  const draw = interpolate(f, [0, 22], [0, 1], { ...clamp, easing: ease });
  const fill = interpolate(f, [14, 28], [0, 1], { ...clamp, easing: ease });
  const split = interpolate(f, [22, 46], [0, 1], { ...clamp, easing: ease });
  const outline = interpolate(f, [24, 36], [1, 0], clamp);
  const circumference = 2 * Math.PI * 16;

  return (
    <svg width={(size * 36) / 44} height={size} viewBox="14 10 36 44" style={{ overflow: "visible" }}>
      <circle
        cx={32}
        cy={32}
        r={16}
        fill="none"
        stroke={C.green}
        strokeWidth={1.4}
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - draw)}
        transform="rotate(-45 32 32)"
        opacity={outline}
      />
      <path
        fill={C.green}
        opacity={fill}
        d="M43.31 20.69A16 16 0 0 0 20.69 43.31Z"
        transform={`translate(${-1.2 * split} ${-4.2 * split})`}
      />
      <path
        fill={C.green}
        opacity={fill}
        d="M43.31 20.69A16 16 0 0 1 20.69 43.31Z"
        transform={`translate(${1.2 * split} ${4.2 * split})`}
      />
    </svg>
  );
};
