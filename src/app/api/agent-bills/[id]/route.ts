import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { guardAgentSession, noStore, notFound } from '@/lib/agent-access';
import { findProposal, isExpired } from '@/lib/agent-bills';
import { nameWarnings } from '@/lib/mcp/guardrails';

/** The owner's view of a bill an agent proposed. Nothing else can read it, and reading changes nothing. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await guardAgentSession(request, { requireOrigin: false });
    if ('response' in guard) return guard.response;
    const { id } = await params;

    const bill = await findProposal(guard.user.id, id);
    if (!bill || isExpired(bill)) return notFound();

    const db = createAdminClient();
    const [{ data: items, error: itemsError }, token] = await Promise.all([
      db.from('bill_items').select('name, price, quantity').eq('bill_id', bill.id).order('created_at', { ascending: true }),
      bill.agent_token_id
        ? db.from('agent_tokens').select('name').eq('id', bill.agent_token_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    if (itemsError) throw new Error('items read failed');

    const lines = (items ?? []).map((item) => ({
      name: String(item.name),
      price: Number(item.price),
      quantity: Number(item.quantity),
    }));
    const subtotal = Number(bill.subtotal);
    const tax = Number(bill.tax);
    const tip = Number(bill.tip_amount);
    return noStore(
      NextResponse.json({
        id: bill.id,
        name: bill.name,
        items: lines,
        subtotal,
        tax,
        tip_amount: tip,
        total: Math.round((subtotal + tax + tip) * 100) / 100,
        split_mode: bill.split_mode,
        created_at: bill.created_at,
        expires_at: bill.approval_expires_at,
        token_name: token.data?.name ?? null,
        warnings: nameWarnings([bill.name, ...lines.map((line) => line.name)]),
      })
    );
  } catch (error) {
    console.error('Error in agent-bills GET:', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
