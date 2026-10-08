import { AbsoluteFill, useCurrentFrame } from "remotion";
import { C, useLayout } from "../theme";

type Props = {
  /** 0 to 1 overall strength; the timeline dims it behind busy scenes. */
  readonly intensity: number;
};

/** Two slow, blurred radial fields (green and mint) drifting on independent sine paths. */
export const Aurora: React.FC<Props> = ({ intensity }) => {
  const frame = useCurrentFrame();
  const { width, height } = useLayout();
  const size = Math.max(width, height) * 0.95;
  const t = frame / 30;

  const ax = width * (0.3 + 0.12 * Math.sin(t * 0.35));
  const ay = height * (0.38 + 0.08 * Math.cos(t * 0.28));
  const bx = width * (0.7 + 0.1 * Math.cos(t * 0.31 + 1.2));
  const by = height * (0.6 + 0.09 * Math.sin(t * 0.24 + 0.6));

  return (
    <AbsoluteFill style={{ opacity: intensity, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          width: size,
          height: size,
          left: ax - size / 2,
          top: ay - size / 2,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${C.green}38 0%, ${C.green}12 38%, transparent 68%)`,
          filter: "blur(60px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          width: size * 0.85,
          height: size * 0.85,
          left: bx - (size * 0.85) / 2,
          top: by - (size * 0.85) / 2,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${C.mint}2e 0%, ${C.mint}0f 40%, transparent 70%)`,
          filter: "blur(70px)",
        }}
      />
    </AbsoluteFill>
  );
};
