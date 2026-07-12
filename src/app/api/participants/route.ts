import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireBillOwnership } from '@/lib/auth-helpers';
import { cleanText, LIMITS } from '@/lib/validate';

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient(); // auth (cookies) only
    const db = createAdminClient(); // data ops — bypasses RLS once the service key is set
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { participant_id, payment_status, custom_amount } = body;

    if (!participant_id) {
      return NextResponse.json(
        { error: 'participant_id is required' },
        { status: 400 }
      );
    }

    const { data: participant } = await db
      .from('participants')
      .select('id, bill_id')
      .eq('id', participant_id)
      .single();

    if (!participant) {
      return NextResponse.json({ error: 'Participant not found' }, { status: 404 });
    }

    const updateData: Record<string, unknown> = {};

    if (payment_status !== undefined) {
      if (!['unpaid', 'paid'].includes(payment_status)) {
        return NextResponse.json({ error: 'Invalid payment_status' }, { status: 400 });
      }
      updateData.payment_status = payment_status;
      updateData.paid_at = payment_status === 'paid' ? new Date().toISOString() : null;
    }

    // Only the bill creator can assign custom split amounts
    if (custom_amount !== undefined) {
      const ownership = await requireBillOwnership(request, participant.bill_id, supabase);
      if (!ownership.authorized) {
        return NextResponse.json(
          { error: 'Only the bill creator can set custom amounts' },
          { status: 403 }
        );
      }
      updateData.custom_amount = custom_amount === null ? null : Number(custom_amount) || 0;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    const { data: updated, error } = await db
      .from('participants')
      .update(updateData)
      .eq('id', participant_id)
      .select()
      .single();

    if (error) {
      console.error('Error updating participant:', error);
      return NextResponse.json(
        { error: 'Failed to update participant' },
        { status: 500 }
      );
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Error in participants PATCH:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient(); // auth (cookies) only
    const db = createAdminClient(); // data ops — bypasses RLS once the service key is set
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { bill_id } = body;
    let name = cleanText(body.name, LIMITS.personName);

    if (!bill_id) {
      return NextResponse.json(
        { error: 'bill_id is required' },
        { status: 400 }
      );
    }

    // Check if bill exists
    const { data: bill } = await db
      .from('bills')
      .select('id, group_id')
      .eq('id', bill_id)
      .single();

    if (!bill) {
      return NextResponse.json(
        { error: 'Bill not found' },
        { status: 404 }
      );
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    // A signed-in account joins a bill at most once — return the existing row
    if (user) {
      const { data: mine } = await db
        .from('participants')
        .select('*')
        .eq('bill_id', bill_id)
        .eq('user_id', user.id)
        .maybeSingle();
      if (mine) return NextResponse.json(mine);
    }

    // Nameless join: signed-in users can join under their known identity —
    // their display name in the bill's group, falling back to their profile.
    if (!name) {
      if (!user) {
        return NextResponse.json(
          { error: 'bill_id and name are required' },
          { status: 400 }
        );
      }
      let derived: string | null = null;
      if (bill.group_id) {
        const { data: membership } = await db
          .from('group_members')
          .select('display_name')
          .eq('group_id', bill.group_id)
          .eq('user_id', user.id)
          .maybeSingle();
        derived = membership?.display_name || null;
      }
      if (!derived) {
        const { data: profile } = await db
          .from('profiles')
          .select('display_name')
          .eq('user_id', user.id)
          .maybeSingle();
        derived = profile?.display_name || user.email?.split('@')[0] || null;
      }
      name = cleanText(derived, LIMITS.personName);
      if (!name) {
        return NextResponse.json(
          { error: 'bill_id and name are required' },
          { status: 400 }
        );
      }
    }

    // Bound the table size — nobody splits dinner 50 ways
    const { count } = await db
      .from('participants')
      .select('id', { count: 'exact', head: true })
      .eq('bill_id', bill_id);

    if ((count ?? 0) >= LIMITS.maxParticipants) {
      return NextResponse.json(
        { error: 'This bill is full' },
        { status: 400 }
      );
    }

    // Check if name already exists, append number if needed
    const { data: existingWithName } = await db
      .from('participants')
      .select('name')
      .eq('bill_id', bill_id)
      .ilike('name', name.trim());

    let finalName = name.trim();
    if (existingWithName && existingWithName.length > 0) {
      // Find how many participants have this base name
      const count = existingWithName.length;
      finalName = `${name.trim()} (${count + 1})`;
    }

    // Create new participant (linked to their account when signed in, so
    // group balances can track them across bills)
    const { data: participant, error } = await db
      .from('participants')
      .insert({
        bill_id,
        name: finalName,
        is_creator: false,
        ...(user ? { user_id: user.id } : {}),
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating participant:', error);
      return NextResponse.json(
        { error: 'Failed to join bill' },
        { status: 500 }
      );
    }

    return NextResponse.json(participant);
  } catch (error) {
    console.error('Error in participants POST:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
