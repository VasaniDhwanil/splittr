import { NextRequest } from 'next/server';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { isPublished } from '@/lib/bill-visibility';

/** Constant-time string comparison so token checks don't leak via timing. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export interface BillOwnershipResult {
  authorized: boolean;
  notFound?: boolean;
  user?: { id: string };
}

/**
 * Whoever holds the bill's creator token, or is its signed-in creator.
 * `supabase` is the cookie client, used only to read the session; the token
 * lookup goes through the service role because clients cannot read
 * creator_token (migration 010).
 */
export async function requireBillOwnership(
  request: NextRequest,
  billId: string,
  supabase: SupabaseClient
): Promise<BillOwnershipResult> {
  const { data: bill, error } = await createAdminClient()
    .from('bills')
    .select('*') // not a column list: the approval columns may not exist yet
    .eq('id', billId)
    .single();

  // A bill waiting for approval is not there, even for its creator
  if (error || !bill || !isPublished(bill)) {
    return { authorized: false, notFound: true };
  }

  // Token-based ownership check (works without an account)
  const tokenFromHeader = request.headers.get('X-Creator-Token');
  if (tokenFromHeader && bill.creator_token && safeEqual(tokenFromHeader, bill.creator_token)) {
    return { authorized: true };
  }

  // Session-based ownership check
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user && bill.creator_user_id && user.id === bill.creator_user_id) {
    return { authorized: true, user };
  }

  return { authorized: false };
}

const PUBLIC_BILL_COLUMNS = [
  'id',
  'name',
  'date',
  'subtotal',
  'tax',
  'tip_percent',
  'tip_amount',
  'status',
  'short_code',
  'creator_id',
  'split_mode',
  'tip_split',
  'venmo_handle',
  'cashapp_handle',
  'paypal_handle',
  'zelle_handle',
  'created_at',
] as const;

const MEMBER_BILL_COLUMNS = ['creator_user_id', 'group_id', 'paid_by_user_id'] as const;

type BillRow = Record<string, unknown>;

function pick(row: BillRow, columns: readonly string[]): BillRow {
  const out: BillRow = {};
  for (const column of columns) {
    if (column in row) out[column] = row[column];
  }
  return out;
}

/**
 * What anyone holding a bill's link may see of the bill row. An allow-list,
 * so a column added later stays private until it is listed here. Account and
 * group ids are left out: see memberBill.
 */
export function publicBill(bill: BillRow): BillRow {
  return pick(bill, PUBLIC_BILL_COLUMNS);
}

/**
 * The bill row for its owner and for members of its group, who already know
 * each other's accounts: adds the creator, group and payer ids.
 */
export function memberBill(bill: BillRow): BillRow {
  return { ...publicBill(bill), ...pick(bill, MEMBER_BILL_COLUMNS) };
}

/** Does a published bill with this id exist? Proposals awaiting approval answer no. */
export async function isBillPublished(billId: string): Promise<boolean> {
  const { data } = await createAdminClient().from('bills').select('*').eq('id', billId).maybeSingle();
  return Boolean(data && isPublished(data));
}

/** Participant columns safe to send to clients (never the token hash). */
export const PARTICIPANT_COLUMNS =
  'id, bill_id, user_id, name, is_creator, created_at, custom_amount, payment_status, paid_at';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** A new participant secret: the token goes to the joiner once, the hash is stored. */
export function issueParticipantToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: sha256(token) };
}

export function participantTokenMatches(token: string | null, hash: string | null | undefined): boolean {
  if (!token || !hash) return false;
  return safeEqual(sha256(token), hash);
}

/**
 * May the caller act as this participant (e.g. mark them paid)? The
 * participant themself (their X-Participant-Token, or their signed-in
 * account) or the bill's creator (creator token or session).
 */
export async function canActAsParticipant(
  request: NextRequest,
  participant: { bill_id: string; user_id: string | null; participant_token_hash: string | null },
  supabase: SupabaseClient
): Promise<boolean> {
  if (participantTokenMatches(request.headers.get('X-Participant-Token'), participant.participant_token_hash)) {
    return true;
  }
  if (participant.user_id) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user && user.id === participant.user_id) return true;
  }
  const ownership = await requireBillOwnership(request, participant.bill_id, supabase);
  return ownership.authorized;
}

/**
 * May the caller change claims on this bill? Claiming is collaborative (the
 * split sheet assigns shares to other people at the table), so the bar is
 * being on the bill, not being the participant claimed for: a participant
 * token or signed-in account that belongs to someone on this bill, or the
 * bill's creator.
 */
export async function canEditClaims(
  request: NextRequest,
  billId: string,
  supabase: SupabaseClient
): Promise<boolean> {
  const db = createAdminClient();

  if (!(await isBillPublished(billId))) return false;

  const participantToken = request.headers.get('X-Participant-Token');
  if (participantToken) {
    const { data: holders } = await db
      .from('participants')
      .select('id')
      .eq('bill_id', billId)
      .eq('participant_token_hash', sha256(participantToken))
      .limit(1);
    if (holders && holders.length > 0) return true;
  }

  const { data: bill } = await db
    .from('bills')
    .select('creator_token, creator_user_id')
    .eq('id', billId)
    .maybeSingle();
  if (!bill) return false;

  const creatorToken = request.headers.get('X-Creator-Token');
  if (creatorToken && bill.creator_token && safeEqual(creatorToken, bill.creator_token)) {
    return true;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  if (bill.creator_user_id === user.id) return true;

  const { data: mine } = await db
    .from('participants')
    .select('id')
    .eq('bill_id', billId)
    .eq('user_id', user.id)
    .limit(1);
  return Boolean(mine && mine.length > 0);
}
