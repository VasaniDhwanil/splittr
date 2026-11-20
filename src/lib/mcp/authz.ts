/**
 * Every read the MCP tools make goes through here. The service-role client
 * bypasses row-level security, so the ONLY thing separating one account's data
 * from another's is the filter written into each query below. Rules:
 *
 *  - a bill is reachable when the actor created it, has a participant row on
 *    it (user_id), or is a CURRENT member of its group;
 *  - bills awaiting approval are never reachable, the actor's own included;
 *  - the filter is part of the query: no bill is ever fetched by id alone and
 *    judged afterwards;
 *  - column lists are explicit, so a token hash or creator token cannot be
 *    selected by accident.
 *
 * Details (items, participants, claims) are loaded only for bills this module
 * has already scoped: loadBillDetails takes RelatedBill values, which only
 * the finders here can produce.
 */
import { createAdminClient } from '@/lib/supabase/admin';
import type { Actor } from '@/lib/agent-access';
import { isPublished } from '@/lib/bill-visibility';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

/** Throws on anything that is not a UUID, so an id can never reshape a filter. */
function uuid(value: string): string {
  if (!isUuid(value)) throw new Error('not a uuid');
  return value;
}

const BILL_COLUMNS =
  'id, name, date, subtotal, tax, tip_amount, status, split_mode, tip_split, group_id, creator_user_id, paid_by_user_id, created_at, approval_required, approved_at';

export interface BillRow {
  id: string;
  name: string;
  date: string;
  subtotal: number;
  tax: number;
  tip_amount: number;
  status: 'draft' | 'active' | 'settled';
  split_mode: 'items' | 'even' | 'custom';
  tip_split: 'proportional' | 'even' | null;
  group_id: string | null;
  creator_user_id: string | null;
  paid_by_user_id: string | null;
  created_at: string;
  approval_required: boolean;
  approved_at: string | null;
}

export interface ItemRow {
  id: string;
  bill_id: string;
  name: string;
  price: number;
  quantity: number;
}

export interface ParticipantRow {
  id: string;
  bill_id: string;
  user_id: string | null;
  name: string;
  is_creator: boolean;
  custom_amount: number | null;
  payment_status: 'unpaid' | 'paid' | null;
  created_at: string;
}

export interface ClaimRow {
  id: string;
  participant_id: string;
  item_id: string;
  share: number;
}

declare const relatedBrand: unique symbol;
/** A bill this actor may see. Only the finders below create one. */
export type RelatedBill = BillRow & {
  readonly [relatedBrand]: true;
  /** How the actor is connected: the actor has their own participant row on it. */
  readonly viaParticipant: boolean;
};

const PUBLISHED_FILTER = 'approval_required.eq.false,approved_at.not.is.null';

// The Supabase builder's generic types do not help when select() takes a
// computed string, so filters are applied through this minimal shape.
interface Filterable {
  or(filters: string): this;
  eq(column: string, value: string): this;
  neq(column: string, value: string): this;
  gte(column: string, value: string): this;
  lte(column: string, value: string): this;
  order(column: string, options: { ascending: boolean }): this;
  limit(count: number): this;
}

export interface RelatedFilter {
  /** Newest first, at most this many. */
  limit?: number;
  status?: 'draft' | 'active' | 'settled';
  /** Everything except settled. */
  unsettled?: boolean;
  dateFrom?: string;
  dateTo?: string;
  /** Restrict to one group (the actor must be a current member). */
  groupId?: string;
  /** Leave out bills the actor is related to only through a group. */
  ownRowsOnly?: boolean;
}

function narrow<T extends Filterable>(query: T, filter: RelatedFilter): T {
  let q = query.or(PUBLISHED_FILTER);
  if (filter.status) q = q.eq('status', filter.status);
  if (filter.unsettled) q = q.neq('status', 'settled');
  if (filter.dateFrom) q = q.gte('date', filter.dateFrom);
  if (filter.dateTo) q = q.lte('date', filter.dateTo);
  if (filter.groupId) q = q.eq('group_id', uuid(filter.groupId));
  return q;
}

/** Groups the actor belongs to right now. Leaving a group deletes the row. */
export async function actorGroupIds(actor: Actor): Promise<string[]> {
  const { data, error } = await createAdminClient()
    .from('group_members')
    .select('group_id')
    .eq('user_id', uuid(actor.userId));
  if (error) throw new Error('group_members read failed');
  return (data ?? []).map((row) => row.group_id as string);
}

