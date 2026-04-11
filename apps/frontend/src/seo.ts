const SITE_NAME = "Kerala Assembly Election 2026 Live Tracker";
const DEFAULT_DESCRIPTION = "Track live Kerala Assembly Election results for selected constituencies with ECI-backed candidate results, party summary, and watch mode.";

type SeoInput = {
  title?: string;
  description?: string;
  path?: string;
};

export function applySeo({ title = SITE_NAME, description = DEFAULT_DESCRIPTION, path }: SeoInput = {}): void {
  const canonicalUrl = canonicalFor(path ?? window.location.pathname);
  document.title = title;
  setMeta("description", description);
  setMeta("robots", "index,follow,max-image-preview:large");
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
    name: "Kerala Election Live Tracker",
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
