import { AbsoluteFill, interpolate, Series, useCurrentFrame, useVideoConfig } from "remotion";
import { Aurora } from "./components/Aurora";
import { SceneFade } from "./components/SceneFade";
import { BillScene } from "./scenes/BillScene";
import { CreateScene } from "./scenes/CreateScene";
import { EndCard } from "./scenes/EndCard";
import { Headline } from "./scenes/Headline";
import { Intro } from "./scenes/Intro";
import { RealtimeScene } from "./scenes/RealtimeScene";
import { C } from "./theme";

/** Shared by Promo916 and Promo169; every scene reads its orientation from the composition size. */
export const Promo: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const end = durationInFrames;

  // Full aurora on the brand moments, dimmed behind the product scenes.
  const aurora = interpolate(
    frame,
    [0, 0.6 * fps, 2.5 * fps, 3.2 * fps, 5.5 * fps, 6 * fps, 20.6 * fps, 21.4 * fps],
    [0, 1, 1, 0.7, 0.7, 0.35, 0.35, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const toBlack = interpolate(frame, [end - 0.8 * fps, end - 2], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ backgroundColor: C.bg }}>
      <Aurora intensity={aurora} />
      <Series>
        <Series.Sequence name="Intro" durationInFrames={2.5 * fps} premountFor={fps}>
          <SceneFade duration={2.5 * fps} fadeIn={0}>
            <Intro />
          </SceneFade>
        </Series.Sequence>
        <Series.Sequence name="Headline" durationInFrames={3 * fps} premountFor={fps}>
          <SceneFade duration={3 * fps} fadeIn={0}>
            <Headline />
          </SceneFade>
        </Series.Sequence>
        <Series.Sequence name="Bill" durationInFrames={5.5 * fps} premountFor={fps}>
          <SceneFade duration={5.5 * fps}>
            <BillScene duration={5.5 * fps} />
          </SceneFade>
        </Series.Sequence>
        <Series.Sequence name="Create" durationInFrames={5 * fps} premountFor={fps}>
          <SceneFade duration={5 * fps}>
            <CreateScene duration={5 * fps} />
          </SceneFade>
        </Series.Sequence>
        <Series.Sequence name="Realtime" durationInFrames={5 * fps} premountFor={fps}>
          <SceneFade duration={5 * fps}>
            <RealtimeScene duration={5 * fps} />
          </SceneFade>
        </Series.Sequence>
        <Series.Sequence name="End" durationInFrames={3 * fps} premountFor={fps}>
          <SceneFade duration={3 * fps} fadeOut={0}>
            <EndCard />
          </SceneFade>
        </Series.Sequence>
      </Series>
      <AbsoluteFill style={{ backgroundColor: "#000", opacity: toBlack }} />
    </AbsoluteFill>
  );
};
