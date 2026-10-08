import { Composition } from "remotion";
import { Promo } from "./Promo";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition id="Promo916" component={Promo} durationInFrames={720} fps={30} width={1080} height={1920} />
      <Composition id="Promo169" component={Promo} durationInFrames={720} fps={30} width={1920} height={1080} />
    </>
  );
};