const brand = (row: BillRow, viaParticipant: boolean): RelatedBill =>
  ({ ...row, viaParticipant }) as unknown as RelatedBill;

const stillRelated = (actor: Actor, groups: string[], row: BillRow, viaParticipant: boolean) =>
  isPublished(row) &&
  (row.creator_user_id === actor.userId || viaParticipant || (row.group_id !== null && groups.includes(row.group_id)));

/** Bills the actor is related to, newest first. */
export async function findRelatedBills(actor: Actor, filter: RelatedFilter = {}): Promise<RelatedBill[]> {
  const db = createAdminClient();
  const me = uuid(actor.userId);
  const groups = await actorGroupIds(actor);
  if (filter.groupId && !groups.includes(filter.groupId)) return [];

  const newestFirst = <T extends Filterable>(q: T) => {
    const ordered = narrow(q, filter).order('created_at', { ascending: false });
    return filter.limit ? ordered.limit(filter.limit) : ordered;
  };

  const created = newestFirst(db.from('bills').select(BILL_COLUMNS).eq('creator_user_id', me) as unknown as Filterable);
  // Inner join: only bills that have a participant row for this account
  const joined = newestFirst(
    db
      .from('bills')
      .select(`${BILL_COLUMNS}, participants!inner(user_id)`)
      .eq('participants.user_id', me) as unknown as Filterable
  );
  const viaGroup =
    filter.ownRowsOnly || groups.length === 0
      ? null
      : newestFirst(db.from('bills').select(BILL_COLUMNS).in('group_id', groups) as unknown as Filterable);

  const [createdRes, joinedRes, groupRes] = await Promise.all([created, joined, viaGroup ?? Promise.resolve(null)] as unknown as Promise<{
    data: BillRow[] | null;
    error: unknown;
  } | null>[]);
  for (const res of [createdRes, joinedRes, groupRes]) {
    if (res && res.error) throw new Error('bills read failed');
  }

  const merged = new Map<string, RelatedBill>();
  const add = (rows: BillRow[] | null | undefined, viaParticipant: boolean) => {
    for (const raw of rows ?? []) {
      const { participants: _drop, ...row } = raw as BillRow & { participants?: unknown };
      void _drop;
      const existing = merged.get(row.id);
      if (existing) {
        if (viaParticipant && !existing.viaParticipant) merged.set(row.id, brand(row, true));
        continue;
      }
      if (stillRelated(actor, groups, row, viaParticipant)) merged.set(row.id, brand(row, viaParticipant));
    }
  };
  add(joinedRes?.data, true);
  add(createdRes?.data, false);
  add(groupRes?.data, false);

  const sorted = [...merged.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
  return filter.limit ? sorted.slice(0, filter.limit) : sorted;
}

/** One bill, only if the actor is related to it. Unrelated and nonexistent are indistinguishable. */
export async function findRelatedBill(actor: Actor, billId: string): Promise<RelatedBill | null> {
  const db = createAdminClient();
  const me = uuid(actor.userId);
  const id = uuid(billId);
  const groups = await actorGroupIds(actor);

  const relation =
    groups.length > 0
      ? `creator_user_id.eq.${me},group_id.in.(${groups.map(uuid).join(',')})`
      : `creator_user_id.eq.${me}`;
  const direct = await db.from('bills').select(BILL_COLUMNS).eq('id', id).or(relation).or(PUBLISHED_FILTER).maybeSingle();
  if (direct.error) throw new Error('bills read failed');
  if (direct.data && stillRelated(actor, groups, direct.data as BillRow, false)) {
    // The participant lookup below decides viaParticipant
    const hasRow = await hasParticipantRow(me, id);
    return brand(direct.data as BillRow, hasRow);
  }

  const joined = await db
    .from('bills')
    .select(`${BILL_COLUMNS}, participants!inner(user_id)`)
    .eq('id', id)
    .eq('participants.user_id', me)
    .or(PUBLISHED_FILTER)
    .maybeSingle();
  if (joined.error) throw new Error('bills read failed');
  if (!joined.data) return null;
  const { participants: _drop, ...row } = joined.data as BillRow & { participants?: unknown };
  void _drop;
  return stillRelated(actor, groups, row, true) ? brand(row, true) : null;
}

async function hasParticipantRow(userId: string, billId: string): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from('participants')
    .select('id')
    .eq('bill_id', uuid(billId))
    .eq('user_id', uuid(userId))
    .limit(1);
  if (error) throw new Error('participants read failed');
  return (data?.length ?? 0) > 0;
}

