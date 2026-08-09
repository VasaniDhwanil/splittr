import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { clampNumber, LIMITS } from '@/lib/validate';

interface BatchEntry {
  participant_id: string;
  share: number;
}

// One "split it together" action = one request: every claim in the batch is
// validated against the item's quantity as a set, then upserted together —
// no per-claim ordering races between the N claims of a single split.
export async function POST(request: NextRequest) {
  try {
    const db = createAdminClient(); // data ops — bypasses RLS once the service key is set
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { item_id } = body;
    const rawEntries: unknown = body.entries;

    if (!item_id || !Array.isArray(rawEntries) || rawEntries.length === 0) {
      return NextResponse.json(
        { error: 'item_id and a non-empty entries array are required' },
        { status: 400 }
      );
    }
    if (rawEntries.length > LIMITS.maxParticipants) {
      return NextResponse.json({ error: 'Too many entries' }, { status: 400 });
    }

    const entries: BatchEntry[] = rawEntries.map((e) => ({
      participant_id: String((e as BatchEntry)?.participant_id ?? ''),
      share: clampNumber((e as BatchEntry)?.share ?? 1, 0.01, LIMITS.maxShare),
    }));
    if (entries.some((e) => !e.participant_id)) {
      return NextResponse.json(
        { error: 'Every entry needs a participant_id' },
        { status: 400 }
      );
    }
    const ids = entries.map((e) => e.participant_id);
    if (new Set(ids).size !== ids.length) {
      return NextResponse.json(
        { error: 'Duplicate participant in entries' },
        { status: 400 }
      );
    }

    // Item and every participant must belong to the same bill
    const [{ data: item }, { data: billParticipants }] = await Promise.all([
      db.from('bill_items').select('bill_id, quantity').eq('id', item_id).maybeSingle(),
      db.from('participants').select('id, bill_id').in('id', ids),
    ]);

    if (
      !item ||
      (billParticipants || []).length !== ids.length ||
      (billParticipants || []).some((p) => p.bill_id !== item.bill_id)
    ) {
      return NextResponse.json(
        { error: 'Participants and item do not belong to the same bill' },
        { status: 400 }
      );
    }

    const quantity = Number(item.quantity);
    if (quantity === 1) {
      // Single item: shares are weights that normalize against each other;
      // just cap each person's weight at the whole item (same as /api/claims).
      for (const e of entries) e.share = Math.min(e.share, 1);
    } else {
      // Multi-quantity: shares are physical units. Claims in this batch
      // replace those participants' existing claims, so the budget check is
      // batch total + everyone else's claims vs. the quantity on the bill.
      const { data: itemClaims } = await db
        .from('item_claims')
        .select('participant_id, share')
        .eq('item_id', item_id);
      const inBatch = new Set(ids);
      const othersTotal = (itemClaims || [])
        .filter((c) => !inBatch.has(c.participant_id))
        .reduce((sum, c) => sum + Number(c.share), 0);
      const batchTotal = entries.reduce((sum, e) => sum + e.share, 0);
      // Same rounding tolerance as single claims: a 3-way split of 2 units
      // arrives as 3 × 0.6667 = 2.0001 — legitimate, not an over-claim.
      const EPSILON = 0.05;
      if (othersTotal + batchTotal > quantity + EPSILON) {
        const remaining = Math.round(Math.max(0, quantity - othersTotal) * 100) / 100;
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

    const { data: claims, error } = await db
      .from('item_claims')
      .upsert(
        entries.map((e) => ({
          participant_id: e.participant_id,
          item_id,
          share: e.share,
        })),
        { onConflict: 'participant_id,item_id' }
      )
      .select();

    if (error) {
      console.error('Error creating batch claims:', error);
      return NextResponse.json({ error: 'Failed to split item' }, { status: 500 });
    }

    return NextResponse.json({ claims });
  } catch (error) {
    console.error('Error in claims/batch POST:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
