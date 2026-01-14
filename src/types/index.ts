export interface Bill {
  id: string;
  name: string;
  date: string;
  subtotal: number;
  tax: number;
  tip_percent: number;
  tip_amount: number;
  status: 'draft' | 'active' | 'settled';
  short_code: string;
  creator_id: string | null;
  created_at: string;
}

export interface BillItem {
  id: string;
  bill_id: string;
  name: string;
  price: number;
  quantity: number;
  created_at: string;
}

export interface Participant {
  id: string;
  bill_id: string;
  user_id: string | null;
  name: string;
  is_creator: boolean;
  created_at: string;
}

export interface ItemClaim {
  id: string;
  participant_id: string;
  item_id: string;
  share: number; // 0-1, e.g., 0.5 = half
  created_at: string;
}

// Extended types with relations
export interface BillWithItems extends Bill {
  items: BillItem[];
}

export interface BillWithDetails extends Bill {
  items: BillItemWithClaims[];
  participants: ParticipantWithClaims[];
}

export interface BillItemWithClaims extends BillItem {
  claims: ItemClaimWithParticipant[];
}

export interface ItemClaimWithParticipant extends ItemClaim {
  participant: Participant;
}

export interface ParticipantWithClaims extends Participant {
  claims: ItemClaim[];
}

// For receipt scanning
export interface ScannedReceipt {
  items: {
    name: string;
    price: number;
    quantity: number;
  }[];
  subtotal: number;
  tax: number;
  total: number;
}

// For split calculation
export interface ParticipantSplit {
  participant: Participant;
  itemsTotal: number;
  taxShare: number;
  tipShare: number;
  total: number;
  items: {
    item: BillItem;
    share: number;
    amount: number;
  }[];
}
