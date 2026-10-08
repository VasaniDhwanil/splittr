'use client';

import type { LucideIcon } from 'lucide-react';
import { Camera, Upload } from 'lucide-react';

interface ReceiptPickerProps {
  isScanning: boolean;
  onTakePhoto: () => void;
  onUploadPhoto: () => void;
  onEnterByHand: () => void;
  onTotalOnly: () => void;
}

function Tile({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-32 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/15 px-4 text-white outline-none transition-colors touch-manipulation hover:border-white/30 hover:bg-white/[0.03] focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <Icon className="size-6 text-white/60" aria-hidden />
      <span className="font-medium">{label}</span>
    </button>
  );
}

const GHOST_LINK =
  'inline-flex min-h-11 items-center rounded-full px-3 text-sm text-white/50 outline-none transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-ring/50';

/** Receipt step: camera or file tiles, a manual fallback, and a skeleton while the scan runs. */
export function ReceiptPicker({ isScanning, onTakePhoto, onUploadPhoto, onEnterByHand, onTotalOnly }: ReceiptPickerProps) {
  if (isScanning) {
    return (
      <div aria-busy="true" aria-live="polite" className="space-y-5">
        <div className="animate-pulse divide-y divide-white/[0.06]">
          {['w-2/5', 'w-1/2', 'w-1/3'].map((width) => (
            <div key={width} className="flex items-center justify-between gap-4 py-3.5">
              <div className={`h-4 rounded-md bg-white/[0.06] ${width}`} />
              <div className="h-4 w-14 rounded-md bg-white/[0.06]" />
            </div>
          ))}
        </div>
        <p className="text-sm text-white/40">Reading your receipt</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Tile icon={Camera} label="Take a photo" onClick={onTakePhoto} />
        <Tile icon={Upload} label="Upload a photo" onClick={onUploadPhoto} />
      </div>
      <div className="-mx-3 flex flex-wrap items-center gap-x-1">
        <button type="button" onClick={onEnterByHand} className={GHOST_LINK}>
          Or enter items by hand
        </button>
        <span aria-hidden className="text-white/20">
          ·
        </span>
        <button type="button" onClick={onTotalOnly} className={GHOST_LINK}>
          Just split a total
        </button>
      </div>
    </div>
  );
}
