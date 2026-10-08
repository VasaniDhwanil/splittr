const SITE_URL = "https://www.splittr.cash";

const DESCRIPTION =
  "Scan a restaurant receipt, share a link, and everyone taps what they ordered. Tax and tip split fairly. Free, no app to install.";

const schema = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebApplication",
      "@id": `${SITE_URL}/#app`,
      name: "Splittr",
      url: SITE_URL,
      applicationCategory: "FinanceApplication",
      operatingSystem: "Web",
      description: DESCRIPTION,
      image: `${SITE_URL}/opengraph-image`,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      publisher: { "@id": `${SITE_URL}/#org` },
    },
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#org`,
      name: "Splittr",
      url: SITE_URL,
      logo: `${SITE_URL}/icon-512.png`,
    },
  ],
};

/** Structured data for search engines and agents. Server component, no client JS. */
export function JsonLd() {
  return (
    <script
      type="application/ld+json"
      // Static, trusted object; escape "<" so the payload can never close the script tag.
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(schema).replace(/</g, "\\u003c"),
      }}
    />
  );
}
