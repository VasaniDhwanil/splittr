import type { Metadata } from 'next';
import { JsonLdScript } from '@/components/guides/json-ld-script';
import { articleSchema } from '@/components/guides/guides';
import {
  GuideCta,
  GuideHeader,
  GuideSection,
  MoreGuides,
  Steps,
  Strong,
} from '@/components/guides/guide-parts';

const SLUG = 'how-to-split-a-restaurant-bill-with-tax-and-tip';
const TITLE = 'How to split a restaurant bill with tax and tip';
const DESCRIPTION =
  'Each person pays for what they ordered, then tax and tip are split in proportion to each subtotal. The method, a worked example, and FAQ.';

export const metadata: Metadata = {
  title: 'How to Split a Restaurant Bill With Tax and Tip',
  description: DESCRIPTION,
  alternates: { canonical: `/guides/${SLUG}` },
  openGraph: {
    type: 'article',
    url: `/guides/${SLUG}`,
    title: 'How to Split a Restaurant Bill With Tax and Tip',
    description: DESCRIPTION,
  },
};

const FAQ = [
  {
    q: 'Should the tip be on the pre-tax or post-tax amount?',
    a: 'Either is common. Traditional etiquette advice is to tip on the pre-tax subtotal, and the difference is usually small. Whichever base you choose, the tip is still shared in proportion to what each person ordered. Splittr applies its tip percentages to the subtotal plus tax; to tip on the pre-tax amount, type the exact tip instead.',
  },
  {
    q: 'What about shared appetizers?',
    a: 'Divide each shared dish by the number of people who ate it and add that piece to each of their subtotals. Then work out tax and tip as usual. People who did not touch the dish pay nothing for it.',
  },
  {
    q: 'What if someone only had a drink?',
    a: 'Their subtotal is the price of the drink, so their share of tax and tip is small too. That is the point of splitting in proportion: a $6 drink carries a $6 share of tax and tip, not a third of the whole bill.',
  },
  {
    q: 'How do discounts or coupons work?',
    a: 'If a discount applies to one item, lower that item’s price and the person who ordered it gets the saving. If it applies to the whole bill, subtract it from the subtotal and split in proportion, so everyone saves the same percentage. Tax is normally charged on the discounted price, so use the tax printed on the receipt.',
  },
];

const ROWS = [
  { name: 'Ana', subtotal: '$18.00', pct: '29.51%', tax: '$1.60', tip: '$3.92', total: '$23.52' },
  { name: 'Ben', subtotal: '$31.00', pct: '50.82%', tax: '$2.75', tip: '$6.75', total: '$40.50' },
  { name: 'Cleo', subtotal: '$12.00', pct: '19.67%', tax: '$1.06', tip: '$2.61', total: '$15.67' },
];

export default function Page() {
  return (
    <article>
      <JsonLdScript data={articleSchema(SLUG, TITLE, DESCRIPTION)} />
      <JsonLdScript
        data={{
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: FAQ.map(({ q, a }) => ({
            '@type': 'Question',
            name: q,
            acceptedAnswer: { '@type': 'Answer', text: a },
          })),
        }}
      />

      <GuideHeader
        title={TITLE}
        lede="Each person pays for what they ordered. Then tax and tip are split in proportion to each person’s subtotal, not evenly. Someone who ordered 30% of the food pays 30% of the tax and 30% of the tip."
      />

      <GuideSection title="Why an even split is unfair">
        <p>
          In the example below, three friends run up a $79.69 bill, so an even split is $26.56 each. Cleo, who had a
          $12 salad, would pay about $11 more than her fair share, and the friend who ordered the most would pay
          about $14 less.
        </p>
      </GuideSection>

      <GuideSection title="The method">
        <Steps>
          <li>Add up each person’s items. That is their subtotal.</li>
          <li>Add the subtotals together. This should match the subtotal on the receipt.</li>
          <li>Divide each person’s subtotal by the receipt subtotal to get their percentage.</li>
          <li>Multiply the tax by each percentage, and the tip by each percentage.</li>
          <li>Each person pays their subtotal plus their tax share plus their tip share.</li>
        </Steps>
        <p>
          A shortcut: divide the full total by the subtotal to get one multiplier, then multiply each person’s
          subtotal by it. You get the same result, give or take a cent of rounding.
        </p>
      </GuideSection>

      <GuideSection title="Worked example">
        <p>
          Illustrative numbers. Three people, with subtotals of $18, $31 and $12. Sales tax is 8.875% and the tip is
          20%, calculated on the subtotal plus tax, which is how Splittr’s tip percentages work.
        </p>
        <div className="surface rounded-2xl px-5 py-5 text-[15px]">
          <dl className="space-y-1.5 tabular-nums">
            <div className="flex justify-between gap-4">
              <dt>Subtotal</dt>
              <dd className="text-white">$18 + $31 + $12 = $61.00</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Tax</dt>
              <dd className="text-white">$61.00 × 8.875% = $5.41</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Tip</dt>
              <dd className="text-white">($61.00 + $5.41) × 20% = $13.28</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Total</dt>
              <dd className="font-semibold text-white">$79.69</dd>
            </div>
          </dl>

          <div className="mt-5 overflow-x-auto border-t border-white/10 pt-4">
            <table className="w-full text-left text-sm tabular-nums sm:text-[15px]">
              <thead className="text-xs text-white/45">
                <tr>
                  <th scope="col" className="pb-2 font-medium">Person</th>
                  <th scope="col" className="pb-2 text-right font-medium">Items</th>
                  <th scope="col" className="pb-2 text-right font-medium">Share</th>
                  <th scope="col" className="pb-2 text-right font-medium">Tax</th>
                  <th scope="col" className="pb-2 text-right font-medium">Tip</th>
                  <th scope="col" className="pb-2 text-right font-medium">Pays</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {ROWS.map((row) => (
                  <tr key={row.name}>
                    <th scope="row" className="py-2 font-normal text-white">{row.name}</th>
                    <td className="py-2 text-right">{row.subtotal}</td>
                    <td className="py-2 text-right">{row.pct}</td>
                    <td className="py-2 text-right">{row.tax}</td>
                    <td className="py-2 text-right">{row.tip}</td>
                    <td className="py-2 text-right font-semibold text-white">{row.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-4 border-t border-white/10 pt-4 text-sm leading-relaxed text-white/55">
            Ana: $18 ÷ $61 = 29.51%. Tax $5.41 × 29.51% = $1.60. Tip $13.28 × 29.51% = $3.92. She pays $18.00 + $1.60
            + $3.92 = $23.52. The three shares add up to $79.69, the full bill. With rounding to the cent, shares can
            occasionally land a cent off the total; the person who paid usually absorbs it.
          </p>
        </div>
        <p>Compared with the even split of $26.56 each, Cleo saves $10.89 and Ben pays $13.94 more.</p>
      </GuideSection>

      <GuideCta>
        Splittr does this math for you. Scan the receipt, share a link, and everyone taps what they ordered.
      </GuideCta>

      <GuideSection title="Questions">
        <dl className="space-y-6">
          {FAQ.map(({ q, a }) => (
            <div key={q}>
              <dt>
                <Strong>{q}</Strong>
              </dt>
              <dd className="mt-1.5">{a}</dd>
            </div>
          ))}
        </dl>
      </GuideSection>

      <MoreGuides current={SLUG} />
    </article>
  );
}
