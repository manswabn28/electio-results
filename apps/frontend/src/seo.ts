const SITE_NAME = "OneKerala Results";
const DEFAULT_DESCRIPTION = "Track live assembly election results with constituency-level updates, party summary, battleground races, and shareable result pages.";

type SeoInput = {
  title?: string;
  description?: string;
  path?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  twitterCard?: "summary" | "summary_large_image";
  jsonLd?: unknown;
};

export function applySeo({
  title = SITE_NAME,
  description = DEFAULT_DESCRIPTION,
  path,
  ogTitle,
  ogDescription,
  ogImage,
  twitterCard = "summary_large_image",
  jsonLd
}: SeoInput = {}): void {
  const canonicalUrl = canonicalFor(path ?? window.location.pathname);
  document.title = title;
  setMeta("description", description);
  setMeta("robots", "index,follow,max-image-preview:large");
  setMetaProperty("og:type", "website");
  setMetaProperty("og:title", ogTitle ?? title);
  setMetaProperty("og:description", ogDescription ?? description);
  setMetaProperty("og:url", canonicalUrl);
  if (ogImage) setMetaProperty("og:image", ogImage);
  else removeMetaProperty("og:image");
  setMeta("twitter:card", twitterCard);
  setMeta("twitter:title", ogTitle ?? title);
  setMeta("twitter:description", ogDescription ?? description);
  if (ogImage) setMeta("twitter:image", ogImage);
  else removeMeta("twitter:image");
  setLink("canonical", canonicalUrl);
  setJsonLd("website-schema", {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: canonicalFor("/"),
    description
  });
  setJsonLd("organization-schema", {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "OneKerala Results",
    url: canonicalFor("/")
  });
  setJsonLd("webpage-schema", {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: title,
    url: canonicalUrl,
    description,
    isPartOf: {
      "@type": "WebSite",
      name: SITE_NAME,
      url: canonicalFor("/")
    }
  });
  if (jsonLd) {
    setJsonLd("custom-page-schema", jsonLd);
  } else {
    removeJsonLd("custom-page-schema");
  }
}

function canonicalFor(path: string): string {
  const base = import.meta.env.VITE_PUBLIC_SITE_URL || window.location.origin;
  return `${base.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

function setMeta(name: string, content: string): void {
  let element = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!element) {
    element = document.createElement("meta");
    element.name = name;
    document.head.appendChild(element);
  }
  element.content = content;
}

function removeMeta(name: string): void {
  document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.remove();
}

function setMetaProperty(property: string, content: string): void {
  let element = document.querySelector<HTMLMetaElement>(`meta[property="${property}"]`);
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute("property", property);
    document.head.appendChild(element);
  }
  element.content = content;
}

function removeMetaProperty(property: string): void {
  document.querySelector<HTMLMetaElement>(`meta[property="${property}"]`)?.remove();
}

function setLink(rel: string, href: string): void {
  let element = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!element) {
    element = document.createElement("link");
    element.rel = rel;
    document.head.appendChild(element);
  }
  element.href = href;
}

function setJsonLd(id: string, data: unknown): void {
  let element = document.getElementById(id) as HTMLScriptElement | null;
  if (!element) {
    element = document.createElement("script");
    element.id = id;
    element.type = "application/ld+json";
    document.head.appendChild(element);
  }
  element.textContent = JSON.stringify(data);
}

function removeJsonLd(id: string): void {
  document.getElementById(id)?.remove();
}
