import * as cheerio from "cheerio";
import type {
  CandidateResult,
  ConstituencyOption,
  ConstituencyResult,
  ConstituencySummary,
  PartySeatSummary
} from "@kerala-election/shared";
import { fallbackKeralaConstituencies, normalizeComparable, slugify } from "../keralaConstituencies.js";
import { absoluteUrl, cleanText, headerKey, includesAny, toNumber } from "./text.js";

type TableRow = {
  cells: string[];
  hrefs: string[];
};

type HeaderMap = Record<string, number>;

function extractRows($: cheerio.CheerioAPI, tableSelector = "table"): TableRow[] {
  const rows: TableRow[] = [];
  $(tableSelector).each((_, table) => {
    $(table)
      .find("> thead > tr, > tbody > tr, > tfoot > tr, > tr")
      .each((__, row) => {
        const cells: string[] = [];
        const hrefs: string[] = [];
        $(row)
          .children("th,td")
          .each((___, cell) => {
            const cellClone = $(cell).clone();
            cellClone.find(".tooltip,.tooltip-icon,script,style").remove();
            cells.push(cleanText(cellClone.text()));
            $(cell)
              .find("a[href]")
              .each((____, link) => {
                const href = $(link).attr("href");
                if (href) hrefs.push(href);
              });
          });
        if (cells.some(Boolean)) rows.push({ cells, hrefs });
      });
  });
  return rows;
}

function buildHeaderMap(headerCells: string[]): HeaderMap {
  return headerCells.reduce<HeaderMap>((acc, label, index) => {
    acc[headerKey(label)] = index;
    return acc;
  }, {});
}

function findIndex(headers: HeaderMap, aliases: string[]): number | undefined {
  for (const [key, index] of Object.entries(headers)) {
    if (
      aliases.some((alias) => {
        if (alias === "%") return key.includes("percent") || key === "votes";
        const normalizedAlias = headerKey(alias);
        return Boolean(normalizedAlias) && key.includes(normalizedAlias);
      })
    ) return index;
  }
  return undefined;
}

function at(cells: string[], index: number | undefined): string {
  return typeof index === "number" ? cleanText(cells[index]) : "";
}

function rowLooksLikeHeader(cells: string[], expected: string[]): boolean {
  return cells.filter((cell) => includesAny(cell, expected)).length >= Math.min(2, expected.length);
}

function firstDetailHref(row: TableRow): string | undefined {
  return row.hrefs.find((href) => /Constituencywise|candidateswise/i.test(href)) ?? row.hrefs[0];
}

