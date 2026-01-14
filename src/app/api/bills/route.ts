import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { generateShortCode } from '@/lib/calculations';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();

    const { name, items, tax, tip_percent, creator_name } = body;

    // Calculate subtotal from items
    const subtotal = items.reduce(
      (sum: number, item: { price: number; quantity: number }) =>
        sum + item.price * item.quantity,
      0
    );

    // Calculate tip amount
    const tip_amount = (subtotal + tax) * (tip_percent / 100);

    // Generate unique short code
    let short_code = generateShortCode();
    let attempts = 0;
    while (attempts < 10) {
      const { data: existing } = await supabase
        .from('bills')
        .select('id')
        .eq('short_code', short_code)
        .single();

      if (!existing) break;
      short_code = generateShortCode();
      attempts++;
    }

    // Create the bill
    const { data: bill, error: billError } = await supabase
      .from('bills')
      .insert({
        name,
        subtotal,
        tax,
        tip_percent,
        tip_amount,
        short_code,
        status: 'active',
      })
      .select()
      .single();

    if (billError) {
      console.error('Error creating bill:', billError);
      return NextResponse.json(
        { error: 'Failed to create bill' },
        { status: 500 }
      );
    }

    // Create bill items
    const itemsToInsert = items.map(
      (item: { name: string; price: number; quantity: number }) => ({
        bill_id: bill.id,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
      })
    );

    const { error: itemsError } = await supabase
      .from('bill_items')
      .insert(itemsToInsert);

    if (itemsError) {
      console.error('Error creating bill items:', itemsError);
      // Clean up the bill
      await supabase.from('bills').delete().eq('id', bill.id);
      return NextResponse.json(
        { error: 'Failed to create bill items' },
        { status: 500 }
      );
    }

    // Create the creator as a participant
    const { data: creator, error: participantError } = await supabase
      .from('participants')
      .insert({
        bill_id: bill.id,
        name: creator_name,
        is_creator: true,
      })
      .select()
      .single();

    if (participantError) {
      console.error('Error creating participant:', participantError);
    }

    return NextResponse.json({
      id: bill.id,
      short_code: bill.short_code,
      creator_participant_id: creator?.id,
    });
  } catch (error) {
    console.error('Error in bills POST:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
