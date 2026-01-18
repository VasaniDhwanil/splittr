'use client';

import { cn } from '@/lib/utils';

interface AvatarInitialsProps {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

// Generate a consistent color based on name
function getAvatarColor(name: string): string {
  const colors = [
    'bg-teal-500 text-white',
    'bg-emerald-500 text-white',
    'bg-cyan-500 text-white',
    'bg-sky-500 text-white',
    'bg-violet-500 text-white',
    'bg-fuchsia-500 text-white',
    'bg-rose-500 text-white',
    'bg-orange-500 text-white',
    'bg-amber-500 text-white',
    'bg-lime-500 text-white',
  ];

  // Simple hash based on name
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }

  return colors[Math.abs(hash) % colors.length];
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].charAt(0).toUpperCase();
  }
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

const sizeClasses = {
  sm: 'w-6 h-6 text-[10px]',
  md: 'w-8 h-8 text-xs',
  lg: 'w-10 h-10 text-sm',
};

export function AvatarInitials({ name, size = 'md', className }: AvatarInitialsProps) {
  const initials = getInitials(name);
  const colorClass = getAvatarColor(name);

  return (
    <div
      className={cn(
        'rounded-full flex items-center justify-center font-semibold shadow-sm transition-smooth',
        sizeClasses[size],
        colorClass,
        className
      )}
      title={name}
    >
      {initials}
    </div>
  );
}

// Stack multiple avatars with overlap
interface AvatarStackProps {
  names: string[];
  max?: number;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function AvatarStack({ names, max = 3, size = 'sm', className }: AvatarStackProps) {
  const displayed = names.slice(0, max);
  const remaining = names.length - max;

  return (
    <div className={cn('flex -space-x-2', className)}>
      {displayed.map((name, index) => (
        <AvatarInitials
          key={`${name}-${index}`}
          name={name}
          size={size}
          className="ring-2 ring-background"
        />
      ))}
      {remaining > 0 && (
        <div
          className={cn(
            'rounded-full flex items-center justify-center font-semibold bg-muted text-muted-foreground ring-2 ring-background',
            sizeClasses[size]
          )}
        >
          +{remaining}
        </div>
      )}
    </div>
  );
}
