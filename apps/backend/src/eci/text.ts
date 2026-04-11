export function cleanText(value: string | undefined | null): string {
  return (value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function toNumber(value: string | undefined | null): number {
  const normalized = cleanText(value).replace(/,/g, "").replace(/[^\d.-]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function headerKey(value: string): string {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function includesAny(value: string, terms: string[]): boolean {
  const key = headerKey(value);
  return terms.some((term) => {
    if (term === "%") return value.includes("%") || key.includes("percent");
    const normalizedTerm = headerKey(term);
    return Boolean(normalizedTerm) && key.includes(normalizedTerm);
  });
}

export function absoluteUrl(baseUrl: string, href: string): string {
  return new URL(href, baseUrl).toString();
}
