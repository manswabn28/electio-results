import type { ConstituencyResult } from "@kerala-election/shared";
import { shareImageProxyUrl } from "./api";
import type { ElectionBattleShareCardProps } from "./ElectionBattleShareCard";

export function buildElectionBattleShareCardPropsFromResult(
  result: ConstituencyResult,
  electionTitle: string,
  checkedAt?: number,
  partyColors?: { leftPartyColor?: string; rightPartyColor?: string }
): ElectionBattleShareCardProps {
  const leader = result.candidates[0];
  const runner = result.candidates[1];
  const roundProgress = parseRoundProgress(result.roundStatus || result.statusText || "");
  const declared = isDeclaredWinner(result.statusText || result.roundStatus || "");
  return {
    electionTitle: normalizeElectionShareTitle(electionTitle),
    constituencyName: result.constituencyName,
    updatedTime: formatUpdatedTime(checkedAt, result.lastUpdated),
    leftParty: shortPartyName(result.leadingParty || leader?.party || "LEAD"),
    leftPartyColor: partyColors?.leftPartyColor,
    rightParty: shortPartyName(result.trailingParty || runner?.party || "RUNNER"),
    rightPartyColor: partyColors?.rightPartyColor,
    leftCandidateName: result.leadingCandidate || leader?.candidateName || "Leading candidate",
    rightCandidateName: result.trailingCandidate || runner?.candidateName || "Trailing candidate",
    leftVotes: leader?.totalVotes ?? 0,
    rightVotes: runner?.totalVotes ?? 0,
    leadingSide: "left",
    leadMargin: Math.max(0, result.margin || 0),
    statusText: normalizeStatusText(result, declared),
    roundsCounted: roundProgress?.current ?? 0,
    totalRounds: roundProgress?.total ?? 0,
    websiteUrl: "results.onekeralam.in",
    dataSourceText: "Onekeralam.in",
    leftCandidatePhoto: leader?.photoUrl,
    rightCandidatePhoto: runner?.photoUrl
  };
}

export async function buildElectionBattleShareCardBlob(props: ElectionBattleShareCardProps): Promise<Blob> {
  const [leftPhoto, rightPhoto, logoPhoto] = await Promise.all([
    toDataUrl(props.leftCandidatePhoto),
    toDataUrl(props.rightCandidatePhoto),
    toDataUrl(props.logoUrl)
  ]);
  const svg = buildBattleSvg({
    ...props,
    leftCandidatePhoto: leftPhoto ?? undefined,
    rightCandidatePhoto: rightPhoto ?? undefined,
    logoUrl: logoPhoto ?? undefined
  });
  return svgToPngBlob(svg, 1080, 1080);
}

