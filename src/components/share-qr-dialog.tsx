'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Download, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface ShareQrDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The bill link the code points at. */
  url: string;
  billName: string;
  shortCode: string;
}

// Dark modules on white: inverted (light-on-dark) codes fail on some phone cameras.
const QR_OPTIONS = {
  errorCorrectionLevel: 'M',
  margin: 2,
  color: { dark: '#0b0b0d', light: '#ffffff' },
} as const;

function fileName(billName: string): string {
  const slug = billName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `splittr-${slug || 'bill'}-qr.png`;
}

/**
 * A scannable code for the bill link, for the table where passing a link
 * around is slower than holding up a phone. Generated on the device: the
 * link never leaves the browser to make the image.
 */
export function ShareQrDialog({ open, onOpenChange, url, billName, shortCode }: ShareQrDialogProps) {
  const [svg, setSvg] = useState<string | null>(null);
  const [isSharing, setIsSharing] = useState(false);

  useEffect(() => {
    if (!open || !url) return;
    let cancelled = false;
    QRCode.toString(url, { ...QR_OPTIONS, type: 'svg' })
      .then((markup) => {
        if (!cancelled) setSvg(markup);
      })
      .catch(() => {
        if (!cancelled) setSvg(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, url]);

  // Send the code as an image (Messages, WhatsApp, a group chat); download where sharing files is unsupported.
  const handleSendImage = async () => {
    setIsSharing(true);
    try {
      const dataUrl = await QRCode.toDataURL(url, { ...QR_OPTIONS, width: 1024 });
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], fileName(billName), { type: 'image/png' });

      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: `Join ${billName} on Splittr`,
            text: `Scan to join ${billName} and tap your items. Code: ${shortCode}`,
          });
        } catch {
          // Closing the share sheet is not an error
        }
        return;
      }

      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = file.name;
      a.click();
      toast.success('QR code saved. Send it to the group.');
    } catch {
      toast.error('Could not make the image. Try showing the code instead.');
    } finally {
      setIsSharing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Scan to join</DialogTitle>
          <DialogDescription>
            Hold this up at the table. Everyone scans it with their camera and taps their items.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-2">
          <div
            className="aspect-square w-full max-w-[18rem] overflow-hidden rounded-2xl bg-white p-2 shadow-[0_24px_48px_-32px_rgb(74_222_128/0.35)]"
            role="img"
            aria-label={`QR code linking to ${billName}`}
          >
            {svg ? (
              <div className="size-full [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: svg }} />
            ) : (
              <div className="size-full animate-pulse rounded-xl bg-neutral-200" />
            )}
          </div>
          <div className="text-center">
            <p className="truncate text-base font-semibold text-white">{billName}</p>
            <p className="mt-0.5 text-sm text-white/50">
              Or enter code <span className="font-mono font-semibold text-white">{shortCode}</span>
            </p>
          </div>
        </div>

        <Button size="lg" className="w-full" onClick={handleSendImage} disabled={isSharing || !svg}>
          {typeof navigator !== 'undefined' && 'share' in navigator ? (
            <Share2 className="mr-2 size-4" />
          ) : (
            <Download className="mr-2 size-4" />
          )}
          Send as image
        </Button>
      </DialogContent>
    </Dialog>
  );
}
