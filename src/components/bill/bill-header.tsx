'use client';

import { Check, Copy, Loader2, Pencil, QrCode, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusDot } from '@/components/groups/status-dot';
import type { Bill } from '@/types';

interface BillHeaderProps {
  name: string;
  status: Bill['status'];
  /** Short facts joined by middle dots, e.g. ["Hosted by Sam", "4 people"]. */
  meta: string[];
  shortCode: string;
  copied: boolean;
  canEdit: boolean;
  onCopy: () => void;
  onShare: () => void;
  onShowQr: () => void;
  onEdit: () => void;
}

const ICON_ACTION = 'text-white/40 hover:text-white hover:bg-white/[0.06] transition-colors';

export function BillHeader({
  name,
  status,
  meta,
  shortCode,
  copied,
  canEdit,
  onCopy,
  onShare,
  onShowQr,
  onEdit,
}: BillHeaderProps) {
  return (
    <header className="space-y-4">
      <div className="min-w-0">
        <h1 className="break-words text-3xl font-semibold tracking-tight text-balance text-white sm:text-4xl">{name}</h1>
        <p className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm tabular-nums text-white/40">
          {meta.map((fact) => (
            <span key={fact} className="inline-flex items-center gap-1.5">
              {fact}
              <span aria-hidden>·</span>
            </span>
          ))}
          <span>
            code <span className="font-mono text-white/60">{shortCode}</span>
          </span>
          <span aria-hidden>·</span>
          <StatusDot status={status} />
        </p>
      </div>

      <div className="-ml-2.5 flex items-center gap-1">
        <Button variant="ghost" size="icon" className={ICON_ACTION} title="Copy link" aria-label="Copy link" onClick={onCopy}>
          {copied ? <Check className="text-primary" /> : <Copy />}
        </Button>
        <Button variant="ghost" size="icon" className={ICON_ACTION} title="Share" aria-label="Share" onClick={onShare}>
          <Share2 />
        </Button>
        <Button variant="ghost" size="icon" className={ICON_ACTION} title="Show QR code" aria-label="Show QR code" onClick={onShowQr}>
          <QrCode />
        </Button>
        {canEdit && (
          <Button variant="ghost" size="icon" className={ICON_ACTION} title="Edit bill" aria-label="Edit bill" onClick={onEdit}>
            <Pencil />
          </Button>
        )}
      </div>
    </header>
  );
}

interface HostPanelProps {
  status: Bill['status'];
  paidCount: number;
  payerCount: number;
  isUpdating: boolean;
  onToggleStatus: () => void;
}

/** The host's quiet control strip: collection progress and settle/reopen. */
export function HostPanel({ status, paidCount, payerCount, isUpdating, onToggleStatus }: HostPanelProps) {
  const settled = status === 'settled';
  const pct = payerCount > 0 ? (paidCount / payerCount) * 100 : 0;
  return (
    <div className="surface flex flex-col gap-4 rounded-2xl p-4 sm:flex-row sm:items-center sm:gap-6">
      {payerCount > 0 && (
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-baseline justify-between gap-3 text-sm">
            <span className="text-white/50">Payments collected</span>
            <span className="shrink-0 tabular-nums text-white">
              {paidCount} of {payerCount} paid
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
            <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
      <Button
        variant={settled ? 'ghost' : 'secondary'}
        className={`shrink-0 ${payerCount === 0 ? 'w-full' : 'w-full sm:w-auto'} ${settled ? 'text-white/60 hover:bg-white/[0.06] hover:text-white' : ''}`}
        onClick={onToggleStatus}
        disabled={isUpdating}
      >
        {isUpdating && <Loader2 className="animate-spin" />}
        {isUpdating ? 'Updating...' : settled ? 'Reopen bill' : 'Mark as settled'}
      </Button>
    </div>
  );
}
