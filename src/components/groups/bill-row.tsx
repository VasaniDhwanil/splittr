import type { ReactNode } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import type { Bill } from '@/types';
import { formatCurrency } from '@/lib/calculations';
import { formatRelativeDate } from '@/lib/format-date';
import { StatusDot } from './status-dot';

interface BillRowProps {
  id: string;
  name: string;
  createdAt: string;
  /** Omitted while details are loading, or when the status shouldn't show. */
  status?: Bill['status'];
  peopleCount?: number;
  total?: number;
  /** Plain muted word in the meta line, e.g. "Host" / "Joined". */
  role?: string;
  /** Dims the row and adds "Archived" to the meta line. */
  archived?: boolean;
  /** Control at the row's end (before the chevron), e.g. archive/restore. Sits above the link. */
  action?: ReactNode;
}

function Dot() {
  return <span aria-hidden>·</span>;
}

export function BillRow({ id, name, createdAt, status, peopleCount, total, role, archived, action }: BillRowProps) {
  const meta: ReactNode[] = [];
  if (archived) meta.push(<span key="archived">Archived</span>);
  if (status) meta.push(<StatusDot key="status" status={status} />);
  meta.push(<span key="date">{formatRelativeDate(createdAt)}</span>);
  if (peopleCount !== undefined) {
    meta.push(
      <span key="people">
        {peopleCount} {peopleCount === 1 ? 'person' : 'people'}
      </span>
    );
  }
  if (role) meta.push(<span key="role">{role}</span>);

  return (
    <div
      className={`group relative flex min-h-[64px] items-center gap-3 px-4 py-3.5 transition-colors hover:bg-white/[0.04] ${archived ? 'opacity-60' : ''}`}
    >
      <div className="min-w-0 flex-1">
        {/* Stretched link: the whole row navigates, while the action stays a separate control */}
        <Link
          href={`/bill/${id}`}
          className="block truncate font-medium text-white outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:rounded-[inherit] focus-visible:after:ring-2 focus-visible:after:ring-ring/50"
        >
          {name}
        </Link>
        <p className="mt-0.5 flex items-center gap-1.5 overflow-hidden whitespace-nowrap text-xs text-white/40">
          {meta.flatMap((item, i) => (i === 0 ? [item] : [<Dot key={`dot-${i}`} />, item]))}
        </p>
      </div>
      {total !== undefined && (
        <span className="font-money shrink-0 whitespace-nowrap text-[15px] text-white">{formatCurrency(total)}</span>
      )}
      {action && <div className="relative z-10 shrink-0">{action}</div>}
      <ChevronRight className="size-4 shrink-0 text-white/25" />
    </div>
  );
}