function buildBattleSvg(props: ElectionBattleShareCardProps) {
  const segments = Math.max(1, props.totalRounds || 1);
  const counted = Math.max(0, Math.min(props.roundsCounted || 0, segments));
  const constituencyRaw = clampText(props.constituencyName.toUpperCase(), 18);
  const constituencyName = escapeXml(constituencyRaw);
  const constituencyFontSize = fitConstituencyFontSize(constituencyRaw);
  const electionRaw = clampText(props.electionTitle.toUpperCase(), 28);
  const electionTitle = escapeXml(electionRaw);
  const electionFontSize = fitSvgFontSize(electionRaw, 420, 20, 13, 0.54);
  const statusRaw = clampText(props.statusText.toUpperCase(), 22);
  const statusText = escapeXml(statusRaw);
  const statusFontSize = fitStatusFontSize(statusRaw);
  const updatedTime = escapeXml(props.updatedTime);
  const websiteRaw = clampText(props.websiteUrl, 24);
  const websiteUrl = escapeXml(websiteRaw);
  const dataSourceText = escapeXml(props.dataSourceText.toUpperCase());
  const leftCandidateLines = wrapTwoLines(props.leftCandidateName.toUpperCase(), 18);
  const rightCandidateLines = wrapTwoLines(props.rightCandidateName.toUpperCase(), 18);
  const leftPartyRaw = clampText(props.leftParty.toUpperCase(), 9);
  const rightPartyRaw = clampText(props.rightParty.toUpperCase(), 9);
  const leftParty = escapeXml(leftPartyRaw);
  const rightParty = escapeXml(rightPartyRaw);
  const leftPartyFontSize = fitPartyFontSize(leftPartyRaw);
  const rightPartyFontSize = fitPartyFontSize(rightPartyRaw);
  const leftVotes = formatIndianNumber(props.leftVotes);
  const rightVotes = formatIndianNumber(props.rightVotes);
  const leftVotesFontSize = leftVotes.length >= 7 ? 70 : 82;
  const rightVotesFontSize = rightVotes.length >= 7 ? 70 : 82;
  const margin = `+${formatIndianNumber(props.leadMargin)}`;
  const marginFontSize = margin.length >= 7 ? 62 : 74;
  const leftLeading = props.leadingSide === "left";

  const barWidth = 952 - 28 - 120 - 24;
  const segmentWidth = (barWidth - (segments - 1) * 6) / segments;
  const segmentRects = Array.from({ length: segments }).map((_, index) => {
    const x = index * (segmentWidth + 6);
    const fill = index < counted ? "url(#segmentWarm)" : "rgba(255,255,255,0.92)";
    const stroke = index < counted ? "rgba(239,68,68,0.85)" : "rgba(255,255,255,0.16)";
    return `<rect x="${x}" y="0" width="${segmentWidth}" height="26" rx="4" fill="${fill}" stroke="${stroke}" />`;
  }).join("");

  const leftPhoto = candidateImageSvg(props.leftCandidatePhoto, props.leftCandidateName, 97, 363, 190, 190, 22);
  const rightPhoto = candidateImageSvg(props.rightCandidatePhoto, props.rightCandidateName, 793, 363, 190, 190, 22);
  const leftCandidateSvg = leftCandidateLines
    .slice(0, 2)
    .map((line, index) => `<text x="60" y="${618 + index * 28}" font-size="24" font-weight="800" fill="rgba(255,255,255,0.92)">${escapeXml(clampText(line, 18))}</text>`)
    .join("");
  const rightCandidateSvg = rightCandidateLines
    .slice(0, 2)
    .map((line, index) => `<text x="1020" y="${618 + index * 28}" text-anchor="end" font-size="24" font-weight="800" fill="rgba(255,255,255,0.92)">${escapeXml(clampText(line, 18))}</text>`)
    .join("");
  const logo = props.logoUrl
    ? `<image href="${props.logoUrl}" x="64" y="982" width="52" height="52" clip-path="url(#logoClip)" preserveAspectRatio="xMidYMid slice" />`
    : `<circle cx="90" cy="1008" r="26" fill="#0b1730" stroke="rgba(34,211,238,0.34)" stroke-width="2"/><text x="90" y="1015" text-anchor="middle" font-size="18" font-weight="900" fill="#eab308">OK</text>`;

  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
    <defs>
      <radialGradient id="bgCore" cx="50%" cy="18%" r="70%">
        <stop offset="0%" stop-color="#0f2344"/>
        <stop offset="38%" stop-color="#07111f"/>
        <stop offset="100%" stop-color="#02060c"/>
      </radialGradient>
      <radialGradient id="glowRed" cx="0%" cy="36%" r="48%">
        <stop offset="0%" stop-color="rgba(255,48,48,0.86)"/>
        <stop offset="38%" stop-color="rgba(176,12,12,0.35)"/>
        <stop offset="100%" stop-color="rgba(0,0,0,0)"/>
      </radialGradient>
      <radialGradient id="glowGreen" cx="100%" cy="37%" r="46%">
        <stop offset="0%" stop-color="rgba(0,210,96,0.80)"/>
        <stop offset="38%" stop-color="rgba(0,110,62,0.30)"/>
        <stop offset="100%" stop-color="rgba(0,0,0,0)"/>
      </radialGradient>
      <radialGradient id="glowBlue" cx="50%" cy="44%" r="30%">
        <stop offset="0%" stop-color="rgba(56,189,248,0.55)"/>
        <stop offset="100%" stop-color="rgba(0,0,0,0)"/>
      </radialGradient>
      <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="rgba(255,255,255,0.08)"/>
        <stop offset="42%" stop-color="rgba(255,255,255,0.02)"/>
        <stop offset="100%" stop-color="rgba(255,255,255,0.08)"/>
      </linearGradient>
      <linearGradient id="redCard" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#9f111a"/>
        <stop offset="100%" stop-color="#24070d"/>
      </linearGradient>
      <linearGradient id="greenCard" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#007838"/>
        <stop offset="100%" stop-color="#071810"/>
      </linearGradient>
      <linearGradient id="segmentWarm" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#ff3b30"/>
        <stop offset="100%" stop-color="#d81212"/>
      </linearGradient>
      <linearGradient id="yellowTag" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#facc15"/>
        <stop offset="100%" stop-color="#eab308"/>
      </linearGradient>
      <linearGradient id="vsGlow" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="rgba(59,130,246,0)"/>
        <stop offset="50%" stop-color="rgba(56,189,248,0.95)"/>
        <stop offset="100%" stop-color="rgba(59,130,246,0)"/>
      </linearGradient>
      <clipPath id="logoClip">
        <circle cx="90" cy="1008" r="26" />
      </clipPath>
      <filter id="softGlow">
        <feGaussianBlur stdDeviation="18" result="blur"/>
        <feMerge>
          <feMergeNode in="blur"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
      <filter id="titleShadow">
        <feDropShadow dx="0" dy="8" stdDeviation="10" flood-color="rgba(0,0,0,0.85)" />
      </filter>
    </defs>

    <rect width="1080" height="1080" fill="url(#bgCore)" />
    <rect width="1080" height="1080" fill="url(#glowRed)" />
    <rect width="1080" height="1080" fill="url(#glowGreen)" />
    <rect width="1080" height="1080" fill="url(#glowBlue)" />
    <rect width="1080" height="1080" fill="url(#glass)" />
    <line x1="525" y1="322" x2="603" y2="644" stroke="url(#vsGlow)" stroke-width="10" filter="url(#softGlow)" />

    <g>
      <rect x="28" y="24" width="138" height="54" rx="12" fill="#e11d24" />
      <circle cx="52" cy="51" r="10" fill="#fff" />
      <text x="74" y="61" font-size="24" font-weight="900" fill="#fff">LIVE</text>
    </g>

    <line x1="198" y1="50" x2="310" y2="50" stroke="rgba(255,255,255,0.18)" stroke-width="2" />
    <line x1="770" y1="50" x2="882" y2="50" stroke="rgba(255,255,255,0.18)" stroke-width="2" />
    <text x="540" y="56" text-anchor="middle" font-size="${electionFontSize}" font-weight="900" letter-spacing="6" fill="rgba(255,255,255,0.92)">${electionTitle}</text>

    <text x="948" y="46" text-anchor="end" font-size="24" font-weight="900" fill="#ffffff">${updatedTime}</text>
    <text x="948" y="73" text-anchor="end" font-size="18" font-weight="900" fill="#facc15">LIVE UPDATE</text>

    <circle cx="540" cy="112" r="12" fill="#facc15" />
    <path d="M540 104 L545 114 L540 122 L535 114 Z" fill="#07111f" />
    <line x1="438" y1="112" x2="510" y2="112" stroke="rgba(255,255,255,0.15)" stroke-width="2" />
    <line x1="570" y1="112" x2="642" y2="112" stroke="rgba(255,255,255,0.15)" stroke-width="2" />

    <text x="540" y="238" text-anchor="middle" font-size="${constituencyFontSize}" font-weight="900" font-family="Inter, Arial, sans-serif" fill="#ffffff" filter="url(#titleShadow)" letter-spacing="1">${constituencyName}</text>

    <g transform="translate(325,278)">
      <path d="M-16 2 L-36 34 L-18 34 L-26 56 L4 20 L-12 20 Z" fill="#facc15" />
      <rect x="0" y="0" width="428" height="54" rx="4" fill="url(#yellowTag)" />
      <text x="214" y="36" text-anchor="middle" font-size="26" font-weight="900" font-style="italic" fill="#09111d">NAIL-BITING BATTLE</text>
      <path d="M470 2 L450 34 L468 34 L460 56 L490 20 L474 20 Z" fill="#facc15" />
    </g>

    <g>
      <rect x="32" y="345" width="320" height="395" rx="20" fill="url(#redCard)" stroke="rgba(239,68,68,0.8)" />
      ${leftPhoto}
      ${leftLeading ? `<rect x="60" y="550" width="146" height="48" rx="8" fill="#e11d24" /><text x="133" y="583" text-anchor="middle" font-size="24" font-weight="900" fill="#fff">LEADING</text>` : ""}
      <text x="60" y="626" font-size="${leftPartyFontSize}" font-weight="900" fill="#fff">${leftParty}</text>
      ${leftCandidateSvg.replace(/y="618"/g, 'y="660"').replace(/y="646"/g, 'y="686"')}
      <rect x="60" y="695" width="64" height="6" rx="3" fill="#ff5252" />
      <text x="60" y="726" font-size="62" font-weight="900" fill="#fff">${leftVotes}</text>
      <text x="139" y="749" font-size="22" font-weight="800" letter-spacing="4" fill="rgba(255,255,255,0.82)">VOTES</text>
    </g>

    <g>
      <rect x="728" y="345" width="320" height="395" rx="20" fill="url(#greenCard)" stroke="rgba(16,185,129,0.8)" />
      ${rightPhoto}
      ${!leftLeading ? `<rect x="842" y="550" width="146" height="48" rx="8" fill="#059669" /><text x="915" y="583" text-anchor="middle" font-size="24" font-weight="900" fill="#fff">LEADING</text>` : ""}
      <text x="1020" y="626" text-anchor="end" font-size="${rightPartyFontSize}" font-weight="900" fill="#fff">${rightParty}</text>
      ${rightCandidateSvg.replace(/y="618"/g, 'y="660"').replace(/y="646"/g, 'y="686"')}
      <rect x="956" y="695" width="64" height="6" rx="3" fill="#34d399" />
      <text x="1020" y="726" text-anchor="end" font-size="62" font-weight="900" fill="#fff">${rightVotes}</text>
      <text x="940" y="749" text-anchor="end" font-size="22" font-weight="800" letter-spacing="4" fill="rgba(255,255,255,0.82)">VOTES</text>
    </g>

    <text x="540" y="520" text-anchor="middle" font-size="96" font-weight="900" font-style="italic" fill="#ffffff" filter="url(#softGlow)">VS</text>

    <g transform="translate(370,590)">
      <rect x="0" y="0" width="340" height="134" rx="22" fill="rgba(6,14,26,0.92)" stroke="rgba(234,179,8,0.78)" />
      <rect x="12" y="12" width="316" height="110" rx="18" fill="none" stroke="rgba(234,179,8,0.55)" stroke-dasharray="6 6" />
      <text x="170" y="42" text-anchor="middle" font-size="20" font-weight="900" letter-spacing="3" fill="#fde68a">LEAD MARGIN</text>
      <text x="170" y="92" text-anchor="middle" font-size="${marginFontSize}" font-weight="900" fill="#facc15">${margin}</text>
      <text x="170" y="120" text-anchor="middle" font-size="22" font-weight="800" letter-spacing="3" fill="rgba(255,255,255,0.84)">VOTES</text>
    </g>

    <g transform="translate(312,756)">
      <rect x="0" y="0" width="456" height="70" rx="35" fill="rgba(4,12,22,0.92)" stroke="rgba(234,179,8,0.84)" stroke-width="3" />
      <text x="228" y="30" text-anchor="middle" font-size="17" font-weight="900" letter-spacing="2.8" fill="rgba(255,255,255,0.82)">STATUS</text>
      <text x="228" y="56" text-anchor="middle" font-size="${statusFontSize}" font-weight="900" fill="#facc15">${statusText}</text>
    </g>
    <circle cx="278" cy="792" r="5" fill="#facc15" />
    <circle cx="782" cy="792" r="5" fill="#facc15" />

    <g transform="translate(64,850)">
      <rect x="0" y="0" width="952" height="98" rx="16" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.18)" />
      <text x="28" y="32" font-size="20" font-weight="900" letter-spacing="2.2" fill="rgba(255,255,255,0.84)">COUNTING PROGRESS</text>
      <g transform="translate(28,46)">${segmentRects}</g>
      <text x="936" y="44" text-anchor="end" font-size="30" font-weight="900" fill="#fff">${counted}/${segments}</text>
      <text x="936" y="73" text-anchor="end" font-size="18" font-weight="800" letter-spacing="2.5" fill="rgba(255,255,255,0.72)">ROUNDS</text>
    </g>

    ${logo}
    <text x="136" y="1002" font-size="18" font-weight="900" letter-spacing="2.2" fill="rgba(255,255,255,0.8)">TRACK YOUR CONSTITUENCY LIVE</text>
    <text x="136" y="1032" font-size="18" font-weight="900" fill="#facc15">${websiteUrl}</text>

    <text x="952" y="1008" text-anchor="end" font-size="18" font-weight="900" letter-spacing="1.8" fill="rgba(255,255,255,0.88)">FAST. ACCURATE. OFFICIAL.</text>
    <text x="952" y="1034" text-anchor="end" font-size="16" font-weight="700" fill="rgba(255,255,255,0.58)">POWERED BY ${dataSourceText}</text>
    <circle cx="1016" cy="1008" r="26" fill="#16a34a" />
    <path d="M1004 1009 l8 8 l16 -20" stroke="#fff" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round" />
  </svg>`;
}

async function svgToPngBlob(svg: string, width: number, height: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available.");
  const image = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  ctx.drawImage(image, 0, 0, width, height);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Could not generate share card image."));
        return;
      }
      resolve(blob);
    }, "image/png");
  });
}

function candidateImageSvg(
  dataUrl: string | undefined,
  fallbackLabel: string,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const clipId = `clip-${x}-${y}`;
  const frame = `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.14)" />`;
  if (dataUrl) {
    return `${frame}<clipPath id="${clipId}"><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" /></clipPath><image href="${dataUrl}" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})" />`;
  }
  return `${frame}<text x="${x + width / 2}" y="${y + height / 2 + 20}" text-anchor="middle" font-size="58" font-weight="900" fill="rgba(255,255,255,0.9)">${escapeXml(initials(fallbackLabel))}</text>`;
}

