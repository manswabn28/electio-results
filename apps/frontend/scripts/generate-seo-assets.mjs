import fs from "node:fs";
import path from "node:path";

const frontendRoot = process.cwd();
const publicDir = path.join(frontendRoot, "public");
const archivePath = path.resolve(frontendRoot, "../backend/data/constituency-history-archive.json");
const sourceConfigPath = path.resolve(frontendRoot, "../backend/data/source-config.json");
const siteUrl = "https://results.onekeralam.in";

const corePaths = ["/", "/about-us", "/contact-us", "/terms-and-conditions"];

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function readEnabledStateSlugs() {
  if (!fs.existsSync(sourceConfigPath)) return new Set();
  const sourceConfig = JSON.parse(fs.readFileSync(sourceConfigPath, "utf8"));
  return new Set((sourceConfig?.profiles ?? [])
    .filter((profile) => profile?.enabled)
    .map((profile) => slugify(profile.stateName)));
}

function readArchiveStates() {
  if (!fs.existsSync(archivePath)) return [];
  const archive = JSON.parse(fs.readFileSync(archivePath, "utf8"));
  const states = archive?.states ?? {};
  const enabledStates = readEnabledStateSlugs();
  return Object.entries(states).flatMap(([stateSlug, byYear]) => {
    if (enabledStates.size && !enabledStates.has(slugify(stateSlug))) return [];
    const constituencyNames = new Set();
    for (const yearData of Object.values(byYear ?? {})) {
      for (const row of yearData?.rows ?? []) {
        if (row?.constituencyName) constituencyNames.add(row.constituencyName);
      }
    }
    return [...constituencyNames].map((name) => `/constituency/${slugify(stateSlug)}/${slugify(name)}`);
  });
}

function buildSitemapXml(paths) {
  const urls = [...new Set(paths)].sort();
  const items = urls.map((item) => `  <url>\n    <loc>${siteUrl}${item}</loc>\n    <changefreq>${item === "/" ? "always" : item.startsWith("/constituency/") ? "hourly" : "weekly"}</changefreq>\n    <priority>${item === "/" ? "1.0" : item.startsWith("/constituency/") ? "0.9" : "0.7"}</priority>\n  </url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items}\n</urlset>\n`;
}

const constituencyPaths = readArchiveStates();
const sitemapXml = buildSitemapXml([...corePaths, ...constituencyPaths]);
fs.writeFileSync(path.join(publicDir, "sitemap.xml"), sitemapXml, "utf8");
