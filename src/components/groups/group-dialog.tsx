'use client';

import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/** The one dialog surface every groups dialog shares. */
export const DIALOG_SURFACE =
  'sm:max-w-md gap-5 rounded-2xl border-white/10 bg-[#0a0a0a] p-6 text-white shadow-2xl';

interface GroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
}

export function GroupDialog({ open, onOpenChange, title, description, children }: GroupDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={DIALOG_SURFACE}>
        <DialogHeader className="gap-1.5 text-left">
          <DialogTitle className="text-lg font-semibold tracking-tight text-white">{title}</DialogTitle>
          {description && (
            <DialogDescription className="text-sm leading-relaxed text-white/50">
              {description}
            </DialogDescription>
          )}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

interface ConfirmDialogProps extends Omit<GroupDialogProps, 'children'> {
  confirmLabel: string;
  onConfirm: () => void;
  isPending: boolean;
}

/** Destructive confirmation: title, one line, cancel (ghost) and action (destructive). */
export function ConfirmDialog({
  confirmLabel,
  onConfirm,
  isPending,
  onOpenChange,
  ...rest
}: ConfirmDialogProps) {
  return (
    <GroupDialog onOpenChange={onOpenChange} {...rest}>
      <div className="flex justify-end gap-2 pt-1">
        <Button
          variant="ghost"
          className="text-white/60 hover:text-white"
          onClick={() => onOpenChange(false)}
          disabled={isPending}
        >
          Cancel
        </Button>
        <Button variant="destructive" onClick={onConfirm} disabled={isPending}>
          {isPending && <Loader2 className="animate-spin" />}
          {confirmLabel}
        </Button>
      </div>
    </GroupDialog>
  );
}
