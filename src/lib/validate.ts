/** Shared input bounds for user-supplied bill data. */

export const LIMITS = {
  billName: 100,
  itemName: 80,
  personName: 40,
  handle: 50,
  maxItems: 100,
  maxPrice: 100_000,
  maxQuantity: 99,
  maxTax: 100_000,
  maxTipPercent: 100,
  maxParticipants: 50,
  maxShare: 99,
};

export function cleanText(raw: unknown, maxLength: number): string {
  return String(raw ?? '')
     
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function clampNumber(raw: unknown, min: number, max: number): number {
  const v = Number(raw);
  if (!Number.isFinite(v)) return min;
  return Math.min(Math.max(v, min), max);
}

export interface CleanItem {
  id?: string;
  name: string;
  price: number;
  quantity: number;
}

/** Validate and bound a client-supplied items array. Returns null if unusable. */
export function sanitizeItems(raw: unknown): CleanItem[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > LIMITS.maxItems) return null;
  return raw.map((item) => ({
    ...(typeof item?.id === 'string' ? { id: item.id } : {}),
    name: cleanText(item?.name, LIMITS.itemName) || 'Item',
    price: Math.round(clampNumber(item?.price, 0, LIMITS.maxPrice) * 100) / 100,
    quantity: Math.round(clampNumber(item?.quantity, 1, LIMITS.maxQuantity)),
  }));
}
