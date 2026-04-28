import type { ReactNode } from "react";
import type { PartySeatSummary, ConstituencySummary } from "@kerala-election/shared";
import { Crown, ShieldCheck, Trophy } from "lucide-react";

const CANVAS_SIZE = 1080;

export function StatewideTallyShareCard({
  electionTitle,
  label,
  assemblySize,
  leadingPartyCode,
  leadingPartyName,
  runnerUpPartyCode,
  runnerUpPartyName,
  parties,
  websiteUrl,
  brandName,
  animated = true,
  previewScale = 0.36,
  className = ""
}: {
  electionTitle: string;
  label: string;
  assemblySize: number;
  leadingPartyCode: string;
  leadingPartyName: string;
  runnerUpPartyCode: string;
  runnerUpPartyName: string;
  parties: Array<{
    partyCode: string;
    partyName: string;
    total: number;
    won: number;
    lead: number;
    color: string;
  }>;
  websiteUrl: string;
  brandName: string;
  animated?: boolean;
  previewScale?: number;
  className?: string;
}) {
  const primary = parties[0]?.color ?? "#ff8a3d";
  const secondary = parties[1]?.color ?? "#31b65b";
  const titleLines = splitTitleLines(electionTitle.toUpperCase(), 22);
  const titleFontSize = fitFinalTitleSize(titleLines);
  const visibleRows = parties.slice(0, 6);
  const displayLeadingName = cleanPartyDisplayName(leadingPartyName);
  const displayRunnerName = cleanPartyDisplayName(runnerUpPartyName);
  const leadingCode = normalizeDisplayPartyCode(leadingPartyCode || displayLeadingName);
  const runnerCode = normalizeDisplayPartyCode(runnerUpPartyCode || displayRunnerName);

  return (
    <FixedCardShell previewScale={previewScale} className={className} primary={primary} secondary={secondary}>
      <Zone x={56} y={56} w={968} h={170}>
        <div className={`text-[20px] font-black uppercase tracking-[0.32em] text-white/88 ${animated ? "animate-pulse" : ""}`}>{label.toUpperCase()}</div>
        <div className="mt-6 max-w-[860px] text-white">
          {titleLines.map((line, index) => (
            <div key={`${line}-${index}`} className="font-black uppercase leading-[0.92]" style={{ fontSize: titleFontSize }}>
              {line}
            </div>
          ))}
        </div>
      </Zone>

      <Zone x={56} y={245} w={968} h={125}>
        <div className="grid h-full grid-cols-3 gap-[18px]">
          <SummaryTopCard label="Assembly Size" value={formatIndianNumber(assemblySize)} accent="#f8fafc" />
          <SummaryTopCard label="Leading Party" value={leadingCode} sub={displayLeadingName} accent={primary} />
          <SummaryTopCard label="Runner-up" value={runnerCode} sub={displayRunnerName} accent={secondary} />
        </div>
      </Zone>

      <Zone x={56} y={400} w={968} h={505}>
        <div className="space-y-3">
          {visibleRows.map((party, index) => (
            <SummaryPartyRow
              key={`${party.partyCode}-${index}`}
              partyCode={party.partyCode}
              partyName={party.partyName}
              total={party.total}
              won={party.won}
              lead={party.lead}
              color={party.color}
              animated={animated}
              styleDelay={index}
            />
          ))}
        </div>
      </Zone>

      <FinalFooter websiteUrl={websiteUrl} brandName={brandName} />
    </FixedCardShell>
  );
}

export function PartySummaryShareCard({
  electionTitle,
  parties,
  previewScale = 0.36,
  className = "",
  animated = true
}: {
  electionTitle: string;
  parties: PartySeatSummary[];
  previewScale?: number;
  className?: string;
  animated?: boolean;
}) {
  const topParties = parties.slice(0, 6).map((party) => ({
    partyCode: shortPartyName(party.party),
    partyName: party.party,
    total: party.total,
    won: party.won,
    lead: party.leading,
    color: party.color ?? "#64748b"
  }));
  return (
    <StatewideTallyShareCard
      electionTitle={electionTitle}
      label="Statewide Tally"
      assemblySize={parties.reduce((sum, party) => sum + party.total, 0)}
      leadingPartyCode={shortPartyName(parties[0]?.party || "-")}
      leadingPartyName={parties[0]?.party || "-"}
      runnerUpPartyCode={shortPartyName(parties[1]?.party || "-")}
      runnerUpPartyName={parties[1]?.party || "-"}
      parties={topParties}
      websiteUrl="results.onekeralam.in"
      brandName="OneKerala Results"
      animated={animated}
      previewScale={previewScale}
      className={className}
    />
  );
}