export function parseStatePage(html: string, statePageUrl: string, defaultFavoriteIds: string[], includeFallback = true): ConstituencySummary[] {
  const $ = cheerio.load(html);
  const stateRows = extractRows($, ".custom-table > .table-responsive > table.table");
  const rows = stateRows.length ? stateRows : extractRows($);
  const summaries: ConstituencySummary[] = [];
  let headers: HeaderMap = {};

  // ECI pages have historically been table-heavy, but class names and nesting
  // vary between election events. The parser therefore learns header positions
  // from visible table text and falls back to link/text heuristics.
  for (const row of rows) {
    if (rowLooksLikeHeader(row.cells, ["Constituency", "Leading Candidate", "Margin", "Status"])) {
      headers = buildHeaderMap(row.cells);
      continue;
    }

    const detailHref = firstDetailHref(row);
    if (!Object.keys(headers).length && !detailHref) continue;
    const constituencyNameIndex = findIndex(headers, ["Constituency"]);
    const numberIndex = findIndex(headers, ["AC No", "Const. No", "No"]);
    const marginIndex = findIndex(headers, ["Margin"]);

    const inferredName = cleanConstituencyName(
      at(row.cells, constituencyNameIndex) ||
      row.cells.find((cell) => /[a-z]/i.test(cell) && !/won|leading|round|counting/i.test(cell)) ||
      ""
    );

    const constituencyNumber = at(row.cells, numberIndex) || inferConstituencyNumber(detailHref ?? statePageUrl, row.cells);
    if (!inferredName || !/^\d{1,3}$/.test(constituencyNumber)) continue;

    const summary: ConstituencySummary = {
      constituencyId: slugify(inferredName),
      constituencyName: inferredName,
      constituencyNumber: constituencyNumber.padStart(3, "0"),
      statusText: findCell(row.cells, ["won", "leading", "result declared", "counting", "awaited"]),
      roundStatus: findCell(row.cells, ["round", "postal", "counting"]) || at(row.cells, findIndex(headers, ["Status"])),
      leadingCandidate: at(row.cells, findIndex(headers, ["Leading Candidate", "Winner Candidate", "Candidate"])),
      leadingParty: at(row.cells, findIndex(headers, ["Leading Party", "Winner Party", "Party"])),
      trailingCandidate: at(row.cells, findIndex(headers, ["Trailing Candidate", "Runner"])),
      trailingParty: at(row.cells, findIndex(headers, ["Trailing Party"])),
      margin: toNumber(at(row.cells, marginIndex)),
      sourceUrl: detailHref ? absoluteUrl(statePageUrl, detailHref) : undefined
    };

    summaries.push(summary);
  }

  if (summaries.length === 0) {
    summaries.push(...parseConstituencyLinksAndOptions($, statePageUrl));
  }

  if (summaries.length === 0) {
    const single = parseSingleConstituencySummary($, statePageUrl);
    if (single) summaries.push(single);
  }

  return includeFallback ? mergeWithFallback(summaries, defaultFavoriteIds) : summaries;
}

export function parsePaginationUrls(html: string, pageUrl: string): string[] {
  const $ = cheerio.load(html);
  const urls = new Set<string>();
  $(".custom-pagination a[href], .pagination a[href]").each((_, link) => {
    const href = $(link).attr("href");
    if (href && /statewise/i.test(href)) urls.add(absoluteUrl(pageUrl, href));
  });
  return [...urls];
}

export function parseConstituencyPage(
  html: string,
  sourceUrl: string,
  stateSummary?: ConstituencySummary
): ConstituencyResult {
  const $ = cheerio.load(html);
  const text = cleanText($.root().text());
  const candidateRows = extractCandidateRows($, sourceUrl);
  const candidates = candidateRows.sort((a, b) => b.totalVotes - a.totalVotes);
  const leader = candidates[0];
  const runnerUp = candidates[1];
  const totalVotes = candidates.reduce((sum, candidate) => sum + candidate.totalVotes, 0);
  const inferredName = stateSummary?.constituencyName || inferNameFromPage($, sourceUrl);
  const inferredNumber = stateSummary?.constituencyNumber || inferConstituencyNumber(sourceUrl, []);

  return {
    constituencyId: stateSummary?.constituencyId || slugify(inferredName),
    constituencyName: inferredName,
    constituencyNumber: inferredNumber,
    statusText: stateSummary?.statusText || findStatusText(text),
    roundStatus: stateSummary?.roundStatus || findRoundStatus(text),
    leadingCandidate: stateSummary?.leadingCandidate || leader?.candidateName || "",
    leadingParty: stateSummary?.leadingParty || leader?.party || "",
    trailingCandidate: stateSummary?.trailingCandidate || runnerUp?.candidateName || "",
    trailingParty: stateSummary?.trailingParty || runnerUp?.party || "",
    margin: stateSummary?.margin || Math.max(0, (leader?.totalVotes ?? 0) - (runnerUp?.totalVotes ?? 0)),
    totalVotes,
    lastUpdated: findLastUpdated(text),
    candidates,
    sourceUrl
  };
}

