import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { InView } from './in-view';

export function ClosingCta() {
  return (
    <section className="border-t border-white/10 py-24 lg:py-32">
      <InView className="flex flex-col items-start gap-8 md:flex-row md:items-center md:justify-between">
        <h2 className="text-3xl font-semibold tracking-tight text-white md:text-4xl">Have a receipt? Split it now.</h2>
        <Button asChild size="lg" className="px-7">
          <Link href="/create">Split a Bill</Link>
        </Button>
      </InView>
    </section>
  );
}
