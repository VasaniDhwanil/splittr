import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireBillOwnership, publicBill, PARTICIPANT_COLUMNS } from '@/lib/auth-helpers';
import { cleanText, clampNumber, sanitizeItems, LIMITS } from '@/lib/validate';
import { parseZelleInput, ZELLE_INPUT_ERROR } from '@/lib/payment-links';
import { signZelleQr } from '@/lib/zelle-server';
import { rateLimit, clientIp } from '@/lib/rate-limit';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // A bill's id / share code is its access key: throttle guessing. Generous
    // enough for a table of friends behind one NAT, each refetching on every
    // realtime change.
    const limit = rateLimit(`bill-get:${clientIp(request)}`, 300, 60 * 1000);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
      );
    }

    const { id } = await params;
    const db = createAdminClient(); // data ops — bypasses RLS once the service key is set

    // Check if id is a short_code or UUID
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

    let billQuery;
    if (isUUID) {
      billQuery = db.from('bills').select('*').eq('id', id).single();
    } else {
      billQuery = db.from('bills').select('*').eq('short_code', id.toUpperCase()).single();
    }

    const { data: bill, error: billError } = await billQuery;

    if (billError || !bill) {
      return NextResponse.json(
        { error: 'Bill not found' },
        { status: 404 }
      );
    }

    // Get bill items
    const { data: items } = await db
      .from('bill_items')
      .select('*')
      .eq('bill_id', bill.id)
      .order('created_at', { ascending: true });

    // Get participants
    const { data: participants } = await db
      .from('participants')
      .select(PARTICIPANT_COLUMNS)
      .eq('bill_id', bill.id)
      .order('created_at', { ascending: true });

    // Get all claims for this bill's items
    const itemIds = items?.map(i => i.id) || [];
    const { data: claims } = await db
      .from('item_claims')
      .select('*')
      .in('item_id', itemIds);

    // Smart pay: when the host hasn't set handles on this bill, fall back to
    // the payment handles configured on their profile. The host's Zelle QR
    // (profile-only) rides along whenever the host is the one collecting.
    let handleFallback: Record<string, string | null> = {};
    if (bill.creator_user_id) {
      const { data: profile } = await db
        .from('profiles')
        .select('venmo_handle, cashapp_handle, paypal_handle, zelle_handle, zelle_qr_path')
        .eq('user_id', bill.creator_user_id)
        .maybeSingle();
      if (profile) {
        handleFallback = {
          venmo_handle: bill.venmo_handle || profile.venmo_handle,
          cashapp_handle: bill.cashapp_handle || profile.cashapp_handle,
          paypal_handle: bill.paypal_handle || profile.paypal_handle,
          zelle_handle: bill.zelle_handle || profile.zelle_handle,
          zelle_qr_url: await signZelleQr(db, profile.zelle_qr_path),
        };
      }
    }

    // Group bills: expose the member list (for the payer picker) and, when
    // someone other than the creator paid, that payer's name + pay handles.
    let groupMembers: { user_id: string; display_name: string }[] | undefined;
    let paidBy: Record<string, unknown> | null = null;
    if (bill.group_id) {
      const { data: members } = await db
        .from('group_members')
        .select('user_id, display_name')
        .eq('group_id', bill.group_id)
        .order('created_at', { ascending: true });
      groupMembers = members || [];

      if (bill.paid_by_user_id) {
        const member = groupMembers.find((m) => m.user_id === bill.paid_by_user_id);
        const { data: payerProfile } = await db
          .from('profiles')
          .select('display_name, venmo_handle, cashapp_handle, paypal_handle, zelle_handle, zelle_qr_path')
          .eq('user_id', bill.paid_by_user_id)
          .maybeSingle();
        paidBy = {
          user_id: bill.paid_by_user_id,
          name: member?.display_name || payerProfile?.display_name || 'Someone',
          venmo_handle: payerProfile?.venmo_handle ?? null,
          cashapp_handle: payerProfile?.cashapp_handle ?? null,
          paypal_handle: payerProfile?.paypal_handle ?? null,
          zelle_handle: payerProfile?.zelle_handle ?? null,
          zelle_qr_url: await signZelleQr(db, payerProfile?.zelle_qr_path),
        };
      }
    }

    return NextResponse.json({
      ...publicBill(bill),
      ...handleFallback,
      ...(groupMembers ? { group_members: groupMembers } : {}),
      paid_by: paidBy,
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
    const supabase = await createClient(); // auth (cookies) only
    const db = createAdminClient(); // data ops — bypasses RLS once the service key is set

    // Ownership check — token or session required for mutations
    const ownership = await requireBillOwnership(request, id, supabase);
    if (ownership.notFound) {
      return NextResponse.json({ error: 'Bill not found' }, { status: 404 });
    }
    if (!ownership.authorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

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
      zelle_handle,
      group_id,
      items,
    } = body;

    // Get current bill
    const { data: bill } = await db
      .from('bills')
      .select('subtotal, tax, tip_percent, group_id')
      .eq('id', id)
      .single();

    if (!bill) {
      return NextResponse.json(
        { error: 'Bill not found' },
        { status: 404 }
      );
    }

    const updateData: Record<string, unknown> = {};

    // Change who paid: group bills only, payer must be a member (or null to
    // reset to "the creator paid")
    if (body.paid_by_user_id !== undefined) {
      if (body.paid_by_user_id === null) {
        updateData.paid_by_user_id = null;
      } else {
        if (!bill.group_id || typeof body.paid_by_user_id !== 'string') {
          return NextResponse.json(
            { error: 'paid_by_user_id requires a group bill' },
            { status: 400 }
          );
        }
        const { data: payerMembership } = await db
          .from('group_members')
          .select('id')
          .eq('group_id', bill.group_id)
          .eq('user_id', body.paid_by_user_id)
          .maybeSingle();
        if (!payerMembership) {
          return NextResponse.json(
            { error: 'The payer must be a member of the group' },
            { status: 400 }
          );
        }
        updateData.paid_by_user_id = body.paid_by_user_id;
      }
    }

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
    const zelle = parseZelleInput(zelle_handle);
    if (!zelle.ok) {
      return NextResponse.json({ error: ZELLE_INPUT_ERROR }, { status: 400 });
    }
    if (zelle.value !== undefined) updateData.zelle_handle = zelle.value;
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

      const { data: existingItems } = await db
        .from('bill_items')
        .select('id')
        .eq('bill_id', id);
      const existingIds = new Set((existingItems || []).map((i) => i.id));

      const keptIds = new Set<string>();
      for (const item of cleanItems) {
        const { id: itemId, ...clean } = item;
        if (itemId && existingIds.has(itemId)) {
          keptIds.add(itemId);
          await db.from('bill_items').update(clean).eq('id', itemId);
        } else {
          await db.from('bill_items').insert({ bill_id: id, ...clean });
        }
      }

      const toDelete = [...existingIds].filter((existingId) => !keptIds.has(existingId));
      if (toDelete.length > 0) {
        await db.from('bill_items').delete().in('id', toDelete);
      }

      subtotal = cleanItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
      updateData.subtotal = subtotal;
    }

    const newTax = tax !== undefined ? Math.round(clampNumber(tax, 0, LIMITS.maxTax) * 100) / 100 : bill.tax;
    if (tax !== undefined) updateData.tax = newTax;

    // Recompute tip whenever any of its inputs changed. An explicit dollar
    // tip_amount wins over the percent; the percent is re-derived from it.
    if (body.tip_amount !== undefined && body.tip_amount !== null && body.tip_amount !== '') {
      const amt = Math.round(clampNumber(body.tip_amount, 0, LIMITS.maxTax) * 100) / 100;
      updateData.tip_amount = amt;
      updateData.tip_percent =
        subtotal + newTax > 0 ? Math.round((amt / (subtotal + newTax)) * 1000) / 10 : 0;
    } else {
      const newTipPercent = tip_percent !== undefined ? clampNumber(tip_percent, 0, LIMITS.maxTipPercent) : bill.tip_percent;
      if (tip_percent !== undefined) updateData.tip_percent = newTipPercent;
      if (tip_percent !== undefined || tax !== undefined || items !== undefined) {
        updateData.tip_amount = (subtotal + newTax) * (newTipPercent / 100);
      }
    }

    const { data: updatedBill, error } = await db
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

    return NextResponse.json(publicBill(updatedBill));
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
    const supabase = await createClient(); // auth (cookies) only
    const db = createAdminClient(); // data ops — bypasses RLS once the service key is set

    const ownership = await requireBillOwnership(request, id, supabase);
    if (ownership.notFound) {
      return NextResponse.json({ error: 'Bill not found' }, { status: 404 });
    }
    if (!ownership.authorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Items, participants, and claims cascade-delete with the bill
    const { error } = await db.from('bills').delete().eq('id', id);

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
