import { FONT } from "../theme";
import { hexFor, inkFor } from "../data";

type Props = {
  readonly name: string;
  readonly size: number;
  readonly ring?: string;
  readonly style?: React.CSSProperties;
};

export const Avatar: React.FC<Props> = ({ name, size, ring = "#0b0b0d", style }) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: "50%",
      backgroundColor: hexFor(name),
      color: inkFor(name),
      fontFamily: FONT,
      fontWeight: 600,
      fontSize: size * 0.42,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      boxShadow: `0 0 0 ${Math.max(2, size * 0.08)}px ${ring}`,
      flexShrink: 0,
      ...style,
    }}
  >
    {name.charAt(0).toUpperCase()}
  </div>
);