export interface BillDetail {
  bill: RelatedBill;
  items: ItemRow[];
  participants: ParticipantRow[];
  claims: ClaimRow[];
}

const CHUNK = 100;
const chunks = <T>(values: T[]): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += CHUNK) out.push(values.slice(i, i + CHUNK));
  return out;
};

/** Items, participants and claims for bills already scoped to the actor. */
export async function loadBillDetails(bills: RelatedBill[]): Promise<BillDetail[]> {
  const db = createAdminClient();
  const billIds = bills.map((bill) => uuid(bill.id));
  const items: ItemRow[] = [];
  const participants: ParticipantRow[] = [];
  for (const ids of chunks(billIds)) {
    const [itemRes, partRes] = await Promise.all([
      db.from('bill_items').select('id, bill_id, name, price, quantity').in('bill_id', ids).order('created_at'),
      db
        .from('participants')
        .select('id, bill_id, user_id, name, is_creator, custom_amount, payment_status, created_at')
        .in('bill_id', ids)
        .order('created_at'),
    ]);
    if (itemRes.error || partRes.error) throw new Error('bill details read failed');
    items.push(...(itemRes.data as ItemRow[]));
    participants.push(...(partRes.data as ParticipantRow[]));
  }

  const claims: ClaimRow[] = [];
  for (const ids of chunks(items.map((item) => item.id))) {
    const { data, error } = await db.from('item_claims').select('id, participant_id, item_id, share').in('item_id', ids);
    if (error) throw new Error('claims read failed');
    claims.push(...(data as ClaimRow[]));
  }

  const itemsBy = groupBy(items, (item) => item.bill_id);
  const participantsBy = groupBy(participants, (p) => p.bill_id);
  const itemBill = new Map(items.map((item) => [item.id, item.bill_id]));
  const claimsBy = groupBy(claims, (claim) => itemBill.get(claim.item_id) ?? '');

  return bills.map((bill) => ({
    bill,
    items: itemsBy.get(bill.id) ?? [],
    participants: participantsBy.get(bill.id) ?? [],
    claims: claimsBy.get(bill.id) ?? [],
  }));
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    map.set(k, [...(map.get(k) ?? []), row]);
  }
  return map;
}

export interface GroupSummary {
  id: string;
  name: string;
  creator_user_id: string | null;
  role: 'owner' | 'member';
  member_count: number;
}

/** The groups the actor belongs to now, with member counts. */
export async function findActorGroups(actor: Actor): Promise<GroupSummary[]> {
  const db = createAdminClient();
  const { data: mine, error } = await db
    .from('group_members')
    .select('group_id, role')
    .eq('user_id', uuid(actor.userId));
  if (error) throw new Error('group_members read failed');
  if (!mine || mine.length === 0) return [];

  const ids = mine.map((row) => uuid(row.group_id as string));
  const [groupsRes, countsRes] = await Promise.all([
    db.from('groups').select('id, name, creator_user_id, created_at').in('id', ids).order('created_at'),
    db.from('group_members').select('group_id').in('group_id', ids),
  ]);
  if (groupsRes.error || countsRes.error) throw new Error('groups read failed');

  const counts = new Map<string, number>();
  for (const row of countsRes.data ?? []) counts.set(row.group_id, (counts.get(row.group_id) ?? 0) + 1);
  const roles = new Map(mine.map((row) => [row.group_id as string, row.role as 'owner' | 'member']));

  return (groupsRes.data ?? []).map((group) => ({
    id: group.id,
    name: group.name,
    creator_user_id: group.creator_user_id,
    role: roles.get(group.id) ?? 'member',
    member_count: counts.get(group.id) ?? 0,
  }));
}

export interface ProfileRow {
  user_id: string;
  display_name: string | null;
  venmo_handle: string | null;
  cashapp_handle: string | null;
  paypal_handle: string | null;
}

/** Profiles for accounts that appeared on the actor's own bills. Never Zelle. */
export async function loadProfiles(userIds: string[]): Promise<Map<string, ProfileRow>> {
  const out = new Map<string, ProfileRow>();
  for (const ids of chunks([...new Set(userIds)].map(uuid))) {
    const { data, error } = await createAdminClient()
      .from('profiles')
      .select('user_id, display_name, venmo_handle, cashapp_handle, paypal_handle')
      .in('user_id', ids);
    if (error) throw new Error('profiles read failed');
    for (const row of data ?? []) out.set(row.user_id, row as ProfileRow);
  }
  return out;
}
