import type { ConstituencyResult, ConstituencySummary, ElectionTimelineEvent } from "@kerala-election/shared";

const MAX_CONSTITUENCY_EVENTS = 80;
const MAX_PROFILE_EVENTS = 120;

const constituencyTimelineByProfile = new Map<string, Map<string, ElectionTimelineEvent[]>>();
const profileTimelineByProfile = new Map<string, ElectionTimelineEvent[]>();

export function recordConstituencyRefresh(profileId: string, next: ConstituencyResult, previous?: ConstituencyResult): void {
  const timeline = getConstituencyTimelineBucket(profileId, next.constituencyId);
  const rounds = parseRoundProgress(next.roundStatus || next.statusText);
  const nextLeader = next.leadingCandidate || next.candidates[0]?.candidateName || "-";
  const nextParty = extractPartyCode(next.leadingParty || next.candidates[0]?.party || "-");
  const declared = isDeclared(next.statusText || next.roundStatus);
  const previousLeader = previous?.leadingCandidate || previous?.candidates[0]?.candidateName || "";
  const previousDeclared = previous ? isDeclared(previous.statusText || previous.roundStatus) : false;
  const now = next.lastUpdated || new Date().toISOString();

  if (!previous) {
    pushConstituencyEvent(profileId, next.constituencyId, {
      id: `${next.constituencyId}-counting-started-${Date.parse(now) || Date.now()}`,
      profileId,
      constituencyId: next.constituencyId,
      constituencyName: next.constituencyName,
      time: now,
      type: "counting-started",
      title: "Counting started",
      description: `${next.constituencyName} started reporting updates.`,
      candidateName: nextLeader,
      partyCode: nextParty,
      margin: next.margin,
      declared,
      roundsCounted: rounds?.current,
      totalRounds: rounds?.total,
      statusText: next.statusText || next.roundStatus,
      scope: "constituency"
    });
  }

  if (previous && previousLeader && normalizeValue(previousLeader) !== normalizeValue(nextLeader)) {
    pushConstituencyEvent(profileId, next.constituencyId, {
      id: `${next.constituencyId}-lead-change-${Date.parse(now) || Date.now()}`,
      profileId,
      constituencyId: next.constituencyId,
      constituencyName: next.constituencyName,
      time: now,
      type: "lead-change",
      title: `${nextParty} takes the lead`,
      description: `${nextLeader} moved ahead in ${next.constituencyName} by ${formatNumber(next.margin)} votes.`,
      candidateName: nextLeader,
      partyCode: nextParty,
      margin: next.margin,
      declared,
      roundsCounted: rounds?.current,
      totalRounds: rounds?.total,
      statusText: next.statusText || next.roundStatus,
      scope: "constituency"
    });
  }

  if (crossedTightRaceThreshold(previous?.margin, next.margin, 1000)) {
    pushConstituencyEvent(profileId, next.constituencyId, {
      id: `${next.constituencyId}-tight-race-${Date.parse(now) || Date.now()}`,
      profileId,
      constituencyId: next.constituencyId,
      constituencyName: next.constituencyName,
      time: now,
      type: "tight-race",
      title: "Alert lead",
      description: `Margin narrowed to ${formatNumber(next.margin)} votes.`,
      candidateName: nextLeader,
      partyCode: nextParty,
      margin: next.margin,
      declared,
      roundsCounted: rounds?.current,
      totalRounds: rounds?.total,
      statusText: next.statusText || next.roundStatus,
      scope: "constituency"
    });
  } else if (crossedTightRaceThreshold(previous?.margin, next.margin, 5000)) {
    pushConstituencyEvent(profileId, next.constituencyId, {
      id: `${next.constituencyId}-competitive-${Date.parse(now) || Date.now()}`,
      profileId,
      constituencyId: next.constituencyId,
      constituencyName: next.constituencyName,
      time: now,
      type: "tight-race",
      title: "Tight race",
      description: `${next.constituencyName} moved into a sub-${formatNumber(5000)} margin.`,
      candidateName: nextLeader,
      partyCode: nextParty,
      margin: next.margin,
      declared,
      roundsCounted: rounds?.current,
      totalRounds: rounds?.total,
      statusText: next.statusText || next.roundStatus,
      scope: "constituency"
    });
  }

  if (rounds && hasMeaningfulRoundProgress(previous?.roundStatus || previous?.statusText || "", rounds.current, rounds.total, declared)) {
    pushConstituencyEvent(profileId, next.constituencyId, {
      id: `${next.constituencyId}-round-progress-${Date.parse(now) || Date.now()}`,
      profileId,
      constituencyId: next.constituencyId,
      constituencyName: next.constituencyName,
      time: now,
      type: "milestone",
      title: declared ? "Counting completed" : "Counting progress",
      description: `${rounds.current}/${rounds.total} rounds counted.`,
      candidateName: nextLeader,
      partyCode: nextParty,
      margin: next.margin,
      declared,
      roundsCounted: rounds.current,
      totalRounds: rounds.total,
      statusText: next.statusText || next.roundStatus,
      scope: "constituency"
    });
  }

  if (declared && !previousDeclared) {
    pushConstituencyEvent(profileId, next.constituencyId, {
      id: `${next.constituencyId}-winner-${Date.parse(now) || Date.now()}`,
      profileId,
      constituencyId: next.constituencyId,
      constituencyName: next.constituencyName,
      time: now,
      type: "winner",
      title: `Winner declared: ${nextParty}`,
      description: `${nextLeader} won ${next.constituencyName} by ${formatNumber(next.margin)} votes.`,
      candidateName: nextLeader,
      partyCode: nextParty,
      margin: next.margin,
      declared: true,
      roundsCounted: rounds?.current,
      totalRounds: rounds?.total,
      statusText: next.statusText || next.roundStatus,
      scope: "constituency"
    });
  }

  trim(timeline, MAX_CONSTITUENCY_EVENTS);
}

