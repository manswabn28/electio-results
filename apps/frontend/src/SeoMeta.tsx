import { Helmet } from "react-helmet-async";
import { DEFAULT_DESCRIPTION, SITE_NAME, canonicalFor } from "./seo";

type JsonLdInput = Record<string, unknown>;

type SeoMetaProps = {
  title?: string;
  description?: string;
  canonicalUrl?: string;
  path?: string;
  ogImage?: string;
  ogType?: "website" | "article";
  twitterCard?: "summary" | "summary_large_image";
  jsonLd?: JsonLdInput | JsonLdInput[];
};

const DEFAULT_OG_IMAGE = "/favicon.svg";

export function SeoMeta({
  title = SITE_NAME,
  description = DEFAULT_DESCRIPTION,
  canonicalUrl,
  path,
  ogImage,
  ogType = "website",
  twitterCard = "summary_large_image",
  jsonLd
}: SeoMetaProps) {
  const resolvedCanonical = canonicalUrl ?? canonicalFor(path ?? "/");
  const resolvedOgImage = resolveUrl(ogImage ?? DEFAULT_OG_IMAGE);
  const structuredData = Array.isArray(jsonLd) ? jsonLd : jsonLd ? [jsonLd] : [];

  return (
    <Helmet prioritizeSeoTags>
      <html lang="en" />
      <title>{title}</title>
      <meta name="description" content={description} />
      <meta name="robots" content="index,follow,max-image-preview:large" />
      <link rel="canonical" href={resolvedCanonical} />

      <meta property="og:type" content={ogType} />
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={resolvedCanonical} />
      <meta property="og:image" content={resolvedOgImage} />

      <meta name="twitter:card" content={twitterCard} />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={resolvedOgImage} />

      {structuredData.map((entry, index) => (
        <script key={index} type="application/ld+json">
          {JSON.stringify(entry)}
        </script>
      ))}
    </Helmet>
  );
}

function resolveUrl(value: string) {
  if (/^https?:\/\//i.test(value)) return value;
  return canonicalFor(value);
}
