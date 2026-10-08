import { ArrowUpRight } from 'lucide-react';
import { AvatarInitials } from '@/components/avatar-initials';
import { formatCurrency } from '@/lib/calculations';
import { InView } from './in-view';

const PAY_APPS = ['Venmo', 'Cash App', 'PayPal'];

/** Static settle-up row in the balance row's style. Not interactive. */
function SettlePreview() {
  return (
    <div
      className="rounded-2xl border border-white/10 bg-background/60 px-4 py-4"
      role="img"
      aria-label="Example: you owe Priya $16.11, with Venmo, Cash App and PayPal buttons"
    >
      <div className="flex items-center gap-3">
        <AvatarInitials name="Priya" size="md" className="shrink-0 shadow-none" />
        <p className="min-w-0 flex-1 truncate font-medium text-white">You owe Priya</p>
        <span className="font-money shrink-0 text-lg text-foreground">{formatCurrency(16.11)}</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 sm:pl-11">
        {PAY_APPS.map((label) => (
          <span
            key={label}
            className="inline-flex h-9 items-center gap-1 rounded-full border border-white/10 px-3.5 text-xs font-medium whitespace-nowrap text-white/70"
          >
            {label}
            <ArrowUpRight className="size-3 text-white/35" strokeWidth={2} />
          </span>
        ))}
      </div>
    </div>
  );
}

const cell = 'rounded-2xl border border-white/10 p-6 sm:p-8';

export function WhySplittr() {
  return (
    <section className="border-t border-white/10 py-24 lg:py-32">
      <InView>
        <h2 className="max-w-xl text-3xl font-semibold tracking-tight text-white md:text-4xl">Why Splittr</h2>
      </InView>

      <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-3">
        <InView className={`${cell} bg-white/[0.03] md:col-span-2`}>
          <div className="grid gap-8 lg:grid-cols-2 lg:items-center">
            <div>
              <h3 className="text-xl font-semibold tracking-tight text-white">Settle up fast</h3>
              <p className="mt-2 text-base leading-relaxed text-white/50">
                Every share comes with one-tap Venmo, Cash App and PayPal links, plus Zelle details.
              </p>
            </div>
            <SettlePreview />
          </div>
        </InView>

        <InView delay={0.05} className={`${cell} bg-primary/10`}>
          <h3 className="text-xl font-semibold tracking-tight text-white">No app to download</h3>
          <p className="mt-2 text-base leading-relaxed text-white/60">
            It runs in the browser. Friends open the link and start tapping.
          </p>
        </InView>

        <InView className={`${cell} bg-white/[0.03]`}>
          <h3 className="text-xl font-semibold tracking-tight text-white">Split any way</h3>
          <p className="mt-2 text-base leading-relaxed text-white/50">
            By item, evenly, or custom amounts. Tax and tip stay fair either way.
          </p>
        </InView>

        <InView delay={0.05} className={`${cell} bg-white/[0.03] md:col-span-2`}>
          <h3 className="text-xl font-semibold tracking-tight text-white">Updates in real time</h3>
          <p className="mt-2 max-w-md text-base leading-relaxed text-white/50">
            Claims and payments show up on every phone at the table the moment they happen.
          </p>
        </InView>
      </div>
    </section>
  );
}
