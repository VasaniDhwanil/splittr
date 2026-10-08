'use client';

import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { GroupDialog } from '@/components/groups/group-dialog';
import { Field, FIELD_INPUT } from '@/components/create/field';

interface JoinDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  onNameChange: (name: string) => void;
  /** Someone with the same name is already on the bill. */
  duplicateName: string | null;
  isJoining: boolean;
  onJoin: () => void;
  onAdoptDuplicate: () => void;
  onJoinAsNew: () => void;
}

export function JoinDialog({
  open,
  onOpenChange,
  name,
  onNameChange,
  duplicateName,
  isJoining,
  onJoin,
  onAdoptDuplicate,
  onJoinAsNew,
}: JoinDialogProps) {
  return (
    <GroupDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Join this bill"
      description="Enter your name to start picking what you had."
    >
      <div className="space-y-5">
        <Field htmlFor="joinName" label="What's your name?">
          <Input
            id="joinName"
            placeholder="e.g. Alex"
            autoComplete="given-name"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onJoin()}
            className={`${FIELD_INPUT} h-11 text-base`}
          />
        </Field>
        {duplicateName ? (
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-white/50">
              Someone named <span className="font-medium text-white">{duplicateName}</span> is already on this bill.
              Maybe that&apos;s you, on another device?
            </p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="ghost"
                className="max-w-full text-white/60 hover:bg-white/[0.06] hover:text-white"
                onClick={onJoinAsNew}
                disabled={isJoining}
              >
                {isJoining && <Loader2 className="animate-spin" />}
                <span className="truncate">No, I&apos;m a different {duplicateName}</span>
              </Button>
              <Button onClick={onAdoptDuplicate}>Yes, that&apos;s me</Button>
            </div>
          </div>
        ) : (
          <Button onClick={onJoin} className="w-full" size="lg" disabled={isJoining}>
            {isJoining && <Loader2 className="animate-spin" />}
            {isJoining ? 'Joining...' : "Let's go!"}
          </Button>
        )}
      </div>
    </GroupDialog>
  );
}
