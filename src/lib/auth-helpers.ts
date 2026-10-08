import { NextRequest } from 'next/server';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';

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
    .select('creator_token, creator_user_id')
    .eq('id', billId)
    .single();

  if (error || !bill) {
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

/** Strip server-only columns before a bill row goes into a response. */
export function publicBill<T extends { creator_token?: unknown }>(bill: T): Omit<T, 'creator_token'> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { creator_token, ...rest } = bill;
  return rest;
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