async function toDataUrl(url?: string): Promise<string | null> {
  if (!url) return null;
  try {
    const response = await fetch(toShareImageUrl(url));
    if (!response.ok) return null;
    const blob = await response.blob();
    return await blobToDataUrl(blob);
  } catch {
    return null;
  }
}

function toShareImageUrl(url: string) {
  try {
    const parsed = new URL(url, window.location.origin);
    if (!/^https?:$/i.test(parsed.protocol)) return parsed.toString();
    return shareImageProxyUrl(parsed.toString());
  } catch {
    return url;
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error("Could not read image data."));
    reader.readAsDataURL(blob);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load share image."));
    image.src = src;
  });
}

function parseRoundProgress(value: string) {
  const match = value.match(/(\d+)\s*(?:\/|of)\s*(\d+)/i);
  if (!match) return null;
  const current = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) return null;
  return { current, total };
}

function normalizeStatusText(result: ConstituencyResult, declared: boolean) {
  if (declared) return "WINNER DECLARED";
  const margin = Math.max(0, result.margin || 0);
  if (margin <= 250) return "PHOTO FINISH";
  if (margin <= 1000) return "TOO CLOSE TO CALL";
  if (margin <= 5000) return "TIGHT CONTEST";
  return "LIVE UPDATE";
}

