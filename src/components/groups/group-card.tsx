'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { formatCurrency } from '@/lib/calculations';
import { getPersonHex } from '@/components/avatar-initials';
import { useStagger } from './reveal';

interface GroupCardProps {
  id: string;
  name: string;
  memberCount?: number;
  billCount: number;
  totalAmount: number;
  activeCount: number;
  /** Position in the grid, for the mount stagger. Omit to appear at once. */
  index?: number;
}

export function GroupCard({ id, name, memberCount, billCount, totalAmount, activeCount, index }: GroupCardProps) {
  const stagger = useStagger(index);
  const meta = [
    memberCount !== undefined ? `${memberCount} ${memberCount === 1 ? 'member' : 'members'}` : null,
    `${billCount} ${billCount === 1 ? 'bill' : 'bills'}`,
    activeCount > 0 ? `${activeCount} active` : null,
  ].filter(Boolean);

  // A faint ambient in the group's own color (about 6%), lit from the top left.
  const ambient = `radial-gradient(120% 90% at 0% 0%, ${getPersonHex(name)}0f, transparent 70%)`;

  return (
    <motion.div {...stagger} className="h-full">
      <Link
        href={`/groups/${id}`}
        style={{ backgroundImage: ambient }}
        className="surface tactile group flex h-full flex-col justify-between gap-6 rounded-2xl p-5 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="min-w-0 truncate font-semibold tracking-tight text-white">{name}</h3>
          <ChevronRight className="mt-0.5 size-4 shrink-0 text-white/25 transition-[color,translate] duration-200 group-hover:translate-x-0.5 group-hover:text-white/50" />
        </div>
        <div className="flex items-end justify-between gap-3">
          <p className="min-w-0 truncate text-sm text-white/40">{meta.join(' · ')}</p>
          {billCount > 0 && (
            <span className="font-money shrink-0 whitespace-nowrap text-sm text-white">{formatCurrency(totalAmount)}</span>
          )}
        </div>
      </Link>
    </motion.div>
  );
}