export function recordSummaryRefresh(profileId: string, nextSummaries: ConstituencySummary[], previousSummaries?: ConstituencySummary[]): void {
  const profileTimeline = profileTimelineByProfile.get(profileId) ?? [];
  const previousById = new Map((previousSummaries ?? []).map((summary) => [summary.constituencyId, summary]));
  const nextById = new Map(nextSummaries.map((summary) => [summary.constituencyId, summary]));
  let leaderChanges = 0;
  let winners = 0;
  let newlyTight = 0;

  for (const summary of nextSummaries) {
    const previous = previousById.get(summary.constituencyId);
    if (!previous) continue;
    if (normalizeValue(previous.leadingCandidate) !== normalizeValue(summary.leadingCandidate)) leaderChanges += 1;
    if (!isDeclared(previous.statusText || previous.roundStatus) && isDeclared(summary.statusText || summary.roundStatus)) winners += 1;
    if (crossedTightRaceThreshold(previous.margin, summary.margin, 1000)) newlyTight += 1;
  }

  const stamp = new Date().toISOString();
  if (leaderChanges > 0) {
    profileTimeline.unshift({
      id: `${profileId}-leaders-${Date.now()}`,
      profileId,
      time: stamp,
      type: "lead-change",
      title: "Leader changed",
      description: `Leader changed in ${leaderChanges} seat${leaderChanges === 1 ? "" : "s"}.`,
      scope: "profile"
    });
  }
  if (winners > 0) {
    profileTimeline.unshift({
      id: `${profileId}-winners-${Date.now()}`,
      profileId,
      time: stamp,
      type: "winner",
      title: "New winners declared",
      description: `${winners} seat${winners === 1 ? "" : "s"} moved to final result.`,
      scope: "profile"
    });
  }
  if (newlyTight > 0) {
    profileTimeline.unshift({
      id: `${profileId}-tight-${Date.now()}`,
      profileId,
      time: stamp,
      type: "tight-race",
      title: "Fresh battleground update",
      description: `${newlyTight} seat${newlyTight === 1 ? "" : "s"} slipped under the alert margin.`,
      scope: "profile"
    });
  }

  profileTimelineByProfile.set(profileId, profileTimeline.slice(0, MAX_PROFILE_EVENTS));

  for (const [constituencyId] of nextById) {
    if (!constituencyTimelineByProfile.get(profileId)?.has(constituencyId)) continue;
  }
}

export function getConstituencyTimeline(profileId: string, constituencyId: string): ElectionTimelineEvent[] {
  return [...(constituencyTimelineByProfile.get(profileId)?.get(constituencyId) ?? [])];
}

export function getConstituencyTimelineBatch(profileId: string, constituencyIds: string[]): Record<string, ElectionTimelineEvent[]> {
  const profileMap = constituencyTimelineByProfile.get(profileId);
  return Object.fromEntries(constituencyIds.map((id) => [id, [...(profileMap?.get(id) ?? [])]]));
}

export function getProfileTimeline(profileId: string): ElectionTimelineEvent[] {
  return [...(profileTimelineByProfile.get(profileId) ?? [])];
}

function getConstituencyTimelineBucket(profileId: string, constituencyId: string) {
  let profileMap = constituencyTimelineByProfile.get(profileId);
  if (!profileMap) {
    profileMap = new Map<string, ElectionTimelineEvent[]>();
    constituencyTimelineByProfile.set(profileId, profileMap);
  }
  let timeline = profileMap.get(constituencyId);
  if (!timeline) {
    timeline = [];
    profileMap.set(constituencyId, timeline);
  }
  return timeline;
}

function pushConstituencyEvent(profileId: string, constituencyId: string, event: ElectionTimelineEvent) {
  const timeline = getConstituencyTimelineBucket(profileId, constituencyId);
  const existing = timeline[0];
  if (existing && existing.type === event.type && existing.description === event.description && existing.title === event.title) {
    return;
  }
  timeline.unshift(event);
}

function crossedTightRaceThreshold(previousMargin: number | undefined, nextMargin: number, threshold: number) {
  return typeof previousMargin === "number"
    ? previousMargin > threshold && nextMargin <= threshold
    : nextMargin <= threshold;
}

function hasMeaningfulRoundProgress(previousValue: string, current: number, total: number, declared: boolean) {
  const previous = parseRoundProgress(previousValue);
  if (!previous) return current > 0;
  if (declared && previous.current !== current) return true;
  const previousMark = roundMilestone(previous.current, previous.total);
  const nextMark = roundMilestone(current, total);
  return previousMark !== nextMark;
}

function roundMilestone(current: number, total: number) {
  if (total <= 0) return 0;
  if (current >= total) return 100;
  return Math.floor((current / total) * 4) * 25;
}

function parseRoundProgress(value: string) {
  const match = value.match(/(\d+)\s*\/\s*(\d+)/);
  if (!match) return undefined;
  const current = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) return undefined;
  return { current, total };
}

function isDeclared(value: string) {
  return /\b(won|result\s+declared|declared)\b/i.test(value);
}

function extractPartyCode(value: string) {
  const parts = String(value || "").split(/\s+-\s+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) return parts[parts.length - 1];
  return value || "-";
}

function normalizeValue(value: string) {
  return String(value || "").trim().toLowerCase();
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-IN").format(value);
}

function trim<T>(items: T[], limit: number) {
  if (items.length > limit) items.length = limit;
}
