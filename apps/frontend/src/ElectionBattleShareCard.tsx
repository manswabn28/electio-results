import type { ReactNode } from "react";
import { Crown, MapPin, ShieldCheck, Zap } from "lucide-react";

export type ElectionBattleShareCardProps = {
  electionTitle: string;
  constituencyName: string;
  updatedTime: string;
  leftParty: string;
  leftPartyColor?: string;
  rightParty: string;
  rightPartyColor?: string;
  leftCandidateName: string;
  rightCandidateName: string;
  leftVotes: number;
  rightVotes: number;
  leadingSide: "left" | "right";
  leadMargin: number;
  statusText: string;
  roundsCounted: number;
  totalRounds: number;
  websiteUrl: string;
  dataSourceText: string;
  leftCandidatePhoto?: string;
  rightCandidatePhoto?: string;
  logoUrl?: string;
  animated?: boolean;
  className?: string;
  previewScale?: number;
};

const CANVAS_SIZE = 1080;

export function ElectionBattleShareCard({
  animated = true,
  className = "",
  previewScale = 0.36,
  ...props
}: ElectionBattleShareCardProps) {
  const totalRounds = Math.max(1, props.totalRounds || 1);
  const countedRounds = Math.max(0, Math.min(props.roundsCounted || 0, totalRounds));
  const leftLeading = props.leadingSide === "left";
  const countingCompleted = totalRounds > 0 && countedRounds >= totalRounds;
  const resultDeclared = countingCompleted || /\b(won|winner|result\s+declared|declared)\b/i.test(props.statusText);
  const leftGlow = cssColorToRgba(props.leftPartyColor, 0.42, "rgba(255,30,30,0.46)");
  const rightGlow = cssColorToRgba(props.rightPartyColor, 0.38, "rgba(0,210,90,0.38)");
  const constituency = clampText(props.constituencyName.toUpperCase(), 20);
  const constituencySize = fitConstituencyFontSize(constituency);
  const electionTitle = props.electionTitle.toUpperCase();
  const statusText = clampText(props.statusText.toUpperCase(), 24);
  const titleLines = wrapTitleLines(electionTitle, 22, 2);
  const titleSize = fitElectionTitleFontSize(electionTitle);

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
              backgroundImage: `radial-gradient(circle at 50% 0%, rgba(30,80,220,0.2), transparent 33%), radial-gradient(circle at 0% 35%, ${leftGlow}, transparent 38%), radial-gradient(circle at 100% 35%, ${rightGlow}, transparent 36%), linear-gradient(180deg, #050c17 0%, #02060e 55%, #02040a 100%)`
            }}
          />
          <div className="absolute inset-0 bg-[linear-gradient(130deg,rgba(255,255,255,0.06),transparent_20%,transparent_80%,rgba(255,255,255,0.04))]" />
          <div className="absolute left-[530px] top-[335px] h-[310px] w-[16px] -translate-x-1/2 rotate-[18deg] bg-gradient-to-b from-transparent via-cyan-300 to-transparent opacity-90 blur-[2px]" />
          <div className={`absolute left-[500px] top-[460px] h-[32px] w-[90px] rounded-full bg-cyan-300/20 blur-2xl ${animated ? "animate-pulse" : ""}`} />

          <Zone x={28} y={24} w={138} h={55}>
            <div className={`flex h-full items-center gap-3 rounded-[12px] border border-red-400/40 bg-red-600 px-4 text-[22px] font-black uppercase shadow-[0_12px_30px_rgba(220,38,38,0.35)] ${animated ? "animate-pulse" : ""}`}>
              <span className="h-4 w-4 rounded-full bg-white" />
              LIVE
            </div>
          </Zone>

          <Zone x={280} y={22} w={520} h={60}>
            <div className="flex h-full items-center justify-center gap-5">
              <span className="h-px w-16 bg-white/18" />
              <div
                className="max-w-[420px] text-center font-black uppercase leading-[1.05] tracking-[0.24em] text-white/90"
                style={{ fontSize: titleSize }}
                title={props.electionTitle}
              >
                {titleLines.map((line) => (
                  <div key={line}>{line}</div>
                ))}
              </div>
              <span className="h-px w-16 bg-white/18" />
            </div>
          </Zone>

          <Zone x={890} y={28} w={162} h={50}>
            <div className="text-right">
              <div className="truncate text-[24px] font-black leading-none">{props.updatedTime}</div>
              <div className="mt-1 text-[18px] font-black uppercase leading-none text-yellow-300">LIVE UPDATE</div>
            </div>
          </Zone>

          <Zone x={430} y={110} w={220} h={28}>
            <div className="flex h-full items-center justify-center gap-3 text-yellow-300">
              <span className="h-px w-14 bg-white/18" />
              <MapPin className="h-6 w-6 fill-current" />
              <span className="h-px w-14 bg-white/18" />
            </div>
          </Zone>

          <Zone x={110} y={145} w={860} h={120}>
            <div
              className="flex h-full items-center justify-center text-center font-black uppercase leading-[0.9] tracking-tight text-white drop-shadow-[0_8px_20px_rgba(0,0,0,0.88)]"
              style={{ fontSize: constituencySize, fontFamily: "Inter, Arial, sans-serif" }}
              title={props.constituencyName}
            >
              {constituency}
            </div>
          </Zone>

          <Zone x={325} y={278} w={430} h={54}>
            <div className="relative flex h-full items-center justify-center overflow-hidden rounded-[6px] border border-yellow-400/65 bg-yellow-400 text-[#09111d] shadow-[0_12px_28px_rgba(234,179,8,0.28)]">
              {animated ? <div className="absolute inset-y-0 left-[-90px] w-[110px] -skew-x-12 bg-white/35 blur-sm animate-pulse" /> : null}
              <Zap className="relative z-10 mr-4 h-8 w-8 fill-current" />
              <span className="relative z-10 whitespace-nowrap text-[26px] font-black uppercase italic">NAIL-BITING BATTLE</span>
              <Zap className="relative z-10 ml-4 h-8 w-8 fill-current" />
            </div>
          </Zone>

          <CandidateZone
            x={32}
            y={345}
            w={320}
            h={395}
            party={props.leftParty}
            partyColor={props.leftPartyColor}
            candidate={props.leftCandidateName}
            votes={props.leftVotes}
            photoUrl={props.leftCandidatePhoto}
            leading={leftLeading}
            won={resultDeclared && leftLeading}
            tone="left"
            animated={animated}
          />

          <Zone x={370} y={365} w={340} h={360}>
            <div className="relative h-full w-full">
              <div className={`absolute left-1/2 top-[118px] -translate-x-1/2 text-center text-[88px] font-black italic leading-none text-white drop-shadow-[0_0_18px_rgba(103,232,249,0.58)] ${animated ? "animate-pulse" : ""}`}>VS</div>
              <LeadMarginPanel margin={props.leadMargin} won={resultDeclared} />
            </div>
          </Zone>

          <CandidateZone
            x={728}
            y={345}
            w={320}
            h={395}
            party={props.rightParty}
            partyColor={props.rightPartyColor}
            candidate={props.rightCandidateName}
            votes={props.rightVotes}
            photoUrl={props.rightCandidatePhoto}
            leading={!leftLeading}
            won={resultDeclared && !leftLeading}
            tone="right"
            align="right"
            animated={animated}
          />

          <Zone x={310} y={760} w={460} h={70}>
            <div className="relative flex h-full items-center justify-center rounded-full border-[3px] border-yellow-400/80 bg-[#06101d] px-8 text-center shadow-[0_0_0_1px_rgba(234,179,8,0.18),0_12px_30px_rgba(0,0,0,0.32)]">
              <span className="absolute left-[-18px] top-1/2 h-5 w-5 -translate-y-1/2 border-l-4 border-t-4 border-yellow-300/90" />
              <span className="absolute right-[-18px] top-1/2 h-5 w-5 -translate-y-1/2 border-r-4 border-t-4 border-yellow-300/90" />
              <div className="w-full overflow-hidden">
                <div className="text-[17px] font-black uppercase tracking-[0.24em] text-white/80">STATUS</div>
                <div
                  className="mt-1 truncate font-black uppercase leading-none text-yellow-300"
                  style={{ fontSize: fitStatusFontSize(statusText) }}
                  title={statusText}
                >
                  {statusText}
                </div>
              </div>
            </div>
          </Zone>

          <Zone x={64} y={850} w={952} h={98}>
            <div className="h-full rounded-[16px] border border-white/18 bg-white/[0.045] px-5 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
              <div className="flex h-full items-center gap-4">
                <div className="min-w-0 flex-1">
                  <div className="mb-3 text-[20px] font-black uppercase tracking-[0.12em] text-white/82">
                    {countingCompleted ? "COUNTING COMPLETED" : "COUNTING PROGRESS"}
                  </div>
                  <div className="flex h-[26px] items-center gap-[6px] overflow-hidden">
                    {Array.from({ length: totalRounds }).map((_, index) => (
                      <div
                        key={index}
                        className={`h-[26px] min-w-0 flex-1 rounded-[4px] border ${index < countedRounds
                          ? countingCompleted
                            ? "border-emerald-500/80 bg-gradient-to-b from-emerald-400 to-emerald-600 shadow-[0_0_10px_rgba(16,185,129,0.28)]"
                            : "border-red-500/75 bg-gradient-to-b from-red-400 to-red-600 shadow-[0_0_10px_rgba(239,68,68,0.28)]"
                          : "border-white/14 bg-white/92"}`}
                      />
                    ))}
                  </div>
                </div>
                <div className="w-[120px] shrink-0 text-right">
                  <div className="text-[30px] font-black leading-none text-white">{countedRounds}/{totalRounds}</div>
                  <div className="mt-1 text-[18px] font-black uppercase tracking-[0.12em] text-white/72">ROUNDS</div>
                </div>
              </div>
            </div>
          </Zone>

          <Zone x={40} y={970} w={1000} h={75}>
            <div className="flex h-full items-end justify-between gap-6">
              <div className="flex min-w-0 items-center gap-4">
                <div className="flex h-[52px] w-[52px] shrink-0 items-center justify-center overflow-hidden rounded-full border border-cyan-300/30 bg-[#0a1730] shadow-[0_0_24px_rgba(34,211,238,0.18)]">
                  {props.logoUrl ? (
                    <img alt="Logo" className="h-full w-full object-cover" crossOrigin="anonymous" referrerPolicy="no-referrer" src={props.logoUrl} />
                  ) : (
                    <span className="text-[16px] font-black uppercase text-cyan-200">OK</span>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-[18px] font-black uppercase tracking-[0.12em] text-white/78">TRACK YOUR CONSTITUENCY LIVE</div>
                  <div className="mt-1 max-w-[320px] truncate text-[18px] font-black text-yellow-300">{props.websiteUrl}</div>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="flex items-center justify-end gap-2 text-[18px] font-black uppercase tracking-[0.08em] text-white/86">
                  <ShieldCheck className="h-5 w-5 text-emerald-300" />
                  <span>FAST. ACCURATE. OFFICIAL.</span>
                </div>
                <div className="mt-1 text-[16px] font-semibold uppercase tracking-[0.06em] text-white/58">POWERED BY {props.dataSourceText}</div>
              </div>
            </div>
          </Zone>
        </div>
      </div>
    </div>
  );
}

