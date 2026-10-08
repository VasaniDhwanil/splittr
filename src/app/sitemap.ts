import type { MetadataRoute } from "next";

const SITE_URL = "https://www.splittr.cash";

const GUIDE_SLUGS = [
  "how-to-split-a-restaurant-bill-with-tax-and-tip",
  "split-a-bill-by-item",
  "splittr-vs-splitwise",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [
    { url: `${SITE_URL}/`, lastModified, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/create`, lastModified, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/join`, lastModified, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE_URL}/signin`, lastModified, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/guides`, lastModified, changeFrequency: "monthly", priority: 0.5 },
    ...GUIDE_SLUGS.map((slug) => ({
      url: `${SITE_URL}/guides/${slug}`,
      lastModified,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
  ];
}
