import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    // Check if id is a short_code or UUID
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

    let billQuery;
    if (isUUID) {
      billQuery = supabase.from('bills').select('*').eq('id', id).single();
    } else {
      billQuery = supabase.from('bills').select('*').eq('short_code', id.toUpperCase()).single();
    }

    const { data: bill, error: billError } = await billQuery;

    if (billError || !bill) {
      return NextResponse.json(
        { error: 'Bill not found' },
        { status: 404 }
      );
    }

    // Get bill items
    const { data: items } = await supabase
      .from('bill_items')
      .select('*')
      .eq('bill_id', bill.id)
      .order('created_at', { ascending: true });

    // Get participants
    const { data: participants } = await supabase
      .from('participants')
      .select('*')
      .eq('bill_id', bill.id)
      .order('created_at', { ascending: true });

    // Get all claims for this bill's items
    const itemIds = items?.map(i => i.id) || [];
    const { data: claims } = await supabase
      .from('item_claims')
      .select('*')
      .in('item_id', itemIds);

    return NextResponse.json({
      ...bill,
      items: items || [],
      participants: participants || [],
      claims: claims || [],
    });
  } catch (error) {
    console.error('Error fetching bill:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const body = await request.json();

    const { tip_percent } = body;

    // Get current bill to recalculate tip
    const { data: bill } = await supabase
      .from('bills')
      .select('subtotal, tax')
      .eq('id', id)
      .single();

    if (!bill) {
      return NextResponse.json(
        { error: 'Bill not found' },
        { status: 404 }
      );
    }

    const tip_amount = (bill.subtotal + bill.tax) * (tip_percent / 100);

    const { data: updatedBill, error } = await supabase
      .from('bills')
      .update({ tip_percent, tip_amount })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { error: 'Failed to update bill' },
        { status: 500 }
      );
    }

    return NextResponse.json(updatedBill);
  } catch (error) {
    console.error('Error updating bill:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
