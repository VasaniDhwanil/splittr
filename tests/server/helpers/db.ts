import { randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { issueParticipantToken } from '@/lib/auth-helpers';
import type { TestUser } from './session';

export const db = () => createAdminClient();

/** A statement stuck behind another connection's lock fails fast instead of hanging a whole run. */
export const SQL_LOCK_TIMEOUT_MS = 8_000;
export const SQL_STATEMENT_TIMEOUT_MS = 15_000;

/** Raw SQL against the local database, for what PostgREST can't express. */
export async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const client = new Client({
    connectionString: process.env.TEST_DATABASE_URL,
    connectionTimeoutMillis: 10_000,
    lock_timeout: SQL_LOCK_TIMEOUT_MS,
    statement_timeout: SQL_STATEMENT_TIMEOUT_MS,
  });
  await client.connect();
  try {
    const result = await client.query(text, params);
    return result.rows as T[];
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === '55P03' || code === '57014') {
      const kind = code === '55P03' ? 'lock timeout (another connection holds a lock)' : 'statement timeout';
      throw new Error(`sql() ${kind} after ${code === '55P03' ? SQL_LOCK_TIMEOUT_MS : SQL_STATEMENT_TIMEOUT_MS} ms: ${text.slice(0, 120)}`, {
        cause: error,
      });
    }
    throw error;
  } finally {
    await client.end();
  }
}

const tag = () => randomBytes(4).toString('hex');

export async function createUser(label = 'user', displayName?: string): Promise<TestUser> {
  const email = `${label}-${tag()}@test.local`;
  const { data, error } = await db().auth.admin.createUser({ email, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  await db()
    .from('profiles')
    .upsert({ user_id: data.user.id, display_name: displayName ?? label }, { onConflict: 'user_id' });
  return { id: data.user.id, email };
}

export interface TestBill {
  id: string;
  shortCode: string;
  creatorToken: string;
  creatorParticipantId: string;
  itemIds: string[];
}

export async function createBill(
  opts: {
    creator?: TestUser | null;
    name?: string;
    hostName?: string;
    groupId?: string | null;
    items?: { name: string; price: number; quantity: number }[];
    extra?: Record<string, unknown>;
  } = {}
): Promise<TestBill> {
  const items = opts.items ?? [
    { name: 'Pasta', price: 18, quantity: 1 },
    { name: 'Beer', price: 7, quantity: 2 },
  ];
  const creatorToken = randomBytes(32).toString('base64url');
  const shortCode = tag().toUpperCase();
  const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const { data: bill, error } = await db()
    .from('bills')
    .insert({
      name: opts.name ?? `test bill ${tag()}`,
      subtotal,
      tax: 0,
      tip_percent: 0,
      tip_amount: 0,
      short_code: shortCode,
      status: 'active',
      creator_token: creatorToken,
      split_mode: 'items',
      tip_split: 'proportional',
      group_id: opts.groupId ?? null,
      ...(opts.creator ? { creator_user_id: opts.creator.id } : {}),
      ...opts.extra,
    })
    .select('id')
    .single();
  if (error || !bill) throw new Error(`createBill failed: ${error?.message}`);

  const { data: itemRows, error: itemsError } = await db()
    .from('bill_items')
    .insert(items.map((i) => ({ bill_id: bill.id, ...i })))
    .select('id');
  if (itemsError || !itemRows) throw new Error(`createBill items failed: ${itemsError?.message}`);

  const { data: host, error: hostError } = await db()
    .from('participants')
    .insert({
      bill_id: bill.id,
      name: opts.hostName ?? 'Host',
      is_creator: true,
      ...(opts.creator ? { user_id: opts.creator.id } : {}),
    })
    .select('id')
    .single();
  if (hostError || !host) throw new Error(`createBill host failed: ${hostError?.message}`);

  return {
    id: bill.id,
    shortCode,
    creatorToken,
    creatorParticipantId: host.id,
    itemIds: itemRows.map((r) => r.id),
  };
}

/** A participant row as the join route would create it. */
export async function joinBill(
  billId: string,
  opts: { name?: string; user?: TestUser | null; withToken?: boolean } = {}
): Promise<{ id: string; token: string | null }> {
  const issued = opts.withToken === false ? null : issueParticipantToken();
  const { data, error } = await db()
    .from('participants')
    .insert({
      bill_id: billId,
      name: opts.name ?? `Guest ${tag()}`,
      is_creator: false,
      participant_token_hash: issued?.hash ?? null,
      ...(opts.user ? { user_id: opts.user.id } : {}),
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`joinBill failed: ${error?.message}`);
  return { id: data.id, token: issued?.token ?? null };
}

export async function createGroup(owner: TestUser, members: TestUser[] = []): Promise<{ id: string }> {
  const { data: group, error } = await db()
    .from('groups')
    .insert({ name: `test group ${tag()}`, creator_user_id: owner.id, invite_code: tag().toUpperCase() })
    .select('id')
    .single();
  if (error || !group) throw new Error(`createGroup failed: ${error?.message}`);
  const rows = [
    { group_id: group.id, user_id: owner.id, display_name: 'Owner', role: 'owner' },
    ...members.map((m, i) => ({ group_id: group.id, user_id: m.id, display_name: `Member ${i + 1}`, role: 'member' })),
  ];
  const { error: membersError } = await db().from('group_members').insert(rows);
  if (membersError) throw new Error(`createGroup members failed: ${membersError.message}`);
  return { id: group.id };
}

/**
 * A request as a route handler receives it. Each call comes from its own
 * address so the per-IP limiters never couple unrelated tests.
 */
export function request(
  method: string,
  path: string,
  opts: { body?: unknown; headers?: Record<string, string> } = {}
): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: {
      'x-forwarded-for': `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${randomBytes(1)[0]}`,
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...opts.headers,
    },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
}

export const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });

export const uuid = () => randomUUID();
