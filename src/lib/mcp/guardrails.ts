/**
 * Input policy for bills an agent proposes. Deliberately tighter than the
 * web's limits: a person typing a $40,000 bill is unusual, an agent doing it
 * is far more likely to be confused or misled.
 */
export const AGENT_BILL_LIMITS = {
  maxTotal: 2000,
  maxUnitPrice: 1000,
  maxItems: 40,
  /** A second identical bill from the same token inside this window is refused. */
  duplicateWindowMinutes: 10,
  /** New bills one account's agents may propose per day. */
  maxBillsPerDay: 20,
} as const;

export interface AgentBillInput {
  name: string;
  items: { name: string; price: number; quantity: number }[];
  tax: number;
  tip: number;
}

export type RefusalCode = 'total_cap' | 'unit_price_cap' | 'too_many_items' | 'duplicate' | 'daily_cap';

export type BillInputVerdict =
  | { ok: true; warnings: string[] }
  | { ok: false; code: RefusalCode; reason: string };

const usd = (amount: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);

export function checkBillInput(input: AgentBillInput): BillInputVerdict {
  if (input.items.length > AGENT_BILL_LIMITS.maxItems) {
    return {
      ok: false,
      code: 'too_many_items',
      reason: `An agent can add at most ${AGENT_BILL_LIMITS.maxItems} items to one bill. Create larger bills on splittr.cash.`,
    };
  }
  if (input.items.some((item) => item.price > AGENT_BILL_LIMITS.maxUnitPrice)) {
    return {
      ok: false,
      code: 'unit_price_cap',
      reason: `An agent can't add an item priced over ${usd(AGENT_BILL_LIMITS.maxUnitPrice)}. Create this bill on splittr.cash.`,
    };
  }
  const subtotal = input.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const total = Math.round((subtotal + input.tax + input.tip) * 100) / 100;
  if (total > AGENT_BILL_LIMITS.maxTotal) {
    return {
      ok: false,
      code: 'total_cap',
      reason: `An agent can't create a bill over ${usd(AGENT_BILL_LIMITS.maxTotal)}. Create this bill on splittr.cash.`,
    };
  }
  return { ok: true, warnings: nameWarnings([input.name, ...input.items.map((item) => item.name)]) };
}

const SHAPES: { pattern: RegExp; looksLike: string }[] = [
  { pattern: /[^\s@]+@[^\s@]+\.[a-z]{2,}/i, looksLike: 'an email address' },
  { pattern: /\bhttps?:\/\/|\bwww\.[a-z0-9-]+\.[a-z]{2,}|\b[a-z0-9-]+\.(com|net|org|io|dev|app|ai|co)\b/i, looksLike: 'a web address' },
  { pattern: /(?<!\d)(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?!\d)/, looksLike: 'a phone number' },
  {
    pattern: /\b(spl_pat_|sk-|sk_live_|ghp_|gho_|github_pat_|xox[bap]-|AKIA|eyJ)[A-Za-z0-9_-]{12,}/,
    looksLike: 'an access key or token',
  },
  // A long unbroken run mixing letters and digits: keys and encoded data look
  // like this; SKUs (digits only) and long words (letters only) do not
  { pattern: /(?=[A-Za-z0-9+/_=-]*[A-Za-z])(?=[A-Za-z0-9+/_=-]*\d)[A-Za-z0-9+/_=-]{24,}/, looksLike: 'an access key or token' },
];

/**
 * Names shaped like something other than a receipt line. These never block:
 * the shapes are easy to dodge and real receipts trip them, so they are
 * shown to the person on the approval page, who is the actual check.
 */
export function nameWarnings(names: string[]): string[] {
  const warnings: string[] = [];
  for (const name of names) {
    const hit = SHAPES.find((shape) => shape.pattern.test(name));
    if (hit) warnings.push(`"${name}" looks like ${hit.looksLike}.`);
  }
  return warnings;
}
