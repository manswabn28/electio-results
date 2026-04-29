import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Bell,
  Check,
  Copy,
  Crown,
  ExternalLink,
  Flame,
  History,
  Link as LinkIcon,
  RefreshCw,
  Share2,
  ShieldCheck,
  Target,
  Timer,
  Trophy,
  Twitter,
  Users,
  Vote,
  WandSparkles
} from "lucide-react";
import type { ConstituencyDetailCandidate, ConstituencyDetailResponse } from "@kerala-election/shared";
import { fetchConstituencyDetail, shareImageProxyUrl } from "./api";
import { applySeo } from "./seo";
import { trackPageView } from "./analytics";

export type ConstituencyDetailPageProps = {
  stateSlug: string;
  constituencySlug: string;
  profileId?: string;
  watchedIds: string[];
  onBack: () => void;
  onToggleWatchlist: (constituencyId: string) => void;
  onGenerateShareCard: (detail: ConstituencyDetailResponse) => void;
  onOpenAlerts?: () => void;
};

export function ConstituencyDetailPage({
  stateSlug,
  constituencySlug,
  profileId,
  watchedIds,
  onBack,
  onToggleWatchlist,
  onGenerateShareCard,
  onOpenAlerts
}: ConstituencyDetailPageProps) {
  const detailQuery = useQuery({
    queryKey: ["constituency-detail", profileId, stateSlug, constituencySlug],
    queryFn: () => fetchConstituencyDetail(stateSlug, constituencySlug, profileId),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return 30000;
      return data.result.declared || data.election.status !== "live" ? false : 30000;
    }
  });

  const detail = detailQuery.data;
  const shareUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/constituency/${stateSlug}/${constituencySlug}`;
  }, [constituencySlug, stateSlug]);

  useEffect(() => {
    if (!detail) return;
    const title = `${detail.constituency.name} Election Result ${detail.election.year ?? ""} Live: Candidates, Winner, Margin, Vote Count`.replace(/\s+/g, " ").trim();
    const description = `Track ${detail.constituency.name} Assembly Election Result ${detail.election.year ?? ""} live with candidate-wise votes, winner, margin, counting updates, prediction meter, and political history.`.replace(/\s+/g, " ").trim();
    const leading = detail.candidates[0];
    applySeo({
      title,
      description,
      path: `/constituency/${stateSlug}/${constituencySlug}`,
      ogTitle: title,
      ogDescription: description,
      twitterCard: "summary_large_image",
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "NewsArticle",
        headline: title,
        description,
        mainEntityOfPage: shareUrl,
        dateModified: detail.election.lastUpdated,
        about: {
          "@type": "Event",
          name: detail.election.name
        },
        author: {
          "@type": "Organization",
          name: "OneKerala Results"
        },
        image: leading?.photoUrl ? shareImageProxyUrl(leading.photoUrl) : undefined
      }
    });
    trackPageView(title);
  }, [constituencySlug, detail, shareUrl, stateSlug]);

  if (detailQuery.isLoading) {
    return <LoadingSkeleton onBack={onBack} />;
  }

  if (detailQuery.isError || !detail) {
    return <NotFoundState message={detailQuery.error instanceof Error ? detailQuery.error.message : "Constituency page could not be loaded."} onBack={onBack} />;
  }

  const leader = detail.candidates[0];
  const runnerUp = detail.candidates[1];
  const declared = detail.result.declared;
  const prediction = !declared ? calculatePrediction(detail) : undefined;
  const isWatched = watchedIds.includes(detail.constituency.id);

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <StickyConstituencyHeader
        detail={detail}
        shareUrl={shareUrl}
        onBack={onBack}
        onGenerateShareCard={() => onGenerateShareCard(detail)}
      />
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-3 pb-12 pt-3 sm:px-4 lg:px-6">
        <div className="flex items-center justify-between gap-3">
          <button
            className="btn-press inline-flex items-center gap-2 rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm font-semibold text-white hover:bg-white/10"
            onClick={onBack}
            type="button"
            title="Back to live dashboard"
            aria-label="Back to live dashboard"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to live dashboard
          </button>
          <div className="flex items-center gap-2">
            <button
              className={`btn-press inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold ${isWatched ? "bg-emerald-500 text-zinc-950" : "border border-white/15 bg-white/5 text-white hover:bg-white/10"}`}
              onClick={() => onToggleWatchlist(detail.constituency.id)}
              type="button"
              title={isWatched ? "Remove from watchlist" : "Add to watchlist"}
              aria-label={isWatched ? "Remove from watchlist" : "Add to watchlist"}
            >
              <Check className="h-4 w-4" />
              {isWatched ? "In watchlist" : "Add to watchlist"}
            </button>
            <button
              className="btn-press inline-flex items-center gap-2 rounded-md border border-sky-400/40 bg-sky-500/15 px-3 py-2 text-sm font-semibold text-sky-100 hover:bg-sky-500/25"
              onClick={onOpenAlerts}
              type="button"
              title="Get alerts for this election"
              aria-label="Get alerts for this election"
            >
              <Bell className="h-4 w-4" />
              Get alerts
            </button>
          </div>
        </div>

        <ConstituencyHeroBattle detail={detail} />

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_360px]">
          <div className="space-y-6">
            <CurrentBattlePanel detail={detail} />
            {!declared && prediction ? <PredictionMeter prediction={prediction} leader={leader} /> : <FinalResultPanel detail={detail} />}
            <LiveTimeline timeline={detail.timeline} />
            <FullCandidateList candidates={detail.candidates} declared={declared} />
            <PoliticalHistory detail={detail} />
          </div>
          <div className="space-y-6">
            <SharePanel
              detail={detail}
              shareUrl={shareUrl}
              onGenerateShareCard={() => onGenerateShareCard(detail)}
            />
            <ConstituencyInsightCards detail={detail} />
            <HistoricalTrendChart detail={detail} />
          </div>
        </div>
      </main>
    </div>
  );
}

function ConstituencyHeroBattle({ detail }: { detail: ConstituencyDetailResponse }) {
  const leader = detail.candidates[0];
  const runnerUp = detail.candidates[1];
  const declared = detail.result.declared;
  const roundsText = detail.constituency.totalRounds
    ? `${detail.constituency.roundsCounted ?? 0}/${detail.constituency.totalRounds} rounds`
    : "Awaiting rounds";
  return (
    <section className="relative overflow-hidden rounded-md border border-white/10 bg-[radial-gradient(circle_at_left,rgba(249,115,22,0.22),transparent_32%),radial-gradient(circle_at_right,rgba(34,197,94,0.22),transparent_30%),linear-gradient(160deg,#020617,#0f172a_42%,#0b1220)] p-4 shadow-2xl shadow-black/40 sm:p-6">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
      {declared && (
        <div className="pointer-events-none absolute -right-6 -top-6 rounded-full bg-amber-400/20 p-10 blur-2xl" />
      )}
      <div className="relative flex flex-col gap-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge declared={declared} />
              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.2em] text-zinc-100">
                {detail.election.name}
              </span>
              {detail.election.lastUpdated && (
                <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-zinc-300">
                  Updated {formatTime(detail.election.lastUpdated)}
                </span>
              )}
            </div>
            <div>
              <div className="text-[11px] font-black uppercase tracking-[0.28em] text-amber-300">
                {detail.constituency.district ? `${detail.constituency.district} district` : `${detail.election.stateName} assembly`}
              </div>
              <h1 className="mt-2 text-4xl font-black uppercase leading-none text-white sm:text-5xl lg:text-6xl">
                {detail.constituency.name}
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-sm font-semibold text-zinc-300">
                <span>Seat #{detail.constituency.assemblyNumber}</span>
                <span className="text-zinc-500">•</span>
                <span>{detail.result.marginStatus}</span>
                <span className="text-zinc-500">•</span>
                <span>{roundsText}</span>
              </div>
            </div>
          </div>
          <div className="rounded-md border border-white/10 bg-white/5 px-4 py-3 text-right">
            <div className="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-400">
              {declared ? "Winning margin" : "Lead margin"}
            </div>
            <div className="mt-1 text-4xl font-black text-amber-300">{formatNumber(detail.result.margin)}</div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400">Votes</div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_120px_minmax(0,1fr)] lg:items-stretch">
          <CandidateBattleCard candidate={leader} side="leading" declared={declared} />
          <div className="flex items-center justify-center">
            <div className="rounded-full border border-cyan-300/25 bg-cyan-400/10 px-6 py-3 text-4xl font-black tracking-[0.2em] text-cyan-100 shadow-[0_0_32px_rgba(34,211,238,0.22)]">
              VS
            </div>
          </div>
          {runnerUp ? <CandidateBattleCard candidate={runnerUp} side="trailing" declared={declared} /> : <div className="rounded-md border border-white/10 bg-white/5 p-6 text-zinc-400">Opponent data is not available yet.</div>}
        </div>

        <div className="grid gap-4 rounded-md border border-white/10 bg-black/20 p-4 sm:grid-cols-3">
          <div>
            <div className="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-400">Result status</div>
            <div className="mt-1 text-lg font-black text-white">{declared ? "Winner Declared" : detail.result.marginStatus}</div>
          </div>
          <div>
            <div className="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-400">Current leader</div>
            <div className="mt-1 text-lg font-black text-white">{leader?.name ?? "Awaiting trend"}</div>
          </div>
          <div>
            <div className="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-400">Counting progress</div>
            <div className="mt-1 text-lg font-black text-white">{roundsText}</div>
          </div>
        </div>
        <CountingProgressPanel detail={detail} />
      </div>
    </section>
  );
}

function CandidateBattleCard({
  candidate,
  side,
  declared
}: {
  candidate: ConstituencyDetailCandidate;
  side: "leading" | "trailing";
  declared: boolean;
}) {
  const accent = side === "leading" ? "from-emerald-500/25 to-emerald-500/5" : "from-rose-500/25 to-rose-500/5";
  const border = side === "leading" ? "border-emerald-400/35" : "border-rose-400/35";
  const label = declared ? (side === "leading" ? "Winner" : "Runner-up") : side === "leading" ? "Leading" : "Trailing";
  return (
    <article className={`overflow-hidden rounded-md border ${border} bg-gradient-to-b ${accent} p-4 shadow-lg shadow-black/30`}>
      <div className="flex items-start justify-between gap-3">
        <CandidateAvatar name={candidate.name} photoUrl={candidate.photoUrl} large />
        <div className={`rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.22em] ${side === "leading" ? "bg-emerald-500 text-zinc-950" : "border border-white/10 bg-white/5 text-white"}`}>
          {label}
        </div>
      </div>
      <div className="mt-4 space-y-2">
        <div className="flex items-center gap-2">
          <div className="text-3xl font-black text-white">{candidate.partyCode}</div>
          {declared && side === "leading" ? <Crown className="h-5 w-5 text-amber-300" /> : null}
        </div>
        <div className="text-xl font-black leading-tight text-white">{candidate.name}</div>
        <div className="text-sm font-semibold text-zinc-300">{candidate.partyName}</div>
        <div className="pt-2 text-4xl font-black text-white">{formatNumber(candidate.votes)}</div>
        <div className="text-xs font-black uppercase tracking-[0.2em] text-zinc-400">Votes · {candidate.voteShare.toFixed(2)}%</div>
      </div>
    </article>
  );
}

function CurrentBattlePanel({ detail }: { detail: ConstituencyDetailResponse }) {
  const leader = detail.candidates[0];
  const runnerUp = detail.candidates[1];
  if (!leader || !runnerUp) return null;
  return (
    <section className="panel rounded-md border border-white/10 bg-zinc-950/70 p-4 backdrop-blur">
      <div className="flex items-center gap-2">
        <Flame className="h-4 w-4 text-amber-300" />
        <h2 className="text-lg font-black text-white">Current Battle</h2>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <BattleMetricCard
          title={detail.result.declared ? "Won by" : "Leading by"}
          value={`${formatNumber(detail.result.margin)} votes`}
          body={`${leader.name} is ahead of ${runnerUp.name}.`}
        />
        <BattleMetricCard
          title={detail.result.declared ? "Runner-up gap" : "Trailing by"}
          value={`${formatNumber(runnerUp.marginFromLeader ?? detail.result.margin)} votes`}
          body={`${runnerUp.name} is ${detail.result.declared ? "finishing" : "currently"} behind.`}
        />
      </div>
    </section>
  );
}

function BattleMetricCard({ title, value, body }: { title: string; value: string; body: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/5 p-4">
      <div className="text-[11px] font-black uppercase tracking-[0.22em] text-zinc-400">{title}</div>
      <div className="mt-1 text-2xl font-black text-white">{value}</div>
      <div className="mt-2 text-sm text-zinc-300">{body}</div>
    </div>
  );
}

function CountingProgressPanel({ detail }: { detail: ConstituencyDetailResponse }) {
  const total = detail.constituency.totalRounds ?? 0;
  const counted = detail.constituency.roundsCounted ?? 0;
  const declared = detail.result.declared;
  const percent = total > 0 ? Math.max(0, Math.min(100, Math.round((counted / total) * 100))) : 0;
  const label = declared ? "Counting completed" : total > 0 ? "Counting progress" : "Awaiting round data";
  return (
    <div className="rounded-md border border-white/10 bg-white/5 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-black uppercase tracking-[0.22em] text-zinc-400">{label}</div>
          <div className="mt-1 text-sm font-semibold text-zinc-300">
            {total > 0 ? `${counted}/${total} rounds counted` : "Live source has not published round progress yet."}
          </div>
        </div>
        <div className={`text-xl font-black ${declared ? "text-emerald-300" : "text-amber-300"}`}>{total > 0 ? `${percent}%` : "--"}</div>
      </div>
      <div className="mt-3 h-3 overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full transition-all ${declared ? "bg-gradient-to-r from-emerald-400 via-emerald-300 to-cyan-300" : "bg-gradient-to-r from-amber-400 via-orange-400 to-rose-400"}`}
          style={{ width: `${total > 0 ? percent : 8}%` }}
        />
      </div>
    </div>
  );
}

