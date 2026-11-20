'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

interface CopyButtonProps {
  value: string;
  label?: string;
  /** Spoken name, e.g. "Copy token". */
  ariaLabel?: string;
  className?: string;
}

/** Ghost pill that copies `value`. Never logs it. */
export function CopyButton({ value, label = 'Copy', ariaLabel, className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error('Could not copy. Select the text and copy it by hand.');
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={copy}
      aria-label={ariaLabel ?? label}
      className={`border border-white/10 text-white/70 hover:bg-white/[0.06] hover:text-white ${className ?? ''}`}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? 'Copied' : label}
    </Button>
  );
}
