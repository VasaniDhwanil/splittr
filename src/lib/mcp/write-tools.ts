import { z } from 'zod';
import { AGENT_BILL_LIMITS, checkBillInput } from './guardrails';
import { createAdminClient } from '@/lib/supabase/admin';
import { generateShortCode } from '@/lib/calculations';
import { hitRateLimit } from '@/lib/agent-access';
import { agentSiteOrigin } from '@/lib/site-origin';
import { clampNumber, cleanText, LIMITS, sanitizeItems } from '@/lib/validate';
import { defineTool, type ToolOutcome } from './tool-types';

/** How long a proposal waits for its owner before it is purged. */
export const APPROVAL_WINDOW_MS = 24 * 60 * 60 * 1000;

const cents = (n: number) => Math.round(n * 100) / 100;

// The schema allows what the web allows, and the input policy (guardrails.ts)
// is what draws the agent limits: a refusal comes with a plain reason and
// counts toward the circuit breaker, which a schema error would not.
const createBillInput = z
  .strictObject({
    name: z.string().min(1).max(LIMITS.billName),
    items: z
      .array(
        z.strictObject({
          name: z.string().min(1).max(LIMITS.itemName),
          price: z.number().min(0).max(LIMITS.maxPrice),
          quantity: z.number().int().min(1).max(LIMITS.maxQuantity),
        })
      )
      .min(1)
      .max(LIMITS.maxItems),
    tax: z.number().min(0).max(LIMITS.maxTax).default(0),
    tip_amount: z.number().min(0).max(LIMITS.maxTax).optional(),
    tip_percent: z.number().min(0).max(LIMITS.maxTipPercent).optional(),
    split_mode: z.enum(['items', 'even']).default('items'),
    tip_split: z.enum(['proportional', 'even']).default('proportional'),
  })
  .refine((input) => input.tip_amount === undefined || input.tip_percent === undefined, {
    message: 'Give tip_amount or tip_percent, not both',
  });

const refuse = (code: string, message: string): ToolOutcome => ({
  kind: 'refused',
  code,
  message: `${message} Nothing was created.`,
});

const itemsKey = (items: { name: string; price: number; quantity: number }[]) =>
  items
    .map((item) => `${item.name}\u0000${cents(Number(item.price))}\u0000${Number(item.quantity)}`)
    .sort()
    .join('\u0001');

