import { AvatarInitials } from '@/components/avatar-initials';

export interface MemberListItem {
  id: string;
  name: string;
  isYou: boolean;
  isOwner: boolean;
  hasPaymentHandles: boolean;
}

export function MemberList({ members }: { members: MemberListItem[] }) {
  return (
    <ul className="divide-y divide-white/[0.06]">
      {members.map((member) => (
        <li key={member.id} className="flex items-center gap-3 py-3">
          <AvatarInitials name={member.name} size="md" className="shrink-0 shadow-none" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-white">
              {member.name}
              {member.isYou && <span className="ml-1.5 text-white/40">you</span>}
            </p>
            {!member.hasPaymentHandles && <p className="text-xs text-white/35">No payment handles</p>}
          </div>
          {member.isOwner && (
            <span className="shrink-0 text-[11px] font-medium uppercase tracking-wider text-white/40">Owner</span>
          )}
        </li>
      ))}
    </ul>
  );
}
