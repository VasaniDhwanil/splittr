'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { useStagger } from '@/components/groups/reveal';
import { formatTimeLeft } from '@/lib/agent-ui';

interface PendingBillRowProps {
  id: string;
  name: string;
  expiresAt: string | null;
  index?: number;
}

/** A bill an agent proposed. It links to the approval page, never to the bill. */
export function PendingBillRow({ id, name, expiresAt, index }: PendingBillRowProps) {
  const stagger = useStagger(index);
  return (
    <motion.div {...stagger} className="tactile group relative flex min-h-[64px] items-center gap-3 px-4 py-3.5">
      <div className="min-w-0 flex-1">
        <Link
          href={`/approve/${id}`}
          className="block truncate font-medium text-white outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:rounded-[inherit] focus-visible:after:ring-2 focus-visible:after:ring-ring/50"
        >
          {name}
        </Link>
        <p className="mt-0.5 flex items-center gap-1.5 overflow-hidden whitespace-nowrap text-xs text-white/40">
          <span>Review and approve</span>
          {expiresAt && (
            <>
              <span aria-hidden>·</span>
              <span>Expires {formatTimeLeft(expiresAt)}</span>
            </>
          )}
        </p>
      </div>
      <ChevronRight className="size-4 shrink-0 text-white/25 transition-[color,translate] duration-200 group-hover:translate-x-0.5 group-hover:text-white/50" />
    </motion.div>
  );
}
