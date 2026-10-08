import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { formatCurrency } from '@/lib/calculations';

interface GroupCardProps {
  id: string;
  name: string;
  memberCount?: number;
  billCount: number;
  totalAmount: number;
  activeCount: number;
}

export function GroupCard({ id, name, memberCount, billCount, totalAmount, activeCount }: GroupCardProps) {
  const meta = [
    memberCount !== undefined ? `${memberCount} ${memberCount === 1 ? 'member' : 'members'}` : null,
    `${billCount} ${billCount === 1 ? 'bill' : 'bills'}`,
    activeCount > 0 ? `${activeCount} active` : null,
  ].filter(Boolean);

  return (
    <Link
      href={`/groups/${id}`}
      className="group flex h-full flex-col justify-between gap-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition-colors hover:border-white/15 hover:bg-white/[0.05]"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 truncate font-semibold tracking-tight text-white">{name}</h3>
        <ChevronRight className="mt-0.5 size-4 shrink-0 text-white/25 transition-colors group-hover:text-white/50" />
      </div>
      <div className="flex items-end justify-between gap-3">
        <p className="min-w-0 truncate text-sm text-white/40">{meta.join(' · ')}</p>
        {billCount > 0 && (
          <span className="font-money shrink-0 whitespace-nowrap text-sm text-white">{formatCurrency(totalAmount)}</span>
        )}
      </div>
    </Link>
  );
}
