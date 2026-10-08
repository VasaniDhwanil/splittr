import type { ReactNode } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { GUIDES } from './guides';

export function GuideHeader({ title, lede }: { title: string; lede: ReactNode }) {
  return (
    <header className="pt-10 pb-2 sm:pt-14">
      <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">{title}</h1>
      <p className="mt-5 max-w-[65ch] text-[17px] leading-relaxed text-white/70">{lede}</p>
    </header>
  );
}

/** A hairline-topped section with an H2. */
export function GuideSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-10 border-t border-white/10 pt-8">
      <h2 className="text-xl font-semibold tracking-tight text-white">{title}</h2>
      <div className="mt-4 max-w-[65ch] space-y-4 text-[17px] leading-relaxed text-white/70">{children}</div>
    </section>
  );
}

export function Steps({ children }: { children: ReactNode }) {
  return <ol className="list-decimal space-y-2 pl-6 marker:text-white/40">{children}</ol>;
}

export function Bullets({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-2 pl-6 marker:text-white/30">{children}</ul>;
}

export function Strong({ children }: { children: ReactNode }) {
  return <strong className="font-semibold text-white">{children}</strong>;
}

/** The single primary call to action on a guide page. */
export function GuideCta({ children }: { children: ReactNode }) {
  return (
    <div className="mt-10 flex flex-col items-start gap-4 border-t border-white/10 pt-8 sm:flex-row sm:items-center sm:justify-between">
      <p className="max-w-[45ch] text-[17px] leading-relaxed text-white/70">{children}</p>
      <Button asChild size="lg" className="shrink-0 px-7">
        <Link href="/create">Split a Bill</Link>
      </Button>
    </div>
  );
}

/** Quiet text links to the other guides. */
export function MoreGuides({ current }: { current: string }) {
  const others = GUIDES.filter((guide) => guide.slug !== current);
  return (
    <nav aria-label="More guides" className="mt-12 border-t border-white/10 pt-6 pb-16 text-sm text-white/45">
      <span>More guides: </span>
      {others.map((guide, i) => (
        <span key={guide.slug}>
          {i > 0 && <span aria-hidden="true"> · </span>}
          <Link
            href={`/guides/${guide.slug}`}
            className="underline decoration-white/20 underline-offset-4 transition-colors hover:text-white"
          >
            {guide.title}
          </Link>
        </span>
      ))}
      <span aria-hidden="true"> · </span>
      <Link href="/guides" className="underline decoration-white/20 underline-offset-4 transition-colors hover:text-white">
        All guides
      </Link>
    </nav>
  );
}
