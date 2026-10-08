// Sample bill from src/components/landing/bill-preview.tsx, re-implemented for video.
const PERSON_HEXES = [
  "#4ade80",
  "#fb923c",
  "#ec4899",
  "#a855f7",
  "#facc15",
  "#38bdf8",
  "#a3e635",
  "#f43f5e",
  "#d946ef",
  "#fbbf24",
] as const;

const nameHash = (name: string): number => {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
};

/** Same color rule as the landing preview: the host is sky blue, everyone else by name hash. */
export const hexFor = (name: string): string =>
  name === "Rhythm" ? "#38bdf8" : PERSON_HEXES[nameHash(name) % PERSON_HEXES.length];

/** Avatar ink per chip, as the Tailwind classes in avatar-initials.tsx pair them. */
const INK: Record<string, string> = {
  "#38bdf8": "#082f49",
  "#f43f5e": "#ffffff",
  "#fbbf24": "#451a03",
  "#facc15": "#422006",
  "#4ade80": "#052e16",
};
export const inkFor = (name: string): string => INK[hexFor(name)] ?? "#0b0b0d";

export const ME = "Ines";
export const PEOPLE = ["Rhythm", "Marcus", "Ines", "Tomás"] as const;

export type SampleItem = {
  readonly id: string;
  readonly name: string;
  readonly quantity: number;
  readonly price: number;
};

export const ITEMS: readonly SampleItem[] = [
  { id: "birria", name: "Birria tacos", quantity: 1, price: 18 },
  { id: "elote", name: "Elote", quantity: 1, price: 7.5 },
  { id: "yuzu", name: "Yuzu lemonade", quantity: 1, price: 6.5 },
  { id: "churros", name: "Churros", quantity: 2, price: 6 },
  { id: "horchata", name: "Horchata", quantity: 1, price: 5 },
];

export const TAX = 4.35;
export const TIP = 9.8;
export const SUBTOTAL = ITEMS.reduce((s, i) => s + i.price * i.quantity, 0);

/** Ines ends with Yuzu lemonade plus one of two churros, with tax and tip in proportion. */
export const FINAL_SHARE = (() => {
  const mine = 6.5 + 6;
  const ratio = mine / SUBTOTAL;
  return mine + TAX * ratio + TIP * ratio;
})();

export const money = (v: number): string =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v);
