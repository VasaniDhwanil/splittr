import { loadFont } from "@remotion/google-fonts/Geist";
import { useVideoConfig } from "remotion";

const { fontFamily } = loadFont("normal", {
  weights: ["400", "500", "600", "700"],
  subsets: ["latin"],
});

export const FONT = fontFamily;

export const C = {
  bg: "#0b0b0d",
  green: "#4ade80",
  mint: "#6ee7b7",
  lime: "#bef264",
  white: "#ffffff",
  muted: "rgba(255,255,255,0.55)",
  faint: "rgba(255,255,255,0.40)",
  glassFill: "rgba(255,255,255,0.035)",
  glassEdge: "rgba(255,255,255,0.10)",
  glassHighlight: "inset 0 1px 0 rgba(255,255,255,0.06)",
} as const;

export const WORDMARK_GRADIENT = `linear-gradient(90deg, ${C.mint} 0%, ${C.green} 50%, ${C.lime} 100%)`;

/** Portrait (9:16) or landscape (16:9), read from the composition size. */
export const useLayout = () => {
  const { width, height } = useVideoConfig();
  return { portrait: height > width, width, height };
};
