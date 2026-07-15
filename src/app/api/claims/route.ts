import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { clampNumber, LIMITS } from '@/lib/validate';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient(); // auth (cookies) only
    const db = createAdminClient(); // data ops — bypasses RLS once the service key is set
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { participant_id, item_id } = body;
    let share = clampNumber(body.share ?? 1.0, 0.01, LIMITS.maxShare);

    if (!participant_id || !item_id) {
      return NextResponse.json(
        { error: 'participant_id and item_id are required' },
        { status: 400 }
      );
    }

    // The participant and item must belong to the same bill — otherwise any
    // caller could attach claims across unrelated bills
    const [{ data: participant }, { data: item }] = await Promise.all([
      db.from('participants').select('bill_id').eq('id', participant_id).maybeSingle(),
      db.from('bill_items').select('bill_id, quantity').eq('id', item_id).maybeSingle(),
    ]);

    if (!participant || !item || participant.bill_id !== item.bill_id) {
      return NextResponse.json(
        { error: 'Participant and item do not belong to the same bill' },
        { status: 400 }
      );
    }

    if (Number(item.quantity) === 1) {
      // Single item: overlapping claims are HOW people split it — tapping an
      // item someone already took joins the split, and the math normalizes
      // everyone's portions against each other. Just cap a single person's
      // claim at the whole item so one caller can't skew the ratio.
      share = Math.min(share, 1);
    } else {
      // Multi-quantity items: shares are physical units, so the total can
      // never exceed what's on the bill (this caller's own claim is replaced
      // by the upsert, so it doesn't count against the budget).
      const { data: itemClaims } = await db
        .from('item_claims')
        .select('participant_id, share')
        .eq('item_id', item_id);
      const othersTotal = (itemClaims || [])
        .filter((c) => c.participant_id !== participant_id)
        .reduce((sum, c) => sum + Number(c.share), 0);
      if (othersTotal + share > Number(item.quantity) + 1e-9) {
        const remaining = Math.max(0, Number(item.quantity) - othersTotal);
        return NextResponse.json(
          {
            error:
              remaining > 0
                ? `Only ${remaining} left to claim`
                : 'All claimed already',
          },
          { status: 400 }
        );
      }
    }

    // Upsert the claim (update if exists, insert if not)
    const { data: claim, error } = await db
      .from('item_claims')
      .upsert(
        {
          participant_id,
          item_id,
          share,
        },
        {
          onConflict: 'participant_id,item_id',
        }
      )
      .select()
      .single();

    if (error) {
      console.error('Error creating claim:', error);
      return NextResponse.json(
        { error: 'Failed to claim item' },
        { status: 500 }
      );
    }

    return NextResponse.json(claim);
  } catch (error) {
    console.error('Error in claims POST:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient(); // auth (cookies) only
    const db = createAdminClient(); // data ops — bypasses RLS once the service key is set
    const { searchParams } = new URL(request.url);
    const participant_id = searchParams.get('participant_id');
    const item_id = searchParams.get('item_id');

    if (!participant_id || !item_id) {
      return NextResponse.json(
        { error: 'participant_id and item_id are required' },
        { status: 400 }
      );
    }

    const { error } = await db
      .from('item_claims')
      .delete()
      .eq('participant_id', participant_id)
      .eq('item_id', item_id);

    if (error) {
      console.error('Error deleting claim:', error);
      return NextResponse.json(
        { error: 'Failed to remove claim' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in claims DELETE:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