function CandidateZone({
  x,
  y,
  w,
  h,
  party,
  partyColor,
  candidate,
  votes,
  photoUrl,
  leading,
  won,
  tone,
  align = "left",
  animated
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  party: string;
  partyColor?: string;
  candidate: string;
  votes: number;
  photoUrl?: string;
  leading: boolean;
  won?: boolean;
  tone: "left" | "right";
  align?: "left" | "right";
  animated: boolean;
}) {
  const partyCode = clampText(party.toUpperCase(), 9);
  const candidateLines = wrapTwoLines(candidate.toUpperCase(), 18);
  const partySize = fitPartyFontSize(partyCode);
  const voteText = formatIndianNumber(votes);
  const accentColor = partyColor || (tone === "left" ? "#dc2626" : "#10b981");
  const borderColor = cssColorToRgba(accentColor, 0.82, tone === "left" ? "rgba(239,68,68,0.82)" : "rgba(16,185,129,0.82)");
  const badgeColor = cssColorToRgba(accentColor, 0.95, tone === "left" ? "rgba(220,38,38,0.95)" : "rgba(5,150,105,0.95)");
  const underlineColor = cssColorToRgba(accentColor, 0.96, tone === "left" ? "rgba(248,113,113,0.96)" : "rgba(52,211,153,0.96)");
  const radialColor = cssColorToRgba(accentColor, 0.52, tone === "left" ? "rgba(220,38,38,0.52)" : "rgba(16,185,129,0.52)");
  const topBandColor = cssColorToRgba(accentColor, 0.38, tone === "left" ? "rgba(220,38,38,0.38)" : "rgba(16,185,129,0.38)");
  const cardBackground = `linear-gradient(180deg, rgba(5,9,20,0.22), rgba(2,5,12,0.92) 52%, rgba(2,4,10,0.98) 100%), radial-gradient(circle at ${align === "right" ? "85%" : "15%"} 8%, ${radialColor}, transparent 40%), linear-gradient(180deg, ${topBandColor}, rgba(4,8,16,0.2) 34%, rgba(3,7,14,0.94) 100%)`;

  return (
    <Zone x={x} y={y} w={w} h={h}>
      <div
        className={`relative h-full overflow-hidden rounded-[20px] border px-6 py-5 ${animated ? "transition-transform duration-300 hover:scale-[1.01]" : ""}`}
        style={{
          borderColor,
          backgroundImage: cardBackground,
          boxShadow: `inset 0 1px 0 rgba(255,255,255,0.05), 0 18px 40px rgba(0,0,0,0.28), 0 0 34px ${cssColorToRgba(accentColor, 0.14, "rgba(255,255,255,0.12)")}`
        }}
      >
        <div className={`absolute inset-0 bg-[linear-gradient(140deg,rgba(255,255,255,0.08),transparent_34%,transparent)] ${align === "right" ? "scale-x-[-1]" : ""}`} />
        {leading ? (
          <div
            className="absolute left-6 top-[205px] rounded-[8px] px-4 py-2 text-[24px] font-black uppercase text-white"
            style={{ backgroundColor: badgeColor }}
          >
            {won ? "WON" : "LEADING"}
          </div>
        ) : null}
        <div className={`absolute top-[18px] h-[190px] w-[190px] overflow-hidden rounded-[22px] border border-white/15 bg-black/20 ${align === "right" ? "right-[65px]" : "left-[65px]"}`}>
          {photoUrl ? (
            <img alt={candidate} className="h-full w-full object-cover" crossOrigin="anonymous" referrerPolicy="no-referrer" src={photoUrl} />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-white/10 text-[54px] font-black text-white/90">
              {initials(candidate)}
            </div>
          )}
        </div>
        {won ? (
          <div
            className={`absolute top-[12px] z-10 flex h-[42px] w-[42px] items-center justify-center rounded-full border border-yellow-300/80 bg-yellow-400 text-yellow-950 shadow-[0_10px_24px_rgba(234,179,8,0.35)] ${align === "right" ? "right-[36px]" : "left-[36px]"}`}
          >
            <Crown className="h-6 w-6 fill-current" />
          </div>
        ) : null}
        <div className={`absolute left-[30px] top-[242px] w-[260px] overflow-hidden ${align === "right" ? "text-right" : "text-left"}`}>
          <div className="truncate font-black uppercase leading-none text-white" style={{ fontSize: partySize }}>
            {partyCode}
          </div>
          <div className="mt-2 h-[48px] overflow-hidden text-[21px] font-bold uppercase leading-[1.06] tracking-wide text-white/90">
            {candidateLines.map((line) => (
              <div key={line} className={align === "right" ? "text-right" : "text-left"}>{line}</div>
            ))}
          </div>
          <div className="mt-1 truncate text-[21px] font-bold leading-tight tracking-wide text-white">{voteText}</div>
          <div className={`mt-1.5 h-[6px] w-[64px] rounded-full ${align === "right" ? "ml-auto" : ""}`} style={{ backgroundColor: underlineColor }} />
        </div>
      </div>
    </Zone>
  );
}

