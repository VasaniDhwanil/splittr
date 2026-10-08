import { AvatarInitials } from '@/components/avatar-initials';
import { formatCurrency } from '@/lib/calculations';

export interface Standing {
  name: string;
  user_id: string | null;
  /** Positive: owes the group. Negative: gets money back. */
  net: number;
}

export function StandingsList({ standings }: { standings: Standing[] }) {
  return (
    <ul className="divide-y divide-white/[0.06]">
      {standings.map((person) => (
        <li key={person.user_id ?? person.name} className="flex items-center gap-3 py-3">
          <AvatarInitials name={person.name} size="sm" className="shrink-0 shadow-none" />
          <span className="min-w-0 flex-1 truncate text-sm text-white">{person.name}</span>
          <span className="shrink-0 whitespace-nowrap text-sm">
            <span className="text-white/40">{person.net < 0 ? 'gets back' : 'owes'}</span>{' '}
            <span className="font-money text-white">{formatCurrency(Math.abs(person.net))}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