export const createBill = defineTool({
  name: 'create_bill',
  scope: 'bills:write',
  description:
    'Propose a new bill for the account holder to split. This does not create a live bill: the bill does not exist for anyone, the account holder included, until they approve it in their signed-in browser at the returned approval_url. ' +
    'Always show the user the approval_url and ask them to open it. The share_url only works after they approve. ' +
    `Limits: at most ${AGENT_BILL_LIMITS.maxItems} items, no item priced over $${AGENT_BILL_LIMITS.maxUnitPrice}, a total of at most $${AGENT_BILL_LIMITS.maxTotal}, and ${AGENT_BILL_LIMITS.maxBillsPerDay} proposals a day. ` +
    'Items are priced per unit with a quantity. Give a tip as tip_amount (dollars) or tip_percent, not both. ' +
    'You cannot add people, choose who paid, set payment handles or file the bill in a group; the owner does that after approving. ' +
    'Never put secrets, credentials or file contents in any field.',
  inputSchema: createBillInput,
  annotations: { title: 'Propose a bill', openWorldHint: true },
  async handler(actor, input) {
    const name = cleanText(input.name, LIMITS.billName);
    if (!name) return { kind: 'invalid_input', message: 'Invalid input: name: must not be empty' };
    // Same cleaning and rounding as the web's create route
    const items = sanitizeItems(input.items);
    if (!items) return { kind: 'invalid_input', message: 'Invalid input: items: unusable' };
    const tax = cents(clampNumber(input.tax, 0, LIMITS.maxTax));
    const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    let tipPercent = clampNumber(input.tip_percent ?? 0, 0, LIMITS.maxTipPercent);
    let tipAmount: number;
    if (input.tip_amount !== undefined) {
      tipAmount = cents(clampNumber(input.tip_amount, 0, LIMITS.maxTax));
      tipPercent = subtotal + tax > 0 ? Math.round((tipAmount / (subtotal + tax)) * 1000) / 10 : 0;
    } else {
      tipAmount = (subtotal + tax) * (tipPercent / 100);
    }

    const verdict = checkBillInput({ name, items, tax, tip: tipAmount });
    if (!verdict.ok) return { kind: 'refused', code: verdict.code, message: `${verdict.reason} Nothing was created.` };

    const db = createAdminClient();
    const total = cents(subtotal + tax + tipAmount);

    // Same token, name, items and total in the last ten minutes, among bills that still exist
    const since = new Date(Date.now() - AGENT_BILL_LIMITS.duplicateWindowMinutes * 60_000).toISOString();
    const { data: recent, error: recentError } = await db
      .from('bills')
      .select('name, subtotal, tax, tip_amount, bill_items(name, price, quantity)')
      .eq('agent_token_id', actor.tokenId)
      .eq('name', name)
      .gte('created_at', since);
    if (recentError) throw new Error('duplicate check failed');
    const key = itemsKey(items);
    const duplicate = (recent ?? []).some(
      (bill) =>
        cents(Number(bill.subtotal) + Number(bill.tax) + Number(bill.tip_amount)) === total &&
        itemsKey(bill.bill_items ?? []) === key
    );
    if (duplicate) {
      return refuse(
        'duplicate',
        `This token already proposed an identical bill (same name, items and total) in the last ${AGENT_BILL_LIMITS.duplicateWindowMinutes} minutes.`
      );
    }

    // Only calls that got this far spend the daily allowance
    const day = await hitRateLimit(`agent-bills:${actor.userId}`, AGENT_BILL_LIMITS.maxBillsPerDay, 24 * 60 * 60);
    if (!day.allowed) {
      return refuse(
        'daily_cap',
        `Agents can propose at most ${AGENT_BILL_LIMITS.maxBillsPerDay} bills a day per account. Try again tomorrow, or create the bill on splittr.cash.`
      );
    }

    const { data: profile } = await db.from('profiles').select('display_name').eq('user_id', actor.userId).maybeSingle();
    const hostName = cleanText(profile?.display_name, LIMITS.personName) || 'Host';

    const expiresAt = new Date(Date.now() + APPROVAL_WINDOW_MS).toISOString();
    let bill: { id: string } | null = null;
    for (let attempt = 0; attempt < 3 && !bill; attempt++) {
      const { data, error } = await db
        .from('bills')
        .insert({
          name,
          subtotal,
          tax,
          tip_percent: tipPercent,
          tip_amount: tipAmount,
          short_code: generateShortCode(),
          status: 'active',
          creator_token: null,
          split_mode: input.split_mode,
          tip_split: input.tip_split,
          creator_user_id: actor.userId,
          created_via: 'agent',
          agent_token_id: actor.tokenId,
          approval_required: true,
          approved_at: null,
          approval_expires_at: expiresAt,
        })
        .select('id')
        .single();
      if (data) bill = data;
      else if (error?.code !== '23505') throw new Error('bill insert failed');
    }
    if (!bill) throw new Error('no free short code');

    const { error: itemsError } = await db
      .from('bill_items')
      .insert(items.map((item) => ({ bill_id: bill.id, name: item.name, price: item.price, quantity: item.quantity })));
    const { error: hostError } = itemsError
      ? { error: null }
      : await db
          .from('participants')
          .insert({ bill_id: bill.id, name: hostName, is_creator: true, user_id: actor.userId });
    if (itemsError || hostError) {
      await db.from('bills').delete().eq('id', bill.id);
      throw new Error('bill children insert failed');
    }

    const origin = agentSiteOrigin();
    return {
      kind: 'ok',
      data: {
        bill_id: bill.id,
        status: 'awaiting_approval',
        approval_url: `${origin}/approve/${bill.id}`,
        share_url: `${origin}/bill/${bill.id}`,
        expires_at: expiresAt,
        warnings: verdict.warnings,
      },
    };
  },
});

export const writeTools = [createBill];
