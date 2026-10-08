import { AvatarInitials } from '@/components/avatar-initials';
import { formatCurrency } from '@/lib/calculations';
import { InView } from './in-view';

const BALANCES = [
  { name: 'Marcus', amount: 42.6 },
  { name: 'Tomás', amount: -18.25 },
];

export function GroupsStatement() {
  return (
    <section className="border-t border-white/10 py-24 lg:py-32">
      <InView>
        <h2 className="max-w-4xl text-4xl font-semibold leading-[1.05] tracking-tight text-balance text-white md:text-5xl lg:text-6xl">
          Roommates, trips, the Thursday crew.
        </h2>
      </InView>

      <div className="mt-12 grid gap-10 lg:mt-16 lg:grid-cols-12 lg:gap-10">
        <InView className="lg:col-span-4">
          <p className="max-w-sm text-base leading-relaxed text-white/50">
            Keep recurring bills in a group. Splittr nets out who owes whom across all of them, so you settle up once.
          </p>
        </InView>

        <InView delay={0.05} className="lg:col-span-6 lg:col-start-7">
          <div
            className="surface overflow-hidden rounded-2xl"
            role="img"
            aria-label="Example group balances: you owe Marcus $42.60, Tomás owes you $18.25"
          >
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <p className="text-sm font-medium text-white">Lake house trip</p>
              <p className="text-xs text-white/40">6 bills</p>
            </div>
            <div className="divide-y divide-white/[0.06]">
              {BALANCES.map(({ name, amount }) => {
                const iOwe = amount > 0;
                return (
                  <div key={name} className="flex items-center gap-3 px-4 py-4">
                    <AvatarInitials name={name} size="md" className="shrink-0 shadow-none" />
                    <p className="min-w-0 flex-1 truncate font-medium text-white">
                      {iOwe ? `You owe ${name}` : `${name} owes you`}
                    </p>
                    <span
                      className={`font-money shrink-0 whitespace-nowrap text-lg ${iOwe ? 'text-foreground' : 'text-primary'}`}
                    >
                      {formatCurrency(Math.abs(amount))}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </InView>
      </div>
    </section>
  );
}
