import { AbsoluteFill } from "remotion";
import { Wordmark } from "../components/Wordmark";
import { useLayout } from "../theme";

/** 0.0 to 2.5 s: the mark draws in, the wordmark springs beside it. */
export const Intro: React.FC = () => {
  const { portrait } = useLayout();
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      <Wordmark markSize={portrait ? 150 : 180} fontSize={portrait ? 150 : 180} delay={6} />
    </AbsoluteFill>
  );
};