export function parsePartySummaryPage(html: string): PartySeatSummary[] {
  const $ = cheerio.load(html);
  const partyColors = parsePartyColors($);
  const rows = extractRows($, "table");
  let headers: HeaderMap = {};
  const parties: PartySeatSummary[] = [];

  for (const row of rows) {
    if (rowLooksLikeHeader(row.cells, ["Party", "Won", "Leading", "Total"])) {
      headers = buildHeaderMap(row.cells);
      continue;
    }

    const partyIndex = findIndex(headers, ["Party"]);
    const wonIndex = findIndex(headers, ["Won"]);
    const leadingIndex = findIndex(headers, ["Leading"]);
    const totalIndex = findIndex(headers, ["Total"]);
    const party = at(row.cells, partyIndex);
    if (!party || /^total$/i.test(party) || wonIndex === undefined || leadingIndex === undefined || totalIndex === undefined) continue;

    parties.push({
      party,
      won: toNumber(at(row.cells, wonIndex)),
      leading: toNumber(at(row.cells, leadingIndex)),
      total: toNumber(at(row.cells, totalIndex)),
      color: partyColors.get(partyAbbreviation(party)) ?? partyColors.get("Others")
    });
  }

  return parties.filter((party) => party.total > 0).sort((a, b) => b.total - a.total);
}

function parsePartyColors($: cheerio.CheerioAPI): Map<string, string> {
  const colors = new Map<string, string>();
  $(".grid-box").each((_, element) => {
    const label = cleanText($(element).find("h4").first().text());
    const style = $(element).attr("style") ?? "";
    const color = style.match(/background-color\s*:\s*([^;]+)/i)?.[1]?.trim();
    if (label && color) colors.set(label, color);
  });
  return colors;
}

function partyAbbreviation(party: string): string {
  return party.match(/\s-\s(.+)$/)?.[1]?.trim() ?? party;
}

export function parseElectionRootForKeralaStatePage(
  html: string,
  rootUrl: string,
  stateCode?: string
): string | undefined {
  const $ = cheerio.load(html);
  const candidates: { href: string; text: string }[] = [];

  $("a[href]").each((_, link) => {
    const href = $(link).attr("href") ?? "";
    const text = cleanText($(link).text());
    if (/statewiseS/i.test(href)) candidates.push({ href, text });
  });

  // Prefer an explicit S-code when the operator knows it. Otherwise look for a
  // Kerala-labelled statewise link and finally fall back to the first statewise
  // link so parsing failures are visible in logs instead of silently ignored.
  const explicit = stateCode
    ? candidates.find((candidate) => new RegExp(`statewise${stateCode}`, "i").test(candidate.href))
    : undefined;
  const kerala = candidates.find((candidate) => /kerala/i.test(candidate.text + " " + candidate.href));
  const firstStatewise = candidates[0];
  const match = explicit ?? kerala ?? firstStatewise;

  return match ? absoluteUrl(rootUrl, match.href) : undefined;
}

export function toConstituencyOptions(
  summaries: ConstituencySummary[],
  defaultFavoriteIds: string[],
  includeFallback = true
): ConstituencyOption[] {
  const normalized = includeFallback ? mergeWithFallback(summaries, defaultFavoriteIds) : summaries;
  return normalized.map((summary) => ({
    constituencyId: summary.constituencyId,
    constituencyName: summary.constituencyName,
    constituencyNumber: summary.constituencyNumber,
    sourceUrl: summary.sourceUrl,
    isFavoriteDefault: defaultFavoriteIds.includes(summary.constituencyId)
  }));
}

