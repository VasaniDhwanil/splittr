import { NextRequest } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { SupabaseClient } from '@supabase/supabase-js';

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

export async function requireBillOwnership(
  request: NextRequest,
  billId: string,
  supabase: SupabaseClient
): Promise<BillOwnershipResult> {
  const { data: bill, error } = await supabase
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