export function FinalResultShareCard({
  electionTitle,
  resultLabel,
  winnerPartyName,
  winnerPartyCode,
  winnerSeats,
  majorityMark,
  leadSeats,
  runnerUpPartyCode,
  assemblySize,
  closestConstituency,
  closestPartyCode,
  closestMargin,
  biggestMarginConstituency,
  biggestMarginPartyCode,
  biggestMargin,
  websiteUrl,
  brandName,
  animated = true,
  previewScale = 0.36,
  className = ""
}: {
  electionTitle: string;
  resultLabel: string;
  winnerPartyName: string;
  winnerPartyCode: string;
  winnerSeats: number;
  majorityMark: number;
  leadSeats: number;
  runnerUpPartyCode: string;
  assemblySize: number;
  closestConstituency: string;
  closestPartyCode: string;
  closestMargin: number;
  biggestMarginConstituency: string;
  biggestMarginPartyCode: string;
  biggestMargin: number;
  websiteUrl: string;
  brandName: string;
  animated?: boolean;
  previewScale?: number;
  className?: string;
}) {
  const winnerColor = "#ff9b4a";
  const secondaryGlow = "#16a34a";
  const titleLines = splitTitleLines(electionTitle.toUpperCase(), 28);
  const titleFontSize = fitFinalTitleSize(titleLines);
  const displayWinnerName = cleanPartyDisplayName(winnerPartyName);
  const displayWinnerCode = normalizeDisplayPartyCode(winnerPartyCode || displayWinnerName);
  const displayRunnerCode = normalizeDisplayPartyCode(runnerUpPartyCode);
  const winnerBadgeText = `${displayWinnerName} - ${displayWinnerCode}`;
  const winnerBadgeSize = fitWinnerBadgeSize(winnerBadgeText);

  return (
    <FixedCardShell previewScale={previewScale} className={className} primary={winnerColor} secondary={secondaryGlow}>
      <Zone x={56} y={56} w={968} h={140}>
        <div className={`inline-flex items-center gap-3 text-[20px] font-black uppercase tracking-[0.28em] text-yellow-300 ${animated ? "animate-pulse" : ""}`}>
          <Trophy className="h-6 w-6 fill-current" />
          {resultLabel.toUpperCase()}
        </div>
        <div className="mt-5 max-w-[820px] text-white">
          {titleLines.map((line, index) => (
            <div
              key={`${line}-${index}`}
              className="font-black uppercase leading-[0.96] text-white/92"
              style={{ fontSize: titleFontSize }}
            >
              {line}
            </div>
          ))}
        </div>
      </Zone>

      <Zone x={56} y={230} w={968} h={300}>
        <div className="relative h-full overflow-hidden rounded-[28px] border border-white/14 bg-[rgba(8,18,31,0.88)] px-8 py-7 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_30px_80px_rgba(0,0,0,0.35)]">
          <div className="absolute inset-0 bg-[linear-gradient(130deg,rgba(255,255,255,0.05),transparent_24%,transparent_82%,rgba(255,255,255,0.03))]" />
          <div className={`relative flex h-full gap-8 ${animated ? "animate-summary-refresh" : ""}`}>
            <div className="w-[610px] min-w-0">
              <div className="text-[14px] font-black uppercase tracking-[0.2em] text-white/58">Winning party</div>
              <div className="mt-6 inline-flex max-w-[590px] items-center gap-3 rounded-full border border-amber-300/22 bg-amber-300/10 px-5 py-3.5">
                <Crown className="h-6 w-6 shrink-0 fill-current text-amber-200" />
                <span
                  className="truncate font-black text-amber-100"
                  style={{ fontSize: winnerBadgeSize }}
                  title={winnerBadgeText}
                >
                  {winnerBadgeText}
                </span>
              </div>
              <div className="mt-7 flex items-end gap-3 leading-none">
                <div className="text-[84px] font-black" style={{ color: winnerColor }}>
                  {formatIndianNumber(winnerSeats)}
                </div>
                <div className="pb-2 text-[28px] font-black uppercase tracking-[0.12em] text-white/88">
                  Seats
                </div>
              </div>
              <div className="mt-3 text-[24px] font-semibold text-white/72">Crosses the finish line</div>
            </div>

            <div className="grid w-[318px] grid-cols-2 gap-4">
              <FinalStatCard label="Majority Mark" value={formatIndianNumber(majorityMark)} accent="#f8fafc" />
              <FinalStatCard label="Lead" value={formatIndianNumber(leadSeats)} accent="#facc15" />
              <FinalStatCard label="Runner-up" value={displayRunnerCode} accent="#22c55e" />
              <FinalStatCard label="Assembly Size" value={formatIndianNumber(assemblySize)} accent="#f8fafc" />
            </div>
          </div>
        </div>
      </Zone>

      <Zone x={56} y={560} w={968} h={285}>
        <div className="grid h-full grid-cols-3 gap-[17px]">
          <FinalInsightCard
            title="Winning Seats"
            value={formatIndianNumber(winnerSeats)}
            sub={`${winnerPartyCode} secures the highest number of seats`}
            accent={winnerColor}
          />
          <FinalInsightCard
            title="Closest Result"
            value={closestConstituency.toUpperCase()}
            sub={`${closestPartyCode} by ${formatIndianNumber(closestMargin)} votes`}
            accent="#facc15"
          />
          <FinalInsightCard
            title="Biggest Margin"
            value={biggestMarginConstituency.toUpperCase()}
            sub={`${biggestMarginPartyCode} by ${formatIndianNumber(biggestMargin)} votes`}
            accent={winnerColor}
          />
        </div>
      </Zone>

      <FinalFooter websiteUrl={websiteUrl} brandName={brandName} />
    </FixedCardShell>
  );
}

