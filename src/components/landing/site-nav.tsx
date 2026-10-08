import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Wordmark } from './wordmark';

interface SiteNavProps {
  /** undefined while auth is still loading: the right side stays empty. */
  user: { email: string } | null | undefined;
  onSignOut: () => void;
}

export function SiteNav({ user, onSignOut }: SiteNavProps) {
  return (
    <header className="flex h-16 items-center justify-between gap-4">
      <Wordmark />
      {user ? (
        <div className="flex min-w-0 items-center gap-1 surface rounded-full py-1 pr-1 pl-4">
          <Link
            href="/profile"
            className="min-w-0 truncate text-sm text-white/60 transition-colors hover:text-white"
          >
            {user.email}
          </Link>
          <Button
            variant="ghost"
            size="sm"
            onClick={onSignOut}
            className="h-8 shrink-0 px-3 text-white/60 hover:bg-white/[0.06] hover:text-white"
          >
            Sign out
          </Button>
        </div>
      ) : user === null ? (
        <Button asChild variant="ghost" size="sm" className="text-white/70 hover:bg-white/[0.06] hover:text-white">
          <Link href="/signin">Sign in</Link>
        </Button>
      ) : null}
    </header>
  );
}