function PredictionMeter({
  prediction,
  leader
}: {
  prediction: ReturnType<typeof calculatePrediction>;
  leader?: ConstituencyDetailCandidate;
}) {
  return (
    <section className="panel rounded-md border border-white/10 bg-zinc-950/70 p-4 backdrop-blur">
      <div className="flex items-center gap-2">
        <WandSparkles className="h-4 w-4 text-sky-300" />
        <h2 className="text-lg font-black text-white">Prediction / Confidence Meter</h2>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <div>
          <div className="text-2xl font-black text-white">
            {leader?.partyCode ?? "Leader"} likely · <span className="text-amber-300">{prediction.confidence}% confidence</span>
          </div>
          <div className="mt-1 text-sm text-zinc-300">{prediction.label}</div>
        </div>
        <Target className="h-8 w-8 text-amber-300" />
      </div>
      <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-gradient-to-r from-amber-300 via-emerald-400 to-cyan-400 transition-all" style={{ width: `${prediction.confidence}%` }} />
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {prediction.explanation.map((item) => (
          <div key={item} className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-200">
            {item}
          </div>
        ))}
      </div>
      <div className="mt-3 text-xs text-zinc-400">Confidence is a simple guidance signal based on current margin, counting progress, recent lead stability, and historical strength. It is not a guaranteed forecast.</div>
    </section>
  );
}

