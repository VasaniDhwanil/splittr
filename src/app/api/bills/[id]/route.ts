import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireBillOwnership } from '@/lib/auth-helpers';
import { cleanText, clampNumber, sanitizeItems, LIMITS } from '@/lib/validate';

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

    // Smart pay: when the host hasn't set handles on this bill, fall back to
    // the payment handles configured on their profile
    let handleFallback: Record<string, string | null> = {};
    if (bill.creator_user_id && (!bill.venmo_handle || !bill.cashapp_handle || !bill.paypal_handle)) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('venmo_handle, cashapp_handle, paypal_handle')
        .eq('user_id', bill.creator_user_id)
        .maybeSingle();
      if (profile) {
        handleFallback = {
          venmo_handle: bill.venmo_handle || profile.venmo_handle,
          cashapp_handle: bill.cashapp_handle || profile.cashapp_handle,
          paypal_handle: bill.paypal_handle || profile.paypal_handle,
        };
      }
    }

    return NextResponse.json({
      ...bill,
      ...handleFallback,
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

    // Ownership check — token or session required for mutations
    const ownership = await requireBillOwnership(request, id, supabase);
    if (ownership.notFound) {
      return NextResponse.json({ error: 'Bill not found' }, { status: 404 });
    }
    if (!ownership.authorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const body = await request.json();

    const {
      name,
      tip_percent,
      status,
      tax,
      split_mode,
      tip_split,
      venmo_handle,
      cashapp_handle,
      paypal_handle,
      group_id,
      items,
    } = body;

    // Get current bill
    const { data: bill } = await supabase
      .from('bills')
      .select('subtotal, tax, tip_percent')
      .eq('id', id)
      .single();

    if (!bill) {
      return NextResponse.json(
        { error: 'Bill not found' },
        { status: 404 }
      );
    }

    const updateData: Record<string, unknown> = {};

    if (name !== undefined) {
      const clean = cleanText(name, LIMITS.billName);
      if (!clean) {
        return NextResponse.json({ error: 'Invalid name' }, { status: 400 });
      }
      updateData.name = clean;
    }

    if (status !== undefined) {
      if (!['draft', 'active', 'settled'].includes(status)) {
        return NextResponse.json(
          { error: 'Invalid status value' },
          { status: 400 }
        );
      }
      updateData.status = status;
    }

    if (split_mode !== undefined) {
      if (!['items', 'even', 'custom'].includes(split_mode)) {
        return NextResponse.json({ error: 'Invalid split_mode' }, { status: 400 });
      }
      updateData.split_mode = split_mode;
    }

    if (tip_split !== undefined) {
      if (!['proportional', 'even'].includes(tip_split)) {
        return NextResponse.json({ error: 'Invalid tip_split' }, { status: 400 });
      }
      updateData.tip_split = tip_split;
    }

    if (venmo_handle !== undefined) updateData.venmo_handle = cleanText(venmo_handle, LIMITS.handle) || null;
    if (cashapp_handle !== undefined) updateData.cashapp_handle = cleanText(cashapp_handle, LIMITS.handle) || null;
    if (paypal_handle !== undefined) updateData.paypal_handle = cleanText(paypal_handle, LIMITS.handle) || null;
    if (group_id !== undefined) updateData.group_id = group_id || null;

    // Sync items if provided: update kept rows (claims survive), insert new, delete removed
    let subtotal = bill.subtotal;
    if (items !== undefined) {
      const cleanItems = sanitizeItems(items);
      if (!cleanItems) {
        return NextResponse.json(
          { error: `A bill needs between 1 and ${LIMITS.maxItems} items` },
          { status: 400 }
        );
      }

      const { data: existingItems } = await supabase
        .from('bill_items')
        .select('id')
        .eq('bill_id', id);
      const existingIds = new Set((existingItems || []).map((i) => i.id));

      const keptIds = new Set<string>();
      for (const item of cleanItems) {
        const { id: itemId, ...clean } = item;
        if (itemId && existingIds.has(itemId)) {
          keptIds.add(itemId);
          await supabase.from('bill_items').update(clean).eq('id', itemId);
        } else {
          await supabase.from('bill_items').insert({ bill_id: id, ...clean });
        }
      }

      const toDelete = [...existingIds].filter((existingId) => !keptIds.has(existingId));
      if (toDelete.length > 0) {
        await supabase.from('bill_items').delete().in('id', toDelete);
      }

      subtotal = cleanItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
      updateData.subtotal = subtotal;
    }

    const newTax = tax !== undefined ? Math.round(clampNumber(tax, 0, LIMITS.maxTax) * 100) / 100 : bill.tax;
    if (tax !== undefined) updateData.tax = newTax;

    // Recompute tip whenever any of its inputs changed
    const newTipPercent = tip_percent !== undefined ? clampNumber(tip_percent, 0, LIMITS.maxTipPercent) : bill.tip_percent;
    if (tip_percent !== undefined) updateData.tip_percent = newTipPercent;
    if (tip_percent !== undefined || tax !== undefined || items !== undefined) {
      updateData.tip_amount = (subtotal + newTax) * (newTipPercent / 100);
    }

    const { data: updatedBill, error } = await supabase
      .from('bills')
      .update(updateData)
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

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const ownership = await requireBillOwnership(request, id, supabase);
    if (ownership.notFound) {
      return NextResponse.json({ error: 'Bill not found' }, { status: 404 });
    }
    if (!ownership.authorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Items, participants, and claims cascade-delete with the bill
    const { error } = await supabase.from('bills').delete().eq('id', id);

    if (error) {
      console.error('Error deleting bill:', error);
      return NextResponse.json(
        { error: 'Failed to delete bill' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in bills DELETE:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
