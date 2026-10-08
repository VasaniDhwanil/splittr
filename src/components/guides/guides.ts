export const SITE_URL = 'https://www.splittr.cash';
export const GUIDES_PUBLISHED = '2026-10-08';

export interface GuideLink {
  slug: string;
  title: string;
  summary: string;
}

export const GUIDES: GuideLink[] = [
  {
    slug: 'how-to-split-a-restaurant-bill-with-tax-and-tip',
    title: 'How to split a restaurant bill with tax and tip',
    summary: 'Pay for what you ordered, then share tax and tip in proportion.',
  },
  {
    slug: 'split-a-bill-by-item',
    title: 'Split a bill by item without an app',
    summary: 'The by-hand method, shared dishes, and the mistakes to avoid.',
  },
  {
    slug: 'splittr-vs-splitwise',
    title: 'Splittr vs Splitwise',
    summary: 'One dinner split by item, or ongoing shared expenses.',
  },
];

export function guideUrl(slug: string) {
  return `${SITE_URL}/guides/${slug}`;
}

/** Article schema for a guide page. */
export function articleSchema(slug: string, headline: string, description: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline,
    description,
    datePublished: GUIDES_PUBLISHED,
    dateModified: GUIDES_PUBLISHED,
    mainEntityOfPage: guideUrl(slug),
    image: `${SITE_URL}/opengraph-image`,
    author: { '@type': 'Organization', name: 'Splittr', url: SITE_URL },
    publisher: { '@type': 'Organization', name: 'Splittr', url: SITE_URL },
  };
}
