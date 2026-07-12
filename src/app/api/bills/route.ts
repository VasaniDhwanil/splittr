import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { generateShortCode } from '@/lib/calculations';
import { rateLimit, clientIp } from '@/lib/rate-limit';
import { cleanText, clampNumber, sanitizeItems, LIMITS } from '@/lib/validate';

export async function POST(request: NextRequest) {
  try {
    const limit = rateLimit(`bills:${clientIp(request)}`, 20, 10 * 60 * 1000);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: 'Too many bills created — try again in a few minutes' },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
      );
    }

    const supabase = await createClient(); // auth (cookies) only
    const db = createAdminClient(); // data ops — bypasses RLS once the service key is set
    const body = await request.json();

    const {
      split_mode = 'items',
      tip_split = 'proportional',
      group_id,
    } = body;

    if (!['items', 'even', 'custom'].includes(split_mode)) {
      return NextResponse.json({ error: 'Invalid split_mode' }, { status: 400 });
    }
    if (!['proportional', 'even'].includes(tip_split)) {
      return NextResponse.json({ error: 'Invalid tip_split' }, { status: 400 });
    }

    // All user-supplied fields are bounded and cleaned before touching the DB
    const name = cleanText(body.name, LIMITS.billName);
    const creator_name = cleanText(body.creator_name, LIMITS.personName);
    const items = sanitizeItems(body.items);
    const tax = Math.round(clampNumber(body.tax, 0, LIMITS.maxTax) * 100) / 100;
    const tip_percent = clampNumber(body.tip_percent, 0, LIMITS.maxTipPercent);
    const venmo_handle = cleanText(body.venmo_handle, LIMITS.handle) || null;
    const cashapp_handle = cleanText(body.cashapp_handle, LIMITS.handle) || null;
    const paypal_handle = cleanText(body.paypal_handle, LIMITS.handle) || null;

    if (!name || !creator_name) {
      return NextResponse.json({ error: 'Bill name and your name are required' }, { status: 400 });
    }
    if (!items) {
      return NextResponse.json(
        { error: `A bill needs between 1 and ${LIMITS.maxItems} items` },
        { status: 400 }
      );
    }

    // Calculate subtotal from items
    const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

    // Calculate tip amount
    const tip_amount = (subtotal + tax) * (tip_percent / 100);

    // Generate creator token (returned once, stored for ownership verification)
    const creator_token = randomBytes(32).toString('base64url');

    // Resolve signed-in user if present (optional — no error if anonymous)
    const { data: { user } } = await supabase.auth.getUser();

    // A bill can be filed under any group the signed-in user is a member of
    let validGroupId: string | null = null;
    if (group_id && user) {
      const { data: membership } = await db
        .from('group_members')
        .select('id')
        .eq('group_id', group_id)
        .eq('user_id', user.id)
        .maybeSingle();
      if (membership) validGroupId = group_id;
    }

    // Generate unique short code
    let short_code = generateShortCode();
    let attempts = 0;
    while (attempts < 10) {
      const { data: existing } = await db
        .from('bills')
        .select('id')
        .eq('short_code', short_code)
        .single();

      if (!existing) break;
      short_code = generateShortCode();
      attempts++;
    }

    // Create the bill
    const { data: bill, error: billError } = await db
      .from('bills')
      .insert({
        name,
        subtotal,
        tax,
        tip_percent,
        tip_amount,
        short_code,
        status: 'active',
        creator_token,
        split_mode,
        tip_split,
        venmo_handle,
        cashapp_handle,
        paypal_handle,
        group_id: validGroupId,
        ...(user ? { creator_user_id: user.id } : {}),
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

    const { error: itemsError } = await db
      .from('bill_items')
      .insert(itemsToInsert);

    if (itemsError) {
      console.error('Error creating bill items:', itemsError);
      // Clean up the bill
      await db.from('bills').delete().eq('id', bill.id);
      return NextResponse.json(
        { error: 'Failed to create bill items' },
        { status: 500 }
      );
    }

    // Create the creator as a participant
    const { data: creator, error: participantError } = await db
      .from('participants')
      .insert({
        bill_id: bill.id,
        name: creator_name,
        is_creator: true,
        ...(user ? { user_id: user.id } : {}),
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
      creator_token,
    });
  } catch (error) {
    console.error('Error in bills POST:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