function normalizeElectionShareTitle(value: string) {
  return value
    .replace(/\s+Live Tracker$/i, "")
    .replace(/\s+Assembly Election\s+/i, " Election ")
    .trim()
    .toUpperCase();
}

function formatUpdatedTime(checkedAt?: number, lastUpdated?: string) {
  if (checkedAt) {
    return new Date(checkedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toUpperCase();
  }
  if (lastUpdated?.trim()) {
    const date = new Date(lastUpdated);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toUpperCase();
    }
    return lastUpdated.toUpperCase();
  }
  return "LIVE";
}

function shortPartyName(value: string) {
  const known: Record<string, string> = {
    "Bharatiya Janata Party": "BJP",
    "Janata Dal (United)": "JD(U)",
    "Rashtriya Janata Dal": "RJD",
    "Indian National Congress": "INC",
    "Communist Party of India": "CPI",
    "Communist Party of India (Marxist)": "CPM",
    "Communist Party of India (Marxist-Leninist) (Liberation)": "CPI(ML)L",
    "Communist Party of India (Marxist-Leninist) Liberation": "CPI(ML)L",
    "Indian Union Muslim League": "IUML",
    "Nationalist Congress Party": "NCP",
    "All India Trinamool Congress": "TMC"
  };
  return known[value] || value.match(/\((.*?)\)/)?.[0] || value.match(/\b[A-Z]{2,}\b/g)?.join("") || value;
}

