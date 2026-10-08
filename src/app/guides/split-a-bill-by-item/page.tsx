import type { Metadata } from 'next';
import { JsonLdScript } from '@/components/guides/json-ld-script';
import { articleSchema } from '@/components/guides/guides';
import {
  Bullets,
  GuideCta,
  GuideHeader,
  GuideSection,
  MoreGuides,
  Steps,
  Strong,
} from '@/components/guides/guide-parts';

const SLUG = 'split-a-bill-by-item';
const TITLE = 'Split a bill by item without an app';
const DESCRIPTION =
  'Split a restaurant bill by what each person ordered: assign items, divide shared dishes, then share tax and tip in proportion. Step by step.';

export const metadata: Metadata = {
  title: 'Split a Bill by Item Without an App',
  description: DESCRIPTION,
  alternates: { canonical: `/guides/${SLUG}` },
  openGraph: {
    type: 'article',
    url: `/guides/${SLUG}`,
    title: 'Split a Bill by Item Without an App',
    description: DESCRIPTION,
  },
};

const HAND_STEPS = [
  {
    name: 'Get the itemized receipt',
    text: 'Ask for the itemized receipt, not just the card slip, so every dish and drink has a price next to it.',
  },
  {
    name: 'Assign each item',
    text: 'Write each person’s name next to the items they ordered.',
  },
  {
    name: 'Divide shared items',
    text: 'For anything shared, divide its price by the number of people who shared it and give each of them that amount.',
  },
  {
    name: 'Total each person',
    text: 'Add up each person’s items and shared portions. The totals should add up to the receipt subtotal.',
  },
  {
    name: 'Add tax and tip in proportion',
    text: 'Divide each person’s subtotal by the receipt subtotal, then multiply the tax and the tip by that percentage. Each person pays their subtotal plus those two shares.',
  },
];

export default function Page() {
  return (
    <article>
      <JsonLdScript data={articleSchema(SLUG, TITLE, DESCRIPTION)} />
      <JsonLdScript
        data={{
          '@context': 'https://schema.org',
          '@type': 'HowTo',
          name: 'How to split a restaurant bill by item',
          description: DESCRIPTION,
          step: HAND_STEPS.map((step, i) => ({
            '@type': 'HowToStep',
            position: i + 1,
            name: step.name,
            text: step.text,
          })),
        }}
      />

      <GuideHeader
        title={TITLE}
        lede="To split a bill by item, give each person the items they ordered, divide shared dishes among the people who shared them, and then split tax and tip in proportion to each person’s subtotal. All you need is the itemized receipt and a calculator."
      />

      <GuideSection title="The method by hand">
        <Steps>
          {HAND_STEPS.map((step) => (
            <li key={step.name}>
              <Strong>{step.name}.</Strong> {step.text}
            </li>
          ))}
        </Steps>
        <p>
          Example of a shared item: a $15 plate of nachos shared by three people adds $5 to each of their subtotals.
          The fourth person at the table, who had none, adds nothing.
        </p>
      </GuideSection>

      <GuideSection title="Common mistakes">
        <Bullets>
          <li>
            <Strong>Splitting tax and tip evenly.</Strong> Once items are assigned, an even tax and tip puts back the
            unfairness you just removed. Someone with a small order ends up paying for part of a larger one.
          </li>
          <li>
            <Strong>Forgetting shared items.</Strong> If the totals do not add up to the receipt subtotal, a shared dish
            or a round of drinks usually went unassigned.
          </li>
          <li>
            <Strong>Dividing shared items by the whole table.</Strong> Divide by the people who actually shared it.
          </li>
          <li>
            <Strong>Missing items with a quantity.</Strong> A line such as “3 × IPA” is three drinks. Make sure each
            one is counted once.
          </li>
          <li>
            <Strong>Using the card slip.</Strong> The card total often includes the tip already. Work from the
            itemized receipt, then add the tip you actually left.
          </li>
        </Bullets>
      </GuideSection>

      <GuideSection title="With Splittr">
        <p>
          Splittr does the same math from a photo and a link. Guests open the link in their phone’s browser. There is
          nothing to install, and guests do not need an account.
        </p>
        <Steps>
          <li>
            <Strong>Scan or enter the items.</Strong> Take a photo of the receipt and Splittr reads the items, or type
            them in.
          </li>
          <li>
            <Strong>Share the link or the 6-character code.</Strong> Send it in your group chat, or read the code out
            at the table.
          </li>
          <li>
            <Strong>Everyone taps their items.</Strong> Shared dishes are divided among everyone who taps them. The
            host sees each person’s total with tax and tip included, and guests can pay through Venmo,
            Cash App or PayPal links, or copy the host’s Zelle details.
          </li>
        </Steps>
      </GuideSection>

      <GuideCta>Have the receipt in front of you? Scan it and send the link.</GuideCta>

      <MoreGuides current={SLUG} />
    </article>
  );
}
