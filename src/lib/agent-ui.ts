// Copy and small helpers for the agent access screens. Client-safe: no Node imports.

export type AgentScope = 'read' | 'bills:write';

export const SCOPE_LABELS: Record<AgentScope, string> = {
  read: 'Read your bills, groups and balances',
  'bills:write': 'Propose new bills (each one waits for your approval)',
};

export const EXPIRY_CHOICES = [7, 30, 90] as const;
export type ExpiryDays = (typeof EXPIRY_CHOICES)[number];
export const DEFAULT_EXPIRY: ExpiryDays = 30;

export type TokenStatus = 'active' | 'suspended' | 'expired' | 'revoked';

export interface TokenRow {
  id: string;
  name: string;
  last4: string;
  scopes: AgentScope[];
  created_at: string;
  expires_at: string;
  last_used_at: string | null;
  last_used_ip: string | null;
  status: TokenStatus;
  suspended_reason: string | null;
  revoked_reason: string | null;
}

export function formatDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** "in 3 hours" / "in 25 minutes" for something that ends later. */
export function formatTimeLeft(iso: string, now: Date = new Date()): string {
  const ms = new Date(iso).getTime() - now.getTime();
  if (Number.isNaN(ms)) return '';
  if (ms <= 0) return 'now';
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `in ${Math.max(minutes, 1)} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  return `in ${hours} hour${hours === 1 ? '' : 's'}`;
}

export function revokedReasonText(reason: string | null): string {
  switch (reason) {
    case 'user':
      return 'revoked by you';
    case 'revoke_all':
      return 'revoked with Revoke all';
    case 'revoke_link':
      return 'revoked from the link in an email';
    case 'query_string':
      return 'revoked automatically because it was sent inside a web address';
    default:
      return 'revoked';
  }
}

/** Plain-words message for each error the token routes can answer. */
export function tokenErrorMessage(
  code: string | undefined,
  body: { error?: string; attempts_left?: number; retry_after?: number } = {}
): string {
  switch (code) {
    case 'wrong_code': {
      const n = body.attempts_left;
      if (typeof n === 'number') {
        return n > 0
          ? `That code is not right. ${n} ${n === 1 ? 'try' : 'tries'} left.`
          : 'That code is not right, and you are out of tries. Ask for a new code.';
      }
      return 'That code is not right.';
    }
    case 'expired':
      return 'That code has expired. Ask for a new one.';
    case 'no_pending':
      return 'There is no code waiting for you. Go back and start again.';
    case 'too_many_attempts':
      return 'Too many wrong tries on that code. Ask for a new one.';
    case 'token_limit':
      return 'You already have 5 active agent tokens. Revoke one, then try again.';
    case 'locked':
      return 'Making tokens is locked for now because of too many wrong codes. It unlocks after 24 hours, or when you next sign in with an emailed link.';
    case 'rate_limited': {
      const s = body.retry_after;
      if (typeof s === 'number' && s > 0) {
        const m = Math.ceil(s / 60);
        return `You have asked for too many codes. Try again in ${m} ${m === 1 ? 'minute' : 'minutes'}.`;
      }
      return 'You have asked for too many codes. Try again a little later.';
    }
    case 'email_unavailable':
      return 'We could not send the email just now. Nothing was created. Try again in a little while.';
    case 'invalid_input':
      return body.error || 'Check the name and options, then try again.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

/** The fields of a /api/bills/mine row this module reads. Older databases omit the last three. */
export interface MineRowLike {
  id: string;
  approval?: 'none' | 'pending';
  created_via?: 'web' | 'agent';
  approval_expires_at?: string | null;
}

/** Pending rows go to their own list and never into the normal one. A missing `approval` means none. */
export function splitMineRows<T extends MineRowLike>(rows: T[]): { normal: T[]; pending: T[] } {
  const normal: T[] = [];
  const pending: T[] = [];
  for (const row of rows) (row.approval === 'pending' ? pending : normal).push(row);
  return { normal, pending };
}
