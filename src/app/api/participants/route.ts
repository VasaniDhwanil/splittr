import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireBillOwnership } from '@/lib/auth-helpers';

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();

    const { participant_id, payment_status, custom_amount } = body;

    if (!participant_id) {
      return NextResponse.json(
        { error: 'participant_id is required' },
        { status: 400 }
      );
    }

    const { data: participant } = await supabase
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

    const { data: updated, error } = await supabase
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
    const supabase = await createClient();
    const body = await request.json();

    const { bill_id, name } = body;

    if (!bill_id || !name) {
      return NextResponse.json(
        { error: 'bill_id and name are required' },
        { status: 400 }
      );
    }

    // Check if bill exists
    const { data: bill } = await supabase
      .from('bills')
      .select('id')
      .eq('id', bill_id)
      .single();

    if (!bill) {
      return NextResponse.json(
        { error: 'Bill not found' },
        { status: 404 }
      );
    }

    // Check if name already exists, append number if needed
    const { data: existingWithName } = await supabase
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

    // Create new participant
    const { data: participant, error } = await supabase
      .from('participants')
      .insert({
        bill_id,
        name: finalName,
        is_creator: false,
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
