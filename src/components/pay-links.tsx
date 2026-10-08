'use client';

import type { MouseEvent } from 'react';
import { useState } from 'react';
import { Copy, Check, QrCode } from 'lucide-react';
import { toast } from 'sonner';
import { formatCurrency } from '@/lib/calculations';
import { openPaymentOption, type PaymentOption, type ZelleInfo } from '@/lib/payment-links';

/** Zelle's brand purple. */
export const ZELLE_COLOR = '#6D1ED4';

/**
 * onClick for a pay link: on phones, opens the native app (Venmo) and falls
 * back to the web link; elsewhere lets the <a href> open normally.
 */
export function onPayLinkClick(option: PaymentOption) {
  return (e: MouseEvent<HTMLAnchorElement>) => {
    const handled = openPaymentOption(option, {
      userAgent: navigator.userAgent,
      navigate: (url) => {
        window.location.href = url;
      },
      isHidden: () => document.visibilityState === 'hidden',
      schedule: (fn, ms) => {
        window.setTimeout(fn, ms);
      },
    });
    if (handled) e.preventDefault();
  };
}

async function copy(text: string, message: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(message);
  } catch {
    toast.error('Could not copy. Long-press to select it instead.');
  }
}

function CopyRow({
  label,
  value,
  copyValue,
  message,
  money,
}: {
  label: string;
  value: string;
  copyValue: string;
  message: string;
  money?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await copy(copyValue, message);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      }}
      className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-2.5 text-left outline-none transition-colors hover:bg-white/[0.04] focus-visible:bg-white/[0.04]"
    >
      <span className="min-w-0">
        <span className="block text-[11px] font-medium uppercase tracking-wider text-white/40">{label}</span>
        <span className={`block truncate text-white ${money ? 'font-money' : 'font-medium'}`}>{value}</span>
      </span>
      {copied ? <Check className="size-4 shrink-0 text-primary" /> : <Copy className="size-4 shrink-0 text-white/35" />}
    </button>
  );
}

/**
 * Zelle has no deep link: show the recipient + amount to copy into the
 * payer's bank app, and the owner's QR screenshot for scanning in person.
 */
export function ZellePanel({ zelle, amount }: { zelle: ZelleInfo; amount: number }) {
  const [showQr, setShowQr] = useState(false);
  return (
    <div className="divide-y divide-white/[0.06] overflow-hidden rounded-xl border border-white/10 bg-white/[0.03] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
      <div className="flex min-h-12 items-center gap-2 px-4 py-1.5">
        <span className="text-sm font-medium text-white">Zelle</span>
        <span className="min-w-0 flex-1 truncate text-xs text-white/40">via your bank app</span>
        {zelle.qrUrl && (
          <button
            type="button"
            onClick={() => setShowQr((v) => !v)}
            className="-mr-2 inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-white/60 outline-none transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:ring-2 focus-visible:ring-ring/50"
            aria-expanded={showQr}
          >
            <QrCode className="size-3.5" />
            {showQr ? 'Hide QR' : 'Show QR'}
          </button>
        )}
      </div>

      {zelle.qrUrl && showQr && (
        <div className="flex flex-col items-center gap-2 px-4 py-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
          <img src={zelle.qrUrl} alt="Zelle QR code" className="w-56 max-w-full rounded-xl bg-white object-contain p-2" />
          <p className="text-center text-xs text-white/40">
            Scan from Zelle in your bank app. Enter the amount yourself.
          </p>
        </div>
      )}

      {zelle.display && zelle.copyValue && (
        <CopyRow
          label={zelle.kind === 'phone' ? 'Send to phone' : 'Send to email'}
          value={zelle.display}
          copyValue={zelle.copyValue}
          message="Recipient copied. Paste it in Zelle."
        />
      )}
      <CopyRow
        label="Amount"
        value={formatCurrency(amount)}
        copyValue={Math.max(0, amount).toFixed(2)}
        message="Amount copied"
        money
      />
    </div>
  );
}

/** Compact Zelle chip for balance rows: copies the recipient and says how much. */
export function ZelleChip({ zelle, amount, name }: { zelle: ZelleInfo; amount: number; name: string }) {
  if (!zelle.copyValue) return null;
  return (
    <button
      type="button"
      onClick={() =>
        copy(zelle.copyValue!, `Copied ${zelle.display}. Send ${formatCurrency(amount)} with Zelle in your bank app.`)
      }
      aria-label={`Copy ${name}'s Zelle (${zelle.display}) to pay ${formatCurrency(amount)}`}
      className="inline-flex h-9 items-center gap-1 rounded-full border border-white/10 px-3.5 text-xs font-medium text-white/70 transition-colors hover:border-white/20 hover:bg-white/[0.04] hover:text-white"
    >
      Zelle
      <Copy className="size-3 text-white/35" />
    </button>
  );
}
