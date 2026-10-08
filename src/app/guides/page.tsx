import type { Metadata } from 'next';
import Link from 'next/link';
import { GUIDES } from '@/components/guides/guides';

const DESCRIPTION =
  'Plain answers on splitting restaurant bills: tax and tip in proportion, splitting by item, and how Splittr compares to Splitwise.';

export const metadata: Metadata = {
  title: 'Guides to Splitting the Bill',
  description: DESCRIPTION,
  alternates: { canonical: '/guides' },
  openGraph: { url: '/guides', title: 'Guides to Splitting the Bill', description: DESCRIPTION },
};

export default function GuidesIndex() {
  return (
    <div className="pt-10 pb-20 sm:pt-14">
      <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">Guides</h1>
      <p className="mt-5 max-w-[65ch] text-[17px] leading-relaxed text-white/70">
        Plain answers to the questions that come up when the check arrives.
      </p>
      <ul className="surface mt-10 divide-y divide-white/[0.06] overflow-hidden rounded-2xl">
        {GUIDES.map((guide) => (
          <li key={guide.slug}>
            <Link href={`/guides/${guide.slug}`} className="tactile block px-5 py-4">
              <span className="block font-medium text-white">{guide.title}</span>
              <span className="mt-1 block text-sm text-white/50">{guide.summary}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
