import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Caption } from "../components/Caption";
import { PhoneFrame } from "../components/PhoneFrame";
import { useLayout } from "../theme";

/** 11 to 16 s: real create-flow footage, typing items then Continue. */
export const CreateScene: React.FC<{ readonly duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { portrait } = useLayout();

  return (
    <AbsoluteFill style={{ alignItems: "center" }}>
      <div
        style={{
          position: "absolute",
          top: portrait ? 150 : 56,
          transformOrigin: "top center",
          scale: String(interpolate(frame, [0, duration], [1, 1.04], { extrapolateRight: "clamp" })),
        }}
      >
        {/* Source: create-phone.mp4, from the second item's typing through the Details step. */}
        <PhoneFrame
          screenHeight={portrait ? 1180 : 790}
          src="footage/create-phone.mp4"
          trimBefore={Math.round(4.7 * fps)}
          playbackRate={1.5}
        />
      </div>
      <Caption text="Scan the receipt, or type it." start={10} end={duration} />
    </AbsoluteFill>
  );
};
