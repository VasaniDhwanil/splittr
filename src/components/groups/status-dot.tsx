import type { Bill } from '@/types';

/** 6px dot plus a plain word. Only "settled" reads as done; everything else is active. */
export function StatusDot({ status }: { status: Bill['status'] }) {
  const settled = status === 'settled';
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`size-1.5 rounded-full ${settled ? 'bg-white/25' : 'bg-primary'}`} aria-hidden />
      {settled ? 'Settled' : 'Active'}
    </span>
  );
}
