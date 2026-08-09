import { Bill, BillItem, Participant, ItemClaim, ParticipantSplit } from '@/types';

export function generateShortCode(length = 6): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed confusing chars (0,O,1,I)
  let code = '';
  for (let i = 0; i < length; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export function billTotal(bill: Bill): number {
  return bill.subtotal + bill.tax + bill.tip_amount;
}

export function calculateSplits(
  bill: Bill,
  items: BillItem[],
  participants: Participant[],
  claims: ItemClaim[]
): ParticipantSplit[] {
  const mode = bill.split_mode || 'items';

  if (mode === 'even') {
    const n = participants.length || 1;
    return participants.map((participant) => ({
      participant,
      itemsTotal: bill.subtotal / n,
      taxShare: bill.tax / n,
      tipShare: bill.tip_amount / n,
      total: billTotal(bill) / n,
      items: [],
    }));
  }

  if (mode === 'custom') {
    return participants.map((participant) => {
      const amount = participant.custom_amount ?? 0;
      return {
        participant,
        itemsTotal: amount,
        taxShare: 0,
        tipShare: 0,
        total: amount,
        items: [],
      };
    });
  }

  // Default: split by item claims
  const participantSplits: ParticipantSplit[] = [];

  // Create a map of item_id -> total claimed shares
  const itemTotalShares: Record<string, number> = {};
  items.forEach(item => {
    const itemClaims = claims.filter(c => c.item_id === item.id);
    itemTotalShares[item.id] = itemClaims.reduce((sum, c) => sum + c.share, 0);
  });

  // Calculate each participant's share
  for (const participant of participants) {
    const participantClaims = claims.filter(c => c.participant_id === participant.id);

    let itemsTotal = 0;
    const itemDetails: ParticipantSplit['items'] = [];

    for (const claim of participantClaims) {
      const item = items.find(i => i.id === claim.item_id);
      if (!item) continue;

      // Shares are absolute portions (½ of a pasta, 2 of 3 beers) until the
      // item is over-claimed — only then do we normalize the weights. A lone
      // ½ claim pays half the item, not all of it.
      const totalSharesForItem = itemTotalShares[item.id] || 0;
      const denominator = Math.max(totalSharesForItem, item.quantity);
      const effectiveShare = denominator > 0 ? claim.share / denominator : 0;
      const amount = item.price * item.quantity * effectiveShare;

      itemsTotal += amount;
      itemDetails.push({
        item,
        share: effectiveShare,
        amount,
      });
    }

    // Tax always follows what you ordered; tip follows the bill's tip_split setting
    const billSubtotal = bill.subtotal || items.reduce((sum, i) => sum + i.price * i.quantity, 0);
    const proportion = billSubtotal > 0 ? itemsTotal / billSubtotal : 0;

    const taxShare = bill.tax * proportion;
    const tipShare =
      bill.tip_split === 'even'
        ? bill.tip_amount / (participants.length || 1)
        : bill.tip_amount * proportion;

    participantSplits.push({
      participant,
      itemsTotal,
      taxShare,
      tipShare,
      total: itemsTotal + taxShare + tipShare,
      items: itemDetails,
    });
  }

  return participantSplits;
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}

export function formatShare(share: number): string {
  if (share === 1) return 'Full';
  if (share > 1) return formatQuantity(share); // e.g. 1½ of a multi-quantity item
  if (share === 0.75) return '¾';
  if (Math.abs(share - 2 / 3) < 0.01) return '⅔';
  if (share === 0.5) return '½';
  if (Math.abs(share - 1 / 3) < 0.01) return '⅓';
  if (share === 0.25) return '¼';
  return `${Math.round(share * 100)}%`;
}

/** "0.5" -> "½", "1.5" -> "1½", "2" -> "2" — for quantity-style amounts. */
export function formatQuantity(value: number): string {
  const whole = Math.floor(value + 1e-9);
  const frac = value - whole;
  let glyph = '';
  if (Math.abs(frac - 0.5) < 0.05) glyph = '½';
  else if (Math.abs(frac - 1 / 3) < 0.05) glyph = '⅓';
  else if (Math.abs(frac - 2 / 3) < 0.05) glyph = '⅔';
  else if (Math.abs(frac - 0.25) < 0.05) glyph = '¼';
  else if (Math.abs(frac - 0.75) < 0.05) glyph = '¾';
  else if (Math.abs(frac - 1 / 6) < 0.04) glyph = '⅙';
  else if (Math.abs(frac - 5 / 6) < 0.04) glyph = '⅚';
  else if (frac > 0.01) return String(Math.round(value * 100) / 100);
  if (whole === 0) return glyph || '0';
  return `${whole}${glyph}`;
}
