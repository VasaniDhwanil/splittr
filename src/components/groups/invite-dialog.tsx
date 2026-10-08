'use client';

import type { FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LIT_FIELD } from '@/components/create/field';
import { GroupDialog } from './group-dialog';

interface InviteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupName: string;
  /** Null when the group has no invite code. */
  inviteUrl: string | null;
  onCopy: () => void;
  email: string;
  onEmailChange: (value: string) => void;
  onSubmitEmail: (e: FormEvent) => void;
  isSending: boolean;
}

export function InviteDialog({
  open,
  onOpenChange,
  groupName,
  inviteUrl,
  onCopy,
  email,
  onEmailChange,
  onSubmitEmail,
  isSending,
}: InviteDialogProps) {
  return (
    <GroupDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Invite to ${groupName}`}
      description="Anyone with the link can join after signing in."
    >
      <div className="space-y-6">
        {inviteUrl && (
          <div className="flex items-center gap-2">
            <div className="flex h-11 min-w-0 flex-1 items-center rounded-xl border border-white/10 bg-white/[0.04] px-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
              <span className="truncate text-sm text-white/60">{inviteUrl.replace(/^https?:\/\//, '')}</span>
            </div>
            <Button variant="secondary" className="shrink-0" onClick={onCopy}>
              Copy
            </Button>
          </div>
        )}

        <form onSubmit={onSubmitEmail} className="space-y-2">
          <Label htmlFor="inviteEmail" className="text-sm font-medium text-white/70">
            Or send by email
          </Label>
          <div className="flex gap-2">
            <Input
              id="inviteEmail"
              type="text"
              inputMode="email"
              autoComplete="off"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => onEmailChange(e.target.value)}
              className={LIT_FIELD}
            />
            <Button type="submit" className="shrink-0" disabled={isSending || !email.trim()}>
              {isSending ? <Loader2 className="animate-spin" /> : 'Send'}
            </Button>
          </div>
          <p className="text-xs text-white/35">Separate several addresses with commas.</p>
        </form>
      </div>
    </GroupDialog>
  );
}
