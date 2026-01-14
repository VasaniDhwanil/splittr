import { Bill, BillItem, Participant, ItemClaim, ParticipantSplit } from '@/types';

export function generateShortCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed confusing chars (0,O,1,I)
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export function calculateSplits(
  bill: Bill,
  items: BillItem[],
  participants: Participant[],
  claims: ItemClaim[]
): ParticipantSplit[] {
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

      // Calculate this participant's portion of the item
      const totalSharesForItem = itemTotalShares[item.id] || 1;
      const effectiveShare = claim.share / totalSharesForItem;
      const amount = item.price * item.quantity * effectiveShare;

      itemsTotal += amount;
      itemDetails.push({
        item,
        share: effectiveShare,
        amount,
      });
    }

    // Calculate tax and tip proportionally based on items total
    const billSubtotal = bill.subtotal || items.reduce((sum, i) => sum + i.price * i.quantity, 0);
    const proportion = billSubtotal > 0 ? itemsTotal / billSubtotal : 0;

    const taxShare = bill.tax * proportion;
    const tipShare = bill.tip_amount * proportion;

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
  if (share === 0.5) return 'Half';
  if (share === 0.25) return 'Quarter';
  if (share === 0.33 || share === 0.34) return 'Third';
  return `${Math.round(share * 100)}%`;
}