function FinalResultPanel({ detail }: { detail: ConstituencyDetailResponse }) {
  const winner = detail.candidates[0];
  return (
    <section className="panel rounded-md border border-amber-300/30 bg-[radial-gradient(circle_at_top,rgba(251,191,36,0.18),transparent_36%),linear-gradient(160deg,#111827,#0f172a)] p-4">
      <div className="flex items-center gap-2">
        <Trophy className="h-5 w-5 text-amber-300" />
        <h2 className="text-lg font-black text-white">Final Result</h2>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_200px] sm:items-center">
        <div>
          <div className="text-[11px] font-black uppercase tracking-[0.22em] text-amber-300">Winner declared</div>
          <div className="mt-2 text-3xl font-black text-white">{winner?.name}</div>
          <div className="mt-1 text-base font-semibold text-zinc-300">{winner?.partyName} · {winner?.partyCode}</div>
          <div className="mt-3 text-sm text-zinc-300">Won the seat by <span className="font-black text-amber-300">{formatNumber(detail.result.margin)} votes</span>.</div>
        </div>
        <div className="rounded-md border border-white/10 bg-white/5 p-4 text-center">
          <div className="text-[11px] font-black uppercase tracking-[0.22em] text-zinc-400">Final margin</div>
          <div className="mt-1 text-4xl font-black text-amber-300">{formatNumber(detail.result.margin)}</div>
          <div className="text-xs font-black uppercase tracking-[0.2em] text-zinc-400">Votes</div>
        </div>
      </div>
    </section>
  );
}

