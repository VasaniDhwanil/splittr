import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Avatar } from "../components/Avatar";
import { Caption } from "../components/Caption";
import { PhoneFrame } from "../components/PhoneFrame";
import { TapDot } from "../components/TapDot";
import { C, FONT, useLayout } from "../theme";

/**
 * Footage timing (seconds from each recording's start, see public/footage/marks.json).
 * The guest recording began 0.05 s after the host's, so the guest trims 0.05 s less.
 */
const HOST_FROM = 8.7;
const GUEST_FROM = HOST_FROM - 0.05;
const RATE = 1.8;
/** Guest taps (guest seconds): Yuzu CTA, Churros row, Churros CTA. */
const toLocal = (guestSeconds: number, fps: number) => Math.round(((guestSeconds - GUEST_FROM) * fps) / RATE);

const Label: React.FC<{ name: string; text: string }> = ({ name, text }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 12, fontFamily: FONT, fontSize: 32, color: C.muted }}>
    <Avatar name={name} size={34} ring="transparent" />
    {text}
  </div>
);

/** 16 to 21 s: the guest taps on one phone, the host's phone updates live. */
export const RealtimeScene: React.FC<{ readonly duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { portrait } = useLayout();
  const push = String(interpolate(frame, [0, duration], [1, 1.04], { extrapolateRight: "clamp" }));
  const screenHeight = portrait ? 800 : 760;
  const tapSize = screenHeight * 0.075;

  const guest = (
    <PhoneFrame screenHeight={screenHeight} src="footage/guest-phone.mp4" trimBefore={Math.round(GUEST_FROM * fps)} playbackRate={RATE}>
      <TapDot x={0.5} y={0.71} at={toLocal(9.57, fps)} size={tapSize} />
      <TapDot x={0.3} y={0.55} at={toLocal(12.2, fps)} size={tapSize} />
      <TapDot x={0.5} y={0.785} at={toLocal(13.55, fps)} size={tapSize} />
    </PhoneFrame>
  );
  const host = (
    <PhoneFrame screenHeight={screenHeight} src="footage/host-phone.mp4" trimBefore={Math.round(HOST_FROM * fps)} playbackRate={RATE} />
  );

  if (portrait) {
    return (
      <AbsoluteFill>
        <AbsoluteFill style={{ scale: push, transformOrigin: "50% 45%" }}>
          <div style={{ position: "absolute", left: 96, top: 90 }}>
            <Label name="Ines" text="Ines taps" />
            <div style={{ height: 20 }} />
            {guest}
          </div>
          <div style={{ position: "absolute", right: 96, top: 600 }}>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <Label name="Rhythm" text="Rhythm sees it" />
            </div>
            <div style={{ height: 20 }} />
            {host}
          </div>
        </AbsoluteFill>
        <Caption text="Live on every phone at the table." start={10} end={duration} />
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ scale: push, transformOrigin: "50% 40%", flexDirection: "row", justifyContent: "center", gap: 120, paddingTop: 40 }}>
        <div style={{ position: "relative" }}>
          <div style={{ position: "absolute", right: "calc(100% + 48px)", top: 380, whiteSpace: "nowrap" }}>
            <Label name="Ines" text="Ines taps" />
          </div>
          {guest}
        </div>
        <div style={{ position: "relative" }}>
          {host}
          <div style={{ position: "absolute", left: "calc(100% + 48px)", top: 380, whiteSpace: "nowrap" }}>
            <Label name="Rhythm" text="Rhythm sees it" />
          </div>
        </div>
      </AbsoluteFill>
      <Caption text="Live on every phone at the table." start={10} end={duration} />
    </AbsoluteFill>
  );
};
