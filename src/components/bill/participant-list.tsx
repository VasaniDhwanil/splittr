'use client';

import { Check, X } from 'lucide-react';
import { AvatarInitials } from '@/components/avatar-initials';

export interface ParticipantListItem {
  id: string;
  name: string;
  isYou: boolean;
  isHost: boolean;
  isPaid: boolean;
  /** Shown only to the host, never on the host's own row. */
  canRemove: boolean;
}

interface ParticipantListProps {
  people: ParticipantListItem[];
  onRemove: (id: string) => void;
}

/** Avatar rows: name, quiet captions, a paid check, and the host's remove action. */
export function ParticipantList({ people, onRemove }: ParticipantListProps) {
  return (
    <ul className="divide-y divide-white/[0.06]">
      {people.map((p) => (
        <li key={p.id} className="group flex min-h-14 items-center gap-3 py-2">
          <AvatarInitials name={p.name} size="md" className="shrink-0 shadow-none" />
          <p className="flex min-w-0 flex-1 items-baseline gap-1.5 text-sm text-white">
            <span className="truncate">{p.name}</span>
            {p.isYou && <span className="shrink-0 text-white/40">you</span>}
            {p.isHost && <span className="shrink-0 text-white/40">host</span>}
          </p>
          {p.isPaid && (
            <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary">
              <Check className="size-3.5" strokeWidth={2.5} />
              Paid
            </span>
          )}
          {p.canRemove && (
            <button
              type="button"
              title={`Remove ${p.name}`}
              aria-label={`Remove ${p.name}`}
              onClick={() => onRemove(p.id)}
              className="-mr-2 flex size-11 shrink-0 items-center justify-center rounded-full text-white/40 outline-none transition-[color,background-color,opacity] hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100"
            >
              <X className="size-4" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
