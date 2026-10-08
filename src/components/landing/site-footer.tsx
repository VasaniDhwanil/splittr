import Link from 'next/link';
import { Wordmark } from './wordmark';

const LINKS = [
  { href: '/signin', label: 'Sign in' },
  { href: '/create', label: 'Split a Bill' },
  { href: '/join', label: 'Join a Bill' },
];

export function SiteFooter({ signedIn }: { signedIn: boolean }) {
  const links = signedIn ? LINKS.filter((link) => link.href !== '/signin') : LINKS;
  return (
    <footer className="border-t border-white/10 py-10">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <Wordmark />
        <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/45">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className="whitespace-nowrap transition-colors hover:text-white">
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
