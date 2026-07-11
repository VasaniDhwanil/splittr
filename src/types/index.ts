export type SplitMode = 'items' | 'even' | 'custom';
export type TipSplit = 'proportional' | 'even';

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
  creator_user_id?: string | null;
  split_mode: SplitMode;
  tip_split?: TipSplit;
  venmo_handle?: string | null;
  cashapp_handle?: string | null;
  paypal_handle?: string | null;
  group_id?: string | null;
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
  custom_amount?: number | null;
  payment_status?: 'unpaid' | 'paid';
  paid_at?: string | null;
  created_at: string;
}

export interface ItemClaim {
  id: string;
  participant_id: string;
  item_id: string;
  share: number; // fraction (0.5 = half) for single-qty items, integer count for multi-qty
  created_at: string;
}

export interface Group {
  id: string;
  name: string;
  emoji: string;
  creator_user_id: string;
  invite_code?: string | null;
  created_at: string;
}

export interface Profile {
  user_id: string;
  display_name: string | null;
  venmo_handle: string | null;
  cashapp_handle: string | null;
  paypal_handle: string | null;
}

export interface GroupMember {
  id: string;
  group_id: string;
  user_id: string;
  display_name: string;
  role: 'owner' | 'member';
  created_at: string;
  profile?: Profile | null;
}

export interface GroupWithBills extends Group {
  bills: BillWithParticipants[];
}

export interface BillWithParticipants extends Bill {
  participants: Participant[];
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
  is_receipt: boolean;
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