function LeadMarginPanel({ margin, won = false }: { margin: number; won?: boolean }) {
  const marginText = `+${formatIndianNumber(margin)}`;
  return (
    <div className="absolute left-0 top-[225px] h-[135px] w-[340px] rounded-[22px] border border-yellow-400/80 bg-[#08121f] px-4 py-4 text-center shadow-[0_0_24px_rgba(234,179,8,0.18)]">
      <div className="absolute inset-[12px] rounded-[16px] border border-dashed border-yellow-400/50" />
      <div className="relative text-[20px] font-black uppercase tracking-[0.16em] text-yellow-100">{won ? "WON MARGIN" : "LEAD MARGIN"}</div>
      <div className="relative mt-2 truncate text-[64px] font-black leading-none text-yellow-300">{marginText}</div>
      <div className="relative mt-2 text-[24px] font-black uppercase tracking-[0.18em] text-white/78">VOTES</div>
    </div>
  );
}

function Zone({
  x,
  y,
  w,
  h,
  children
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  children: ReactNode;
}) {
  return (
    <div className="absolute" style={{ left: x, top: y, width: w, height: h }}>
      {children}
    </div>
  );
}

function fitConstituencyFontSize(value: string) {
  if (value.length <= 8) return 108;
  if (value.length <= 12) return 92;
  if (value.length <= 16) return 78;
  if (value.length <= 20) return 64;
  return 56;
}