function extractCandidateRows($: cheerio.CheerioAPI, sourceUrl: string): CandidateResult[] {
  const tableRows = extractRows($);
  let headers: HeaderMap = {};
  const candidates: CandidateResult[] = [];

  for (const row of tableRows) {
    if (rowLooksLikeHeader(row.cells, ["Candidate", "Party", "EVM", "Postal", "Total", "%"])) {
      headers = buildHeaderMap(row.cells);
      continue;
    }

    const candidateIndex = findIndex(headers, ["Candidate"]);
    const partyIndex = findIndex(headers, ["Party"]);
    const totalIndex = findIndex(headers, ["Total Votes", "Total"]);
    if (candidateIndex === undefined || totalIndex === undefined) continue;

    const candidateName = at(row.cells, candidateIndex);
    if (!candidateName || /nota|total/i.test(candidateName) && row.cells.length < 4) continue;

    candidates.push({
      serialNo: toNumber(at(row.cells, findIndex(headers, ["S.No", "Serial", "No"]))) || candidates.length + 1,
      candidateName,
      party: at(row.cells, partyIndex),
      evmVotes: toNumber(at(row.cells, findIndex(headers, ["EVM"]))),
      postalVotes: toNumber(at(row.cells, findIndex(headers, ["Postal"]))),
      totalVotes: toNumber(at(row.cells, totalIndex)),
      votePercent: toNumber(at(row.cells, findIndex(headers, ["%", "Vote %", "Percentage"])))
    });
  }

  return candidates.length ? candidates : extractCandidateCards($, sourceUrl);
}

function extractCandidateCards($: cheerio.CheerioAPI, sourceUrl: string): CandidateResult[] {
  const candidates: CandidateResult[] = [];
  $(".cand-box").each((index, element) => {
    const statusText = cleanText($(element).find(".status").text());
    const voteMatch = statusText.match(/([\d,]+)\s*(?:\(|$)/);
    const totalVotes = toNumber(voteMatch?.[1] ?? "");
    const candidateName = cleanText($(element).find(".nme-prty h5").first().text());
    const party = cleanText($(element).find(".nme-prty h6").first().text());
    const imageSrc = $(element).find("figure img").first().attr("src");
    if (!candidateName || !totalVotes && !/nota/i.test(candidateName)) return;

    candidates.push({
      serialNo: index + 1,
      candidateName,
      party,
      photoUrl: imageSrc ? absoluteUrl(sourceUrl, imageSrc) : undefined,
      evmVotes: 0,
      postalVotes: 0,
      totalVotes,
      votePercent: 0
    });
  });

  const total = candidates.reduce((sum, candidate) => sum + candidate.totalVotes, 0);
  return candidates.map((candidate) => ({
    ...candidate,
    votePercent: total ? (candidate.totalVotes / total) * 100 : 0
  }));
}

function mergeWithFallback(
  summaries: ConstituencySummary[],
  defaultFavoriteIds: string[]
): ConstituencySummary[] {
  const byComparable = new Map(summaries.map((summary) => [normalizeComparable(summary.constituencyName), summary]));
  for (const fallback of fallbackKeralaConstituencies) {
    const key = normalizeComparable(fallback.constituencyName);
    if (!byComparable.has(key)) {
      byComparable.set(key, {
        constituencyId: fallback.constituencyId,
        constituencyName: fallback.constituencyName,
        constituencyNumber: fallback.constituencyNumber,
        statusText: "",
        roundStatus: "",
        leadingCandidate: "",
        leadingParty: "",
        trailingCandidate: "",
        trailingParty: "",
        margin: 0
      });
    }
  }

  return [...byComparable.values()]
    .map((summary) => ({
      ...summary,
      constituencyId: summary.constituencyId || slugify(summary.constituencyName),
      constituencyNumber: summary.constituencyNumber || ""
    }))
    .sort((a, b) => toNumber(a.constituencyNumber) - toNumber(b.constituencyNumber) || a.constituencyName.localeCompare(b.constituencyName))
    .map((summary) => ({
      ...summary,
      constituencyId: summary.constituencyId || slugify(summary.constituencyName),
      statusText: summary.statusText || (defaultFavoriteIds.includes(summary.constituencyId) ? "Configured favorite" : "")
    }));
}

function findCell(cells: string[], terms: string[]): string {
  return cells.find((cell) => includesAny(cell, terms)) ?? "";
}

function inferConstituencyNumber(sourceUrl: string, cells: string[]): string {
  const cellNumber = cells.find((cell) => /^\d{1,3}$/.test(cell));
  if (cellNumber) return cellNumber.padStart(3, "0");
  const match = sourceUrl.match(/S\d+(\d{3})/i) ?? sourceUrl.match(/S\d{2,3}(\d{1,3})\.html?$/i) ?? sourceUrl.match(/(\d{1,3})\.html?$/i);
  return match?.[1] ?? "";
}

function cleanConstituencyName(value: string): string {
  return cleanText(value).replace(/^\d+\s*[-.)]\s*/, "");
}