export function FinalVictoryShareCard({
  outcome,
  previewScale = 0.36,
  className = "",
  animated = true
}: {
  outcome: {
    winner: PartySeatSummary;
    runnerUp?: PartySeatSummary;
    totalSeats: number;
    majorityMark: number;
    seatLead: number;
    closest?: ConstituencySummary;
    biggest?: ConstituencySummary;
    electionTitle: string;
  };
  previewScale?: number;
  className?: string;
  animated?: boolean;
}) {
  return (
    <FinalResultShareCard
      electionTitle={outcome.electionTitle}
      resultLabel="Final Result"
      winnerPartyName={outcome.winner.party}
      winnerPartyCode={shortPartyName(outcome.winner.party)}
      winnerSeats={outcome.winner.total}
      majorityMark={outcome.majorityMark}
      leadSeats={outcome.seatLead}
      runnerUpPartyCode={shortPartyName(outcome.runnerUp?.party || "-")}
      assemblySize={outcome.totalSeats}
      closestConstituency={outcome.closest?.constituencyName || "-"}
      closestPartyCode={shortPartyName(outcome.closest?.leadingParty || "-")}
      closestMargin={outcome.closest?.margin || 0}
      biggestMarginConstituency={outcome.biggest?.constituencyName || "-"}
      biggestMarginPartyCode={shortPartyName(outcome.biggest?.leadingParty || "-")}
      biggestMargin={outcome.biggest?.margin || 0}
      websiteUrl="results.onekeralam.in"
      brandName="OneKerala Results"
      animated={animated}
      previewScale={previewScale}
      className={className}
    />
  );
}

function FixedCardShell({
  previewScale,
  className,
  primary,
  secondary,
  children
}: {
  previewScale: number;
  className: string;
  primary: string;
  secondary: string;
  children: ReactNode;
}) {
  return (
    <div className={`mx-auto ${className}`} style={{ width: CANVAS_SIZE * previewScale }}>
      <div style={{ height: CANVAS_SIZE * previewScale }} className="relative overflow-hidden rounded-[18px]">
        <div
          className="absolute left-0 top-0 origin-top-left overflow-hidden rounded-[18px] border border-white/10 bg-[#040914] text-white shadow-[0_40px_120px_rgba(0,0,0,0.65)]"
          style={{
            width: CANVAS_SIZE,
            height: CANVAS_SIZE,
            transform: `scale(${previewScale})`
          }}
        >
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: `radial-gradient(circle at 50% 0%, rgba(30,80,220,0.2), transparent 33%), radial-gradient(circle at 0% 35%, ${toRgba(primary, 0.38)}, transparent 38%), radial-gradient(circle at 100% 35%, ${toRgba(secondary, 0.32)}, transparent 36%), linear-gradient(180deg, #050c17 0%, #02060e 55%, #02040a 100%)`
            }}
          />
          <div className="absolute inset-0 bg-[linear-gradient(130deg,rgba(255,255,255,0.06),transparent_20%,transparent_80%,rgba(255,255,255,0.04))]" />
          {children}
        </div>
      </div>
    </div>
  );
}

