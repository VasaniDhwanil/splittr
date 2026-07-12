import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Settle up between the signed-in user and one counterparty inside a group.
 * Marks every unpaid share BETWEEN the pair as paid — in both directions,
 * because paying the net amount clears the whole pairwise balance
 * (that's what the net number meant).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: groupId } = await params;
    const supabase = await createClient(); // auth (cookies) only
    const db = createAdminClient(); // data ops — bypasses RLS once the service key is set

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Caller must be a member
    const { data: myMembership } = await db
      .from('group_members')
      .select('display_name')
      .eq('group_id', groupId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!myMembership) {
      return NextResponse.json({ error: 'Not a member of this group' }, { status: 403 });
    }

    const body = await request.json();
    // counterparty is either a member user id, or a raw participant name for
    // people who never signed in
    const { counterparty_user_id, counterparty_name } = body;
    if (!counterparty_user_id && !counterparty_name) {
      return NextResponse.json(
        { error: 'counterparty_user_id or counterparty_name is required' },
        { status: 400 }
      );
    }

    let counterpartyNames: string[] = [];
    if (counterparty_user_id) {
      const { data: theirMembership } = await db
        .from('group_members')
        .select('display_name')
        .eq('group_id', groupId)
        .eq('user_id', counterparty_user_id)
        .maybeSingle();
      if (theirMembership) counterpartyNames.push(theirMembership.display_name.toLowerCase());
    }
    if (counterparty_name) counterpartyNames.push(String(counterparty_name).toLowerCase());
    counterpartyNames = [...new Set(counterpartyNames)];

    const matches = (p: { user_id: string | null; name: string }, userId: string | null, names: string[]) =>
      (userId && p.user_id === userId) || names.includes(p.name.trim().toLowerCase());

    const myNames = [myMembership.display_name.toLowerCase()];

    // All active bills in this group, with their participants
    const { data: bills } = await db
      .from('bills')
      .select('id, creator_user_id, status')
      .eq('group_id', groupId)
      .neq('status', 'settled');

    const billIds = (bills || []).map((b) => b.id);
    if (billIds.length === 0) {
      return NextResponse.json({ settled: 0 });
    }

    const { data: participants } = await db
      .from('participants')
      .select('id, bill_id, user_id, name, is_creator, payment_status')
      .in('bill_id', billIds);

    const toSettle: string[] = [];
    for (const bill of bills || []) {
      const billParticipants = (participants || []).filter((p) => p.bill_id === bill.id);
      const host = billParticipants.find((p) => p.is_creator);
      if (!host) continue;

      const hostIsMe =
        bill.creator_user_id === user.id || matches(host, user.id, myNames);
      const hostIsThem =
        (counterparty_user_id && bill.creator_user_id === counterparty_user_id) ||
        matches(host, counterparty_user_id ?? null, counterpartyNames);

      for (const p of billParticipants) {
        if (p.is_creator || p.payment_status === 'paid') continue;
        // My debt to them: they hosted, I participated
        if (hostIsThem && matches(p, user.id, myNames)) toSettle.push(p.id);
        // Their debt to me: I hosted, they participated
        if (hostIsMe && matches(p, counterparty_user_id ?? null, counterpartyNames)) toSettle.push(p.id);
      }
    }

    if (toSettle.length > 0) {
      const { error } = await db
        .from('participants')
        .update({ payment_status: 'paid', paid_at: new Date().toISOString() })
        .in('id', toSettle);

      if (error) {
        console.error('Error settling:', error);
        return NextResponse.json({ error: 'Failed to settle' }, { status: 500 });
      }
    }

    return NextResponse.json({ settled: toSettle.length });
  } catch (error) {
    console.error('Error in settle POST:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