function inferNameFromPage($: cheerio.CheerioAPI, sourceUrl: string): string {
  const heading = cleanText($("h1,h2,h3,.page-title").first().text());
  const match =
    heading.match(/Assembly Constituency\s*(\d+)\s*[-:]\s*([^()]+)/i) ??
    heading.match(/Constituency\s*[-:]\s*(.+)$/i);
  if (match?.[2]) return cleanText(match[2]);
  if (match?.[1]) return cleanText(match[1]);
  return sourceUrl.split("/").pop()?.replace(/\.html?$/i, "") ?? "Constituency";
}

function parseConstituencyLinksAndOptions($: cheerio.CheerioAPI, sourceUrl: string): ConstituencySummary[] {
  const summaries: ConstituencySummary[] = [];
  const seen = new Set<string>();
  $("a[href], option[value]").each((_, element) => {
    const href = $(element).attr("href") ?? $(element).attr("value") ?? "";
    if (!/Constituencywise|candidateswise/i.test(href)) return;
    const text = cleanConstituencyName(cleanText($(element).text()));
    const match = text.match(/^(\d{1,3})\s*[-.)]\s*(.+)$/);
    const constituencyNumber = (match?.[1] ?? inferConstituencyNumber(href, [])).padStart(3, "0");
    const constituencyName = cleanConstituencyName(match?.[2] ?? text);
    if (!constituencyName || seen.has(`${constituencyNumber}:${constituencyName}`)) return;
    seen.add(`${constituencyNumber}:${constituencyName}`);
    summaries.push({
      constituencyId: slugify(constituencyName),
      constituencyName,
      constituencyNumber,
      statusText: "",
      roundStatus: "",
      leadingCandidate: "",
      leadingParty: "",
      trailingCandidate: "",
      trailingParty: "",
      margin: 0,
      sourceUrl: absoluteUrl(sourceUrl, href)
    });
  });
  return summaries;
}

function parseSingleConstituencySummary($: cheerio.CheerioAPI, sourceUrl: string): ConstituencySummary | undefined {
  const heading = cleanText($(".page-title h2, h2").first().text());
  const match = heading.match(/Assembly Constituency\s*(\d+)\s*[-:]\s*([^()]+)/i);
  if (!match) return undefined;
  const constituencyName = cleanConstituencyName(match[2]);
  return {
    constituencyId: slugify(constituencyName),
    constituencyName,
    constituencyNumber: match[1].padStart(3, "0"),
    statusText: findStatusText(cleanText($.root().text())),
    roundStatus: findRoundStatus(cleanText($.root().text())),
    leadingCandidate: "",
    leadingParty: "",
    trailingCandidate: "",
    trailingParty: "",
    margin: 0,
    sourceUrl
  };
}

function findStatusText(text: string): string {
  const match = text.match(/\b(Result Declared|Won|Leading|Counting|Awaited)\b/i);
  return match?.[1] ?? "";
}

function findRoundStatus(text: string): string {
  const match = text.match(/Round\s*[^.]{0,80}/i);
  return cleanText(match?.[0] ?? "");
}

function findLastUpdated(text: string): string {
  const match =
    text.match(/Last\s+Updated\s*:?\s*([A-Za-z0-9,:\-/ ]{6,40})/i) ??
    text.match(/Updated\s+On\s*:?\s*([A-Za-z0-9,:\-/ ]{6,40})/i);
  return cleanText(match?.[1] ?? "");
}
