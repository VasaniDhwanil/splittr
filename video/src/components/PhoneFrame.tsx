import { OffthreadVideo, staticFile } from "remotion";
import { C } from "../theme";

type Props = {
  /** Screen height in px; width follows the iPhone 13 viewport (390x844). */
  readonly screenHeight: number;
  readonly src: string;
  readonly trimBefore: number;
  readonly playbackRate: number;
  readonly children?: React.ReactNode;
};

export const SCREEN_ASPECT = 390 / 844;
const BEZEL = 14;

/** A dark rounded phone (54px outer radius) with a hairline edge and top highlight. */
export const PhoneFrame: React.FC<Props> = ({ screenHeight, src, trimBefore, playbackRate, children }) => {
  const screenWidth = screenHeight * SCREEN_ASPECT;
  return (
    <div
      style={{
        width: screenWidth + BEZEL * 2,
        height: screenHeight + BEZEL * 2,
        padding: BEZEL,
        borderRadius: 54,
        background: "linear-gradient(160deg, #1a1a1e 0%, #0d0d10 45%, #08080a 100%)",
        boxShadow: [
          "inset 0 0 0 1px rgba(255,255,255,0.10)",
          "inset 0 1px 0 rgba(255,255,255,0.18)",
          "0 0 0 1px rgba(0,0,0,0.6)",
          `0 60px 120px -40px ${C.green}33`,
          "0 30px 60px -20px rgba(0,0,0,0.8)",
        ].join(", "),
      }}
    >
      <div
        style={{
          position: "relative",
          width: screenWidth,
          height: screenHeight,
          borderRadius: 54 - BEZEL,
          overflow: "hidden",
          backgroundColor: C.bg,
        }}
      >
        <OffthreadVideo
          src={staticFile(src)}
          trimBefore={trimBefore}
          playbackRate={playbackRate}
          muted
          // The encoded footage carries a non-square sample aspect ratio from the screencast;
          // its pixels are already 390:844, so stretch to the box instead of honoring SAR.
          style={{ width: "100%", height: "100%", objectFit: "fill" }}
        />
        {children}
      </div>
    </div>
  );
};
