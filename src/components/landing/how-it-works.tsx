import { InView } from './in-view';

const STEPS = [
  {
    title: 'Scan the receipt',
    body: 'Take a photo and Splittr reads every item and price, along with the tax and tip.',
  },
  {
    title: 'Share the link',
    body: 'Send the link or the short code to the group chat. Nobody needs an account or an app.',
  },
  {
    title: 'Everyone taps their items',
    body: 'Everyone taps what they ordered. Shared plates are split between the people who claim them.',
  },
  {
    title: 'Tax and tip split fairly',
    body: 'Tax and tip are divided by what each person ordered, so everyone sees exactly what they owe.',
  },
];

export function HowItWorks() {
  return (
    <section className="border-t border-white/10 py-24 lg:py-32">
      <div className="grid gap-12 lg:grid-cols-12 lg:gap-10">
        <div className="lg:col-span-5">
          <InView className="lg:sticky lg:top-24">
            <h2 className="text-3xl font-semibold tracking-tight text-white md:text-4xl">How it works</h2>
            <p className="mt-4 max-w-sm text-base leading-relaxed text-white/50">
              From a photo of the receipt to everyone&apos;s total.
            </p>
          </InView>
        </div>

        <ol className="relative lg:col-span-7">
          <span aria-hidden className="absolute top-2 bottom-2 left-[5px] w-px bg-white/10" />
          {STEPS.map((step, i) => (
            <li key={step.title} className="relative pl-10 pb-14 last:pb-0">
              <span
                aria-hidden
                className="absolute top-[11px] left-0 size-[11px] rounded-full border border-white/20 bg-background"
              />
              <InView delay={i * 0.05}>
                <h3 className="text-xl font-semibold tracking-tight text-white md:text-2xl">{step.title}</h3>
                <p className="mt-2 max-w-md text-base leading-relaxed text-white/50">{step.body}</p>
              </InView>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