function Zone({ x, y, w, h, children }: { x: number; y: number; w: number; h: number; children: ReactNode }) {
  return <div className="absolute" style={{ left: x, top: y, width: w, height: h }}>{children}</div>;
}

function StatCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-[22px] border border-white/10 bg-[rgba(8,18,31,0.88)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="text-[16px] font-black uppercase tracking-[0.14em] text-white/58">{label}</div>
      <div className="mt-4 truncate text-[42px] font-black leading-none" style={{ color: accent }}>{value}</div>
    </div>
  );
}

function MetricColumn({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="w-[150px] text-right">
      <div className="text-[15px] font-black uppercase tracking-[0.14em] text-white/58">{label}</div>
      <div className="mt-3 text-[42px] font-black leading-none" style={{ color: accent }}>{value}</div>
    </div>
  );
}

function StoryCard({ title, value, sub, accent }: { title: string; value: string; sub: string; accent: string }) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-[rgba(8,18,31,0.88)] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="text-[16px] font-black uppercase tracking-[0.14em] text-white/58">{title}</div>
      <div className="mt-4 text-[38px] font-black leading-none" style={{ color: accent }}>{value}</div>
      <div className="mt-4 text-[20px] font-semibold leading-snug text-white/72">{sub}</div>
    </div>
  );
}

function FinalStatCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-[22px] border border-white/10 bg-[rgba(6,14,24,0.9)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="text-[14px] font-black uppercase tracking-[0.16em] leading-tight text-white/58">{label}</div>
      <div className="mt-4 truncate text-[38px] font-black leading-none" style={{ color: accent }}>{value}</div>
    </div>
  );
}

function SummaryTopCard({
  label,
  value,
  sub,
  accent
}: {
  label: string;
  value: string;
  sub?: string;
  accent: string;
}) {
  return (
    <div className="rounded-[22px] border border-white/10 bg-[rgba(8,18,31,0.88)] px-5 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="text-[14px] font-black uppercase tracking-[0.16em] text-white/58">{label}</div>
      <div className="mt-4 truncate text-[42px] font-black leading-none" style={{ color: accent }}>{value}</div>
      <div className="mt-2 truncate text-[15px] font-semibold text-white/58">{sub ?? "\u00A0"}</div>
    </div>
  );
}

function SummaryPartyRow({
  partyCode,
  partyName,
  total,
  won,
  lead,
  color,
  animated,
  styleDelay
}: {
  partyCode: string;
  partyName: string;
  total: number;
  won: number;
  lead: number;
  color: string;
  animated: boolean;
  styleDelay: number;
}) {
  return (
    <div
      className={`relative h-[72px] overflow-hidden rounded-[22px] border border-white/10 bg-[rgba(8,18,31,0.88)] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] ${animated ? "animate-party-card-refresh" : ""}`}
      style={animated ? { animationDelay: `${styleDelay * 120}ms` } : undefined}
    >
      <div className="absolute inset-y-0 left-0 w-2" style={{ backgroundColor: color }} />
      <div className="grid h-full grid-cols-[455px_1fr] items-center pl-[38px] pr-6">
        <div className="min-w-0">
          <div className="truncate text-[32px] font-black uppercase leading-none text-white">{partyCode}</div>
          <div className="mt-1 truncate text-[15px] font-semibold text-white/56" title={partyName}>{partyName}</div>
        </div>
        <div className="grid grid-cols-3">
          <SummaryMetricBlock label="Total" value={formatIndianNumber(total)} accent={color} />
          <SummaryMetricBlock label="Won" value={formatIndianNumber(won)} accent="#f8fafc" />
          <SummaryMetricBlock label="Lead" value={formatIndianNumber(lead)} accent="#facc15" />
        </div>
      </div>
    </div>
  );
}

function SummaryMetricBlock({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="w-[120px] text-center">
      <div className="text-[12px] font-black uppercase tracking-[0.14em] text-white/56">{label}</div>
      <div className="mt-2 text-[32px] font-black leading-none" style={{ color: accent }}>{value}</div>
    </div>
  );
}

