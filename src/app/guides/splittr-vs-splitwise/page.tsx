import type { Metadata } from 'next';
import { JsonLdScript } from '@/components/guides/json-ld-script';
import { articleSchema } from '@/components/guides/guides';
import { GuideCta, GuideHeader, GuideSection, MoreGuides } from '@/components/guides/guide-parts';

const SLUG = 'splittr-vs-splitwise';
const TITLE = 'Splittr vs Splitwise';
const DESCRIPTION =
  'Splittr splits one restaurant bill by item with guests who install nothing. Splitwise tracks ongoing shared expenses. How they differ.';

export const metadata: Metadata = {
  title: { absolute: 'Splittr vs Splitwise: Which One to Use' },
  description: DESCRIPTION,
  alternates: { canonical: `/guides/${SLUG}` },
  openGraph: {
    type: 'article',
    url: `/guides/${SLUG}`,
    title: { absolute: 'Splittr vs Splitwise: Which One to Use' },
    description: DESCRIPTION,
  },
};

const ROWS: { label: string; splittr: string; splitwise: string }[] = [
  {
    label: 'Install needed',
    splittr: 'No. Works in the phone browser',
    splitwise: 'Built around its mobile app',
  },
  {
    label: 'Accounts for guests',
    splittr: 'No. Guests enter a name',
    splitwise: 'Yes. Each person has an account',
  },
  { label: 'Receipt scan', splittr: 'Yes', splitwise: 'Pro tier' },
  {
    label: 'Split by item',
    splittr: 'Yes. Each guest taps their own items',
    splitwise: 'Pro itemization, or enter amounts by hand',
  },
  {
    label: 'Tax and tip by item',
    splittr: 'Yes. In proportion to each subtotal',
    splitwise: 'Part of Pro itemization',
  },
  {
    label: 'Ongoing balances',
    splittr: 'Groups net out bills split in Splittr',
    splitwise: 'Yes. Its core feature, for any expense',
  },
  { label: 'Price', splittr: 'Free', splitwise: 'Free, with a paid Pro tier for some features' },
];

export default function Page() {
  return (
    <article>
      <JsonLdScript data={articleSchema(SLUG, TITLE, DESCRIPTION)} />

      <GuideHeader
        title={TITLE}
        lede="Use Splittr to split one restaurant bill by item, with guests who install nothing and sign up for nothing. Use Splitwise to track shared expenses that keep going, like rent with roommates or a long trip. They solve different problems, and some people use both."
      />

      <GuideSection title="What each one is for">
        <p>
          <strong className="font-semibold text-white">Splitwise</strong> is an expense tracking app for ongoing
          shared costs. You create groups, log expenses as they happen, and it keeps a running balance of who owes
          whom. Everyone in a group has a Splitwise account, usually on the mobile app. Receipt scanning and
          itemized splitting are part of its paid Pro tier.
        </p>
        <p>
          <strong className="font-semibold text-white">Splittr</strong> is built for the moment the check arrives.
          The host scans the receipt and shares a link or a 6-character code. Everyone opens it in their browser,
          taps what they ordered, and sees their share with tax and tip split in proportion. Guests do not install
          anything or create an account.
        </p>
      </GuideSection>

      <GuideSection title="Side by side">
        <div className="surface -mx-1 overflow-x-auto rounded-2xl">
          <table className="w-full min-w-[30rem] text-left text-[15px]">
            <thead className="text-xs text-white/45">
              <tr className="border-b border-white/10">
                <th scope="col" className="px-4 py-3 font-medium">
                  <span className="sr-only">Feature</span>
                </th>
                <th scope="col" className="px-4 py-3 font-medium">Splittr</th>
                <th scope="col" className="px-4 py-3 font-medium">Splitwise</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06] align-top">
              {ROWS.map((row) => (
                <tr key={row.label}>
                  <th scope="row" className="px-4 py-3 font-medium text-white">{row.label}</th>
                  <td className="px-4 py-3">{row.splittr}</td>
                  <td className="px-4 py-3">{row.splitwise}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GuideSection>

      <GuideSection title="Which one to use">
        <p>
          For a single dinner where people ordered different things, Splittr is the shorter path. Nobody at the table
          needs to download anything, and the split by item, including tax and tip, is free.
        </p>
        <p>
          For a household or a trip where expenses pile up over weeks and you want one running balance, Splitwise is
          the right tool. That is what it was designed for.
        </p>
        <p>
          The two work together. Split the dinner in Splittr to get each person’s exact share, then log those amounts
          in Splitwise if your group already tracks its balances there.
        </p>
      </GuideSection>

      <GuideCta>Splitting a restaurant bill right now? Start one in Splittr.</GuideCta>

      <MoreGuides current={SLUG} />
    </article>
  );
}
