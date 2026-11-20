/**
 * A bill an agent proposed stays invisible until its owner approves it. Every
 * ordinary reader treats an unpublished bill exactly like one that does not
 * exist. A row that has no approval columns (a database from before migration
 * 017) is published.
 */
export interface ApprovalFields {
  approval_required?: boolean | null;
  approved_at?: string | null;
}

export const isPublished = (bill: ApprovalFields): boolean => !bill.approval_required || Boolean(bill.approved_at);

/**
 * The approval fields of a row for /api/bills/mine. A pending proposal whose
 * time has run out is not listed (the nightly job deletes it).
 */
export function approvalState(
  row: ApprovalFields & { created_via?: string | null; approval_expires_at?: string | null },
  now = Date.now()
) {
  const pending = !isPublished(row);
  const expiresAt = row.approval_expires_at ?? null;
  return {
    approval: pending ? ('pending' as const) : ('none' as const),
    created_via: row.created_via === 'agent' ? ('agent' as const) : ('web' as const),
    approval_expires_at: expiresAt,
    listed: !(pending && expiresAt !== null && Date.parse(expiresAt) <= now),
  };
}