function FinalInsightCard({ title, value, sub, accent }: { title: string; value: string; sub: string; accent: string }) {
  const valueLines = splitTitleLines(value, 14).slice(0, 2);
  const fontSize = value.length <= 10 ? 54 : value.length <= 16 ? 42 : 34;
  return (
    <div className="rounded-[24px] border border-white/10 bg-[rgba(8,18,31,0.88)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="text-[14px] font-black uppercase tracking-[0.16em] text-white/58">{title}</div>
      <div className="mt-5" style={{ color: accent }}>
        {valueLines.map((line, index) => (
          <div key={`${line}-${index}`} className="font-black leading-[0.92]" style={{ fontSize }}>
            {line}
          </div>
        ))}
      </div>
      <div className="mt-5 text-[22px] font-semibold leading-snug text-white/76">{sub}</div>
    </div>
  );
}

function FinalFooter({ websiteUrl, brandName }: { websiteUrl: string; brandName: string }) {
  return (
    <Zone x={56} y={925} w={968} h={90}>
      <div className="flex h-full items-end justify-between">
        <div>
          <div className="text-[18px] font-black uppercase tracking-[0.14em] text-white/74">Track your constituency live</div>
          <div className="mt-2 text-[22px] font-black text-yellow-300">{websiteUrl}</div>
        </div>
        <div className="text-right">
          <div className="flex items-center justify-end gap-2 text-[18px] font-black uppercase tracking-[0.08em] text-white/86">
            <ShieldCheck className="h-5 w-5 text-emerald-300" />
            <span>FAST. ACCURATE. OFFICIAL.</span>
          </div>
          <div className="mt-2 text-[16px] font-semibold uppercase tracking-[0.06em] text-white/58">POWERED BY {brandName.toUpperCase()}</div>
        </div>
      </div>
    </Zone>
  );
}

function shortPartyName(value: string) {
  const normalizedValue = cleanPartyDisplayName(value);
  const known: Record<string, string> = {
    "Bharatiya Janata Party": "BJP",
    "Janata Dal (United)": "JDU",
    "Rashtriya Janata Dal": "RJD",
    "Indian National Congress": "INC",
    "Communist Party of India": "CPI",
    "Communist Party of India (Marxist)": "CPM",
    "Communist Party of India (Marxist-Leninist) (Liberation)": "CPI(ML)L",
    "Communist Party of India (Marxist-Leninist) Liberation": "CPI(ML)L",
    "Lok Janshakti Party (Ram Vilas)": "LJPRV",
    "Indian Union Muslim League": "IUML",
    "All India Trinamool Congress": "TMC"
  };
  return known[normalizedValue] || normalizedValue;
}

function cleanPartyDisplayName(value: string) {
  const cleaned = (value || "").trim();
  if (!cleaned) return "-";
  const [first] = cleaned.split(/\s+-\s+/);
  return first.trim() || cleaned;
}

function normalizeDisplayPartyCode(value: string) {
  const compact = shortPartyName(value || "").trim();
  return compact
    .replace(/\(U\)/gi, "U")
    .replace(/[()\s.-]/g, "")
    .toUpperCase() || "-";
}

function formatIndianNumber(value: number) {
  return new Intl.NumberFormat("en-IN").format(value || 0);
}

function clampText(value: string, limit: number) {
  return value.length > limit ? `${value.slice(0, Math.max(1, limit - 3))}...` : value;
}

function fitWinnerBadgeSize(value: string) {
  if (value.length <= 22) return 32;
  if (value.length <= 34) return 28;
  return 24;
}

function fitFinalTitleSize(lines: string[]) {
  const longest = Math.max(...lines.map((line) => line.length), 0);
  if (longest <= 18) return 42;
  if (longest <= 26) return 36;
  return 32;
}

function splitTitleLines(value: string, limit: number) {
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
  if (current) lines.push(current);
  const result = lines.slice(0, 2);
  if (result.length === 2 && words.join(" ").length > result.join(" ").length) {
    result[1] = clampText(result[1], limit);
  }
  return result.length ? result : [clampText(value, limit)];
}

function toRgba(color: string, alpha: number) {
  const normalized = color.replace("#", "");
  if (normalized.length !== 6) return `rgba(15,23,42,${alpha})`;
  const value = Number.parseInt(normalized, 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}