function fitElectionTitleFontSize(value: string) {
  if (value.length <= 22) return 20;
  if (value.length <= 34) return 18;
  return 16;
}

function fitPartyFontSize(value: string) {
  if (value.length <= 4) return 58;
  if (value.length <= 7) return 42;
  return 34;
}

function wrapTitleLines(value: string, limit: number, maxLines: number) {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= limit || !current) {
      current = next;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length === maxLines - 1) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  const output = lines.slice(0, maxLines);
  if (!output.length) return [value];
  const original = words.join(" ");
  const used = output.join(" ");
  if (used.length < original.length) {
    output[output.length - 1] = clampText(output[output.length - 1], limit);
  }
  return output;
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

function clampText(value: string, limit: number) {
  return value.length > limit ? `${value.slice(0, Math.max(1, limit - 3))}...` : value;
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

function formatIndianNumber(value: number) {
  return new Intl.NumberFormat("en-IN").format(value || 0);
}

function cssColorToRgba(color: string | undefined, alpha: number, fallback: string) {
  if (!color) return fallback;
  const value = color.trim();
  const hexMatch = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hexMatch) {
    const raw = hexMatch[1];
    const full = raw.length === 3 ? raw.split("").map((part) => `${part}${part}`).join("") : raw;
    const red = parseInt(full.slice(0, 2), 16);
    const green = parseInt(full.slice(2, 4), 16);
    const blue = parseInt(full.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }
  const rgbMatch = value.match(/^rgba?\(([^)]+)\)$/i);
  if (rgbMatch) {
    const [red, green, blue] = rgbMatch[1].split(",").map((part) => Number(part.trim())).slice(0, 3);
    if ([red, green, blue].every((part) => Number.isFinite(part))) {
      return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
    }
  }
  return fallback;
}

export function ElectionBattleShareCardExample() {
  return (
    <ElectionBattleShareCard
      electionTitle="KERALA ELECTION 2026"
      constituencyName="AGIAON"
      updatedTime="10:42 AM"
      leftParty="BJP"
      leftPartyColor="#f59e0b"
      rightParty="CPI(ML)L"
      rightPartyColor="#be123c"
      leftCandidateName="MAHESH PASWAN"
      rightCandidateName="SHIV PRAKASH RANJAN"
      leftVotes={69412}
      rightVotes={69317}
      leadingSide="left"
      leadMargin={95}
      statusText="WINNER DECLARED"
      roundsCounted={26}
      totalRounds={26}
      websiteUrl="results.onekeralam.in"
      dataSourceText="Onekeralam.in"
      animated
    />
  );
}