function LiveTimeline({ timeline }: { timeline: ConstituencyDetailResponse["timeline"] }) {
  return (
    <section className="panel rounded-md border border-white/10 bg-zinc-950/70 p-4 backdrop-blur">
      <div className="flex items-center gap-2">
        <History className="h-4 w-4 text-cyan-300" />
        <h2 className="text-lg font-black text-white">Live Timeline / What Happened</h2>
      </div>
      <div className="mt-4 space-y-4">
        {timeline.map((item, index) => (
          <div key={item.id} className="grid grid-cols-[18px_minmax(0,1fr)] gap-3">
            <div className="relative flex flex-col items-center">
              <span className={`z-10 inline-flex h-4 w-4 rounded-full ${index === timeline.length - 1 ? "bg-amber-300 shadow-[0_0_20px_rgba(252,211,77,0.5)]" : "bg-cyan-400"}`} />
              {index < timeline.length - 1 ? <span className="mt-1 h-full w-px bg-white/10" /> : null}
            </div>
            <div className={`rounded-md border px-4 py-3 ${index === timeline.length - 1 ? "border-amber-300/40 bg-amber-300/10" : "border-white/10 bg-white/5"}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-base font-black text-white">{item.title}</div>
                <div className="text-xs font-black uppercase tracking-[0.18em] text-zinc-400">{formatTime(item.time)}</div>
              </div>
              <div className="mt-1 text-sm text-zinc-300">{item.description}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function FullCandidateList({
  candidates,
  declared
}: {
  candidates: ConstituencyDetailCandidate[];
  declared: boolean;
}) {
  return (
    <section className="panel rounded-md border border-white/10 bg-zinc-950/70 p-4 backdrop-blur">
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 text-emerald-300" />
        <h2 className="text-lg font-black text-white">Full Candidate List</h2>
      </div>
      <div className="mt-4 hidden overflow-hidden rounded-md border border-white/10 lg:block">
        <table className="min-w-full divide-y divide-white/10 text-left">
          <thead className="bg-white/5 text-[11px] font-black uppercase tracking-[0.2em] text-zinc-400">
            <tr>
              <th className="px-4 py-3">Rank</th>
              <th className="px-4 py-3">Candidate</th>
              <th className="px-4 py-3">Party</th>
              <th className="px-4 py-3">Votes</th>
              <th className="px-4 py-3">Vote share</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Gap</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {candidates.map((candidate) => (
              <tr key={candidate.id} className="bg-black/10">
                <td className="px-4 py-3 text-sm font-black text-white">#{candidate.rank}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <CandidateAvatar name={candidate.name} photoUrl={candidate.photoUrl} />
                    <div>
                      <div className="text-sm font-black text-white">{candidate.name}</div>
                      <div className="text-xs text-zinc-400">{candidate.partyCode}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-zinc-300">{candidate.partyName}</td>
                <td className="px-4 py-3 text-sm font-black text-white">{formatNumber(candidate.votes)}</td>
                <td className="px-4 py-3 text-sm text-zinc-300">{candidate.voteShare.toFixed(2)}%</td>
                <td className="px-4 py-3 text-sm font-semibold text-zinc-200">{candidateStatusLabel(candidate.status, declared)}</td>
                <td className="px-4 py-3 text-sm text-zinc-300">{candidate.rank === 1 ? "-" : formatNumber(candidate.marginFromLeader ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 space-y-3 lg:hidden">
        {candidates.map((candidate) => (
          <div key={candidate.id} className="rounded-md border border-white/10 bg-white/5 p-4">
            <div className="flex items-start gap-3">
              <CandidateAvatar name={candidate.name} photoUrl={candidate.photoUrl} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="truncate text-sm font-black text-white">{candidate.name}</div>
                  <div className="text-xs font-black uppercase tracking-[0.2em] text-zinc-400">#{candidate.rank}</div>
                </div>
                <div className="text-xs text-zinc-300">{candidate.partyName} · {candidate.partyCode}</div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <MetricPill label="Votes" value={formatNumber(candidate.votes)} />
                  <MetricPill label="Share" value={`${candidate.voteShare.toFixed(2)}%`} />
                  <MetricPill label="Status" value={candidateStatusLabel(candidate.status, declared)} />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function PoliticalHistory({ detail }: { detail: ConstituencyDetailResponse }) {
  return (
    <section className="panel rounded-md border border-white/10 bg-zinc-950/70 p-4 backdrop-blur">
      <div className="flex items-center gap-2">
        <Vote className="h-4 w-4 text-amber-300" />
        <h2 className="text-lg font-black text-white">Political History</h2>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {detail.history.length ? detail.history.map((entry) => (
          <article key={`${detail.constituency.id}-${entry.year}`} className="rounded-md border border-white/10 bg-white/5 p-4">
            <div className="text-[11px] font-black uppercase tracking-[0.22em] text-zinc-400">{entry.year}</div>
            <div className="mt-2 text-lg font-black text-white">{entry.winnerName}</div>
            <div className="text-sm font-semibold text-zinc-300">{entry.party}</div>
            <div className="mt-3 space-y-1 text-sm text-zinc-300">
              <div>Runner-up: {entry.runnerUpName}</div>
              <div>Margin: {formatNumber(entry.margin)} votes</div>
              {entry.voteSharePercent ? <div>Winner share: {entry.voteSharePercent.toFixed(2)}%</div> : null}
              {entry.turnoutPercent ? <div>Turnout: {entry.turnoutPercent.toFixed(1)}%</div> : null}
            </div>
          </article>
        )) : (
          <div className="rounded-md border border-dashed border-white/10 bg-white/5 p-4 text-sm text-zinc-400">
            Historical election archive is still being prepared for this constituency.
          </div>
        )}
      </div>
    </section>
  );
}

function HistoricalTrendChart({ detail }: { detail: ConstituencyDetailResponse }) {
  const history = detail.history;
  const maxMargin = Math.max(...history.map((entry) => entry.margin), 1);
  return (
    <section className="panel rounded-md border border-white/10 bg-zinc-950/70 p-4 backdrop-blur">
      <div className="flex items-center gap-2">
        <Timer className="h-4 w-4 text-cyan-300" />
        <h2 className="text-lg font-black text-white">Historical Trend Chart</h2>
      </div>
      <div className="mt-4 space-y-3">
        {history.length ? history.map((entry) => (
          <div key={entry.year}>
            <div className="mb-1 flex items-center justify-between gap-2 text-sm">
              <span className="font-black text-white">{entry.year} · {entry.party}</span>
              <span className="text-zinc-400">{formatNumber(entry.margin)} margin</span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-gradient-to-r from-amber-300 to-emerald-400" style={{ width: `${Math.max(10, (entry.margin / maxMargin) * 100)}%` }} />
            </div>
          </div>
        )) : (
          <div className="text-sm text-zinc-400">Trend chart will appear once historical records are available.</div>
        )}
      </div>
    </section>
  );
}

function ConstituencyInsightCards({ detail }: { detail: ConstituencyDetailResponse }) {
  const items = [
    { label: "Current leader", value: detail.candidates[0]?.partyCode ?? "-", icon: Crown },
    { label: "Margin status", value: detail.result.marginStatus, icon: Flame },
    { label: "Total candidates", value: String(detail.insights.totalCandidates), icon: Users },
    { label: "Counting progress", value: detail.constituency.totalRounds ? `${detail.constituency.roundsCounted ?? 0}/${detail.constituency.totalRounds}` : "Awaiting", icon: RefreshCw },
    { label: "Previous winner", value: detail.insights.previousWinnerParty ?? "-", icon: History },
    { label: "Closest past margin", value: detail.insights.closestPastMargin ? formatNumber(detail.insights.closestPastMargin) : "-", icon: Target },
    { label: "Biggest past margin", value: detail.insights.biggestPastMargin ? formatNumber(detail.insights.biggestPastMargin) : "-", icon: Trophy },
    { label: "Volatility", value: detail.insights.volatilityScore ?? "-", icon: ShieldCheck }
  ];
  return (
    <section className="panel rounded-md border border-white/10 bg-zinc-950/70 p-4 backdrop-blur">
      <div className="flex items-center gap-2">
        <Target className="h-4 w-4 text-amber-300" />
        <h2 className="text-lg font-black text-white">Constituency Insights</h2>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {items.map((item) => (
          <div key={item.label} className="rounded-md border border-white/10 bg-white/5 p-4">
            <div className="flex items-center gap-2">
              <item.icon className="h-4 w-4 text-zinc-400" />
              <div className="text-[11px] font-black uppercase tracking-[0.22em] text-zinc-400">{item.label}</div>
            </div>
            <div className="mt-2 text-lg font-black text-white">{item.value}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function SharePanel({
  detail,
  shareUrl,
  onGenerateShareCard
}: {
  detail: ConstituencyDetailResponse;
  shareUrl: string;
  onGenerateShareCard: () => void;
}) {
  const shareText = `${detail.constituency.name} Election Result Live | ${detail.candidates[0]?.name ?? "Leader"} ${detail.result.declared ? "won" : "is leading"} by ${formatNumber(detail.result.margin)} votes`;
  return (
    <section className="panel rounded-md border border-white/10 bg-zinc-950/70 p-4 backdrop-blur">
      <div className="flex items-center gap-2">
        <Share2 className="h-4 w-4 text-emerald-300" />
        <h2 className="text-lg font-black text-white">Share This Constituency</h2>
      </div>
      <div className="mt-3 text-sm text-zinc-300">Send the live page link, copy it, or generate a premium share card from the latest result.</div>
      <div className="mt-4 grid gap-2">
        <button
          className="btn-press inline-flex items-center justify-between rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-white"
          onClick={() => copyText(shareUrl)}
          type="button"
          title="Copy constituency page link"
          aria-label="Copy constituency page link"
        >
          Copy link
          <Copy className="h-4 w-4" />
        </button>
        <button
          className="btn-press inline-flex items-center justify-between rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-white"
          onClick={() => onGenerateShareCard()}
          type="button"
          title="Generate premium result share card"
          aria-label="Generate premium result share card"
        >
          Generate share card
          <WandSparkles className="h-4 w-4" />
        </button>
        <a className="btn-press inline-flex items-center justify-between rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-white" href={`https://wa.me/?text=${encodeURIComponent(`${shareText} ${shareUrl}`)}`} target="_blank" rel="noreferrer" title="Share to WhatsApp" aria-label="Share to WhatsApp">
          Share to WhatsApp
          <ExternalLink className="h-4 w-4" />
        </a>
        <a className="btn-press inline-flex items-center justify-between rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-white" href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`} target="_blank" rel="noreferrer" title="Share to X" aria-label="Share to X">
          Share to X
          <Twitter className="h-4 w-4" />
        </a>
        <a className="btn-press inline-flex items-center justify-between rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-white" href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`} target="_blank" rel="noreferrer" title="Share to Facebook" aria-label="Share to Facebook">
          Share to Facebook
          <ExternalLink className="h-4 w-4" />
        </a>
        <button
          className="btn-press inline-flex items-center justify-between rounded-md border border-white/10 bg-emerald-500/15 px-3 py-2 text-sm font-semibold text-emerald-100"
          onClick={() => void nativeShare({ title: shareText, text: shareText, url: shareUrl })}
          type="button"
          title="Open native share sheet"
          aria-label="Open native share sheet"
        >
          Share page link
          <LinkIcon className="h-4 w-4" />
        </button>
      </div>
    </section>
  );
}

function StickyConstituencyHeader({
  detail,
  shareUrl,
  onBack,
  onGenerateShareCard
}: {
  detail: ConstituencyDetailResponse;
  shareUrl: string;
  onBack: () => void;
  onGenerateShareCard: () => void;
}) {
  const leader = detail.candidates[0];
  return (
    <div className="sticky top-0 z-30 border-b border-white/10 bg-zinc-950/85 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-3 py-2 sm:px-4 lg:px-6">
        <div className="min-w-0">
          <button className="text-left" onClick={onBack} type="button" title="Back to live dashboard" aria-label="Back to live dashboard">
            <div className="truncate text-sm font-black text-white">{detail.constituency.name}</div>
            <div className="truncate text-xs text-zinc-400">
              {leader?.partyCode ?? "-"} · {detail.result.declared ? "Won" : "Leading"} by {formatNumber(detail.result.margin)}
            </div>
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-press inline-flex h-9 w-9 items-center justify-center rounded-md border border-white/10 bg-white/5 text-white" onClick={onGenerateShareCard} type="button" aria-label="Generate share card" title="Generate share card">
            <WandSparkles className="h-4 w-4" />
          </button>
          <button className="btn-press inline-flex h-9 w-9 items-center justify-center rounded-md border border-white/10 bg-white/5 text-white" onClick={() => copyText(shareUrl)} type="button" aria-label="Copy constituency page link" title="Copy constituency page link">
            <Copy className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function LoadingSkeleton({ onBack }: { onBack: () => void }) {
  return (
    <div className="min-h-screen bg-zinc-950 px-3 py-4 text-white sm:px-4 lg:px-6">
      <button className="btn-press inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-white" onClick={onBack} type="button">
        <ArrowLeft className="h-4 w-4" />
        Back to live dashboard
      </button>
      <div className="mx-auto mt-4 max-w-7xl space-y-6">
        <div className="h-72 animate-pulse rounded-md bg-white/5" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_360px]">
          <div className="space-y-6">
            <div className="h-40 animate-pulse rounded-md bg-white/5" />
            <div className="h-56 animate-pulse rounded-md bg-white/5" />
            <div className="h-80 animate-pulse rounded-md bg-white/5" />
          </div>
          <div className="space-y-6">
            <div className="h-56 animate-pulse rounded-md bg-white/5" />
            <div className="h-72 animate-pulse rounded-md bg-white/5" />
          </div>
        </div>
      </div>
    </div>
  );
}

function NotFoundState({ message, onBack }: { message: string; onBack: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4 text-white">
      <div className="panel w-full max-w-lg rounded-md border border-white/10 bg-zinc-950/80 p-6 text-center">
        <div className="text-lg font-black text-white">Constituency page not found</div>
        <div className="mt-2 text-sm text-zinc-400">{message}</div>
        <button className="btn-press mt-4 inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-white" onClick={onBack} type="button">
          <ArrowLeft className="h-4 w-4" />
          Back to live dashboard
        </button>
      </div>
    </div>
  );
}

function CandidateAvatar({
  name,
  photoUrl,
  large = false
}: {
  name: string;
  photoUrl?: string;
  large?: boolean;
}) {
  const size = large ? "h-28 w-28" : "h-12 w-12";
  return (
    <div className={`${size} overflow-hidden rounded-md border border-white/10 bg-white/10`}>
      {photoUrl ? (
        <img src={shareImageProxyUrl(photoUrl)} alt={name} className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-lg font-black text-white">
          {initials(name)}
        </div>
      )}
    </div>
  );
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-black/20 px-2 py-2">
      <div className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-400">{label}</div>
      <div className="mt-1 text-sm font-black text-white">{value}</div>
    </div>
  );
}

function StatusBadge({ declared }: { declared: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.22em] ${declared ? "bg-amber-300 text-zinc-950" : "bg-rose-500 text-white shadow-[0_0_24px_rgba(244,63,94,0.35)]"}`}>
      <span className={`h-2.5 w-2.5 rounded-full ${declared ? "bg-zinc-950" : "bg-white animate-pulse"}`} />
      {declared ? "Final Result" : "Live"}
    </span>
  );
}

function calculatePrediction(detail: ConstituencyDetailResponse) {
  const leader = detail.candidates[0];
  const runner = detail.candidates[1];
  const totalVotes = (leader?.votes ?? 0) + (runner?.votes ?? 0);
  const progress = detail.constituency.totalRounds
    ? (detail.constituency.roundsCounted ?? 0) / detail.constituency.totalRounds
    : 0.4;
  const marginPercent = totalVotes > 0 ? detail.result.margin / totalVotes : 0;
  const marginScore = Math.min(marginPercent / 0.08, 1);
  const progressScore = Math.min(progress, 1);
  const samePartyPreviously = detail.history[0]?.party && detail.history[0].party.toUpperCase().includes((leader?.partyCode ?? "").replace(/[()]/g, ""));
  const historyScore = samePartyPreviously ? 0.78 : 0.52;
  let confidence = Math.round((marginScore * 60) + (progressScore * 30) + (historyScore * 10));
  if (detail.result.leadChangedRecently) confidence -= 10;
  confidence = Math.max(50, Math.min(98, confidence));
  let label = "Too close to call";
  if (confidence >= 90) label = "Very likely";
  else if (confidence >= 75) label = "Likely";
  else if (confidence >= 60) label = "Leaning";
  return {
    confidence,
    label,
    explanation: [
      `Current margin: ${formatNumber(detail.result.margin)} votes`,
      `Counting progress: ${Math.round(progress * 100)}%`,
      detail.result.leadChangedRecently ? "Recent lead change detected" : "Lead appears stable",
      samePartyPreviously ? "Historical result supports current leader" : "History shows this seat can swing"
    ]
  };
}

function candidateStatusLabel(status: ConstituencyDetailCandidate["status"], declared: boolean) {
  if (status === "won") return "Won";
  if (status === "runner-up") return "Runner-up";
  if (status === "leading") return declared ? "Won" : "Leading";
  if (status === "trailing") return declared ? "Lost" : "Trailing";
  return "Lost";
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

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-IN").format(value);
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    void nativeShare({ text: value, url: value });
  }
}

async function nativeShare(payload: { title?: string; text?: string; url?: string }) {
  if (navigator.share) {
    await navigator.share(payload);
  }
}



