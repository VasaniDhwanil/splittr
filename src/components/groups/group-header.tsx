'use client';

import { LogOut, Pencil, Trash2, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface GroupHeaderProps {
  name: string;
  /** Short facts joined by middle dots, e.g. ["4 members", "12 bills"]. */
  meta: string[];
  isOwner: boolean;
  onInvite: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onLeave: () => void;
}

const ICON_ACTION = 'text-white/40 hover:text-white hover:bg-white/[0.06] transition-colors';

export function GroupHeader({ name, meta, isOwner, onInvite, onEdit, onDelete, onLeave }: GroupHeaderProps) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="truncate text-3xl font-semibold tracking-tight text-white sm:text-4xl">{name}</h1>
        <p className="mt-2 text-sm tabular-nums text-white/40">{meta.join(' · ')}</p>
      </div>

      <div className="flex shrink-0 items-center gap-1 self-end sm:self-auto">
        <Button variant="ghost" size="sm" className="text-white/70 hover:text-white hover:bg-white/[0.06]" onClick={onInvite}>
          <UserPlus />
          Invite
        </Button>
        {isOwner ? (
          <>
            <Button variant="ghost" size="icon" className={ICON_ACTION} title="Rename group" aria-label="Rename group" onClick={onEdit}>
              <Pencil />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-white/40 hover:text-destructive hover:bg-destructive/10 transition-colors"
              title="Delete group"
              aria-label="Delete group"
              onClick={onDelete}
            >
              <Trash2 />
            </Button>
          </>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className="text-white/40 hover:text-destructive hover:bg-destructive/10 transition-colors"
            title="Leave group"
            aria-label="Leave group"
            onClick={onLeave}
          >
            <LogOut />
          </Button>
        )}
      </div>
    </header>
  );
}
