'use client';

import { cn } from '@/lib/utils';

interface AvatarInitialsProps {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

// Sticker-bright palette — every person gets a vivid chip color.
// Class and hex entries are index-aligned so avatars, item tints, and
// amounts all agree on a person's color.
const PERSON_CLASSES = [
  'bg-green-400 text-green-950',
  'bg-orange-400 text-orange-950',
  'bg-pink-500 text-white',
  'bg-purple-500 text-white',
  'bg-yellow-400 text-yellow-950',
  'bg-sky-400 text-sky-950',
  'bg-lime-400 text-lime-950',
  'bg-rose-500 text-white',
  'bg-fuchsia-500 text-white',
  'bg-amber-400 text-amber-950',
];

const PERSON_HEXES = [
  '#4ade80', // green
  '#fb923c', // orange
  '#ec4899', // pink
  '#a855f7', // purple
  '#facc15', // yellow
  '#38bdf8', // sky
  '#a3e635', // lime
  '#f43f5e', // rose
  '#d946ef', // fuchsia
  '#fbbf24', // amber
];

function nameHash(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
}

function getAvatarColor(name: string): string {
  return PERSON_CLASSES[nameHash(name) % PERSON_CLASSES.length];
}

// The person's color as a hex value, for tinting items and amounts
export function getPersonHex(name: string): string {
  return PERSON_HEXES[nameHash(name) % PERSON_HEXES.length];
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
