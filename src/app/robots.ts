import type { MetadataRoute } from "next";

const SITE_URL = "https://www.splittr.cash";

const allow = ["/", "/groups/join"];
const disallow = ["/bill/", "/groups/", "/profile", "/api/", "/auth/"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow, disallow },
      // AI crawlers are welcome on the same public surface.
      {
        userAgent: ["GPTBot", "ClaudeBot", "PerplexityBot", "Google-Extended"],
        allow,
        disallow,
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
