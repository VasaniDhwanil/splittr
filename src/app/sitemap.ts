import type { MetadataRoute } from "next";

const SITE_URL = "https://www.splittr.cash";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [
    { url: `${SITE_URL}/`, lastModified, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/create`, lastModified, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/join`, lastModified, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE_URL}/signin`, lastModified, changeFrequency: "yearly", priority: 0.3 },
  ];
}