function isDeclaredWinner(value: string) {
  return /\b(won|result\s+declared|declared)\b/i.test(value);
}

function formatIndianNumber(value: number) {
  return new Intl.NumberFormat("en-IN").format(value || 0);
}

function initials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function clampText(value: string, limit: number) {
  return value.length > limit ? `${value.slice(0, Math.max(1, limit - 1))}…` : value;
}

function fitSvgFontSize(text: string, maxWidth: number, start: number, min: number, widthFactor: number) {
  let size = start;
  while (size > min && approximateTextWidth(text, size, widthFactor) > maxWidth) {
    size -= 2;
  }
  return size;
}

function approximateTextWidth(text: string, fontSize: number, widthFactor: number) {
  return text.length * fontSize * widthFactor;
}

function fitConstituencyFontSize(value: string) {
  if (value.length <= 8) return 108;
  if (value.length <= 12) return 92;
  if (value.length <= 16) return 78;
  if (value.length <= 20) return 64;
  return 56;
}

function fitPartyFontSize(value: string) {
  if (value.length <= 4) return 58;
  if (value.length <= 7) return 42;
  return 34;
}

function fitStatusFontSize(value: string) {
  if (value.length <= 16) return 26;
  if (value.length <= 20) return 22;
  return 18;
}

function wrapTwoLines(value: string, limit: number) {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= limit || !current) {
      current = next;
    } else {
      lines.push(current);
      current = word;
      if (lines.length === 1) break;
    }
  }
  if (lines.length < 2 && current) lines.push(current);
  const output = lines.slice(0, 2);
  if (!output.length) return [clampText(value, limit)];
  if (output.length === 2 && words.join(" ").length > output.join(" ").length) {
    output[1] = clampText(output[1], limit);
  }
  return output;
}
