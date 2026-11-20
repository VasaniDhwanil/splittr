import { createAdminClient } from '@/lib/supabase/admin';
import { isPublished } from '@/lib/bill-visibility';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BASE = 'name, subtotal, tax, tip_amount, participants(name, is_creator)';

interface PreviewRow {
  name: string | null;
  subtotal: number | string | null;
  tax: number | string | null;
  tip_amount: number | string | null;
  participants: { name: string | null; is_creator: boolean | null }[] | null;
  approval_required?: boolean | null;
  approved_at?: string | null;
}

export interface BillPreview {
  name: string;
  host: string | null;
  count: number;
  total: number;
}

/**
 * What the page metadata and the share images show about a bill. Null for
 * anything that is not a published bill: the caller falls back to the generic
 * card. Names the approval columns, so a database without them (production
 * before migration 017) answers 42703 and the read is repeated without them,
 * where every bill counts as published.
 */
export async function loadBillPreview(id: string, db = createAdminClient()): Promise<BillPreview | null> {
  if (!UUID_RE.test(id)) return null;
  try {
    const read = (columns: string) => db.from('bills').select(columns).eq('id', id).maybeSingle<PreviewRow>();
    let { data, error } = await read(`${BASE}, approval_required, approved_at`);
    if (error?.code === '42703') ({ data, error } = await read(BASE));
    if (error || !data || !isPublished(data)) return null;

    const people = data.participants ?? [];
    return {
      name: data.name?.trim() || 'A shared bill',
      host: people.find((p) => p.is_creator)?.name?.trim() || null,
      count: people.length,
      total: Number(data.subtotal ?? 0) + Number(data.tax ?? 0) + Number(data.tip_amount ?? 0),
    };
  } catch {
    return null;
  }
}
