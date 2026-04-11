import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowDown, ArrowUp, Bell, Check, ChevronLeft, ChevronRight, Crown, Download, Eye, History, Hourglass, Lock, Maximize2, Moon, Play, RefreshCw, Search, Settings, Share2, Star, StickyNote, Sun, Users, Volume2, X } from "lucide-react";
import type { CandidateOption, ConstituencyOption, ConstituencyResult, PublicSourceConfig, SortMode } from "@kerala-election/shared";
import { fetchCandidates, fetchConstituencies, fetchPartySummary, fetchResult, fetchSourceConfig, fetchSummary, sendTrafficHeartbeat, updateSourceConfig } from "./api";
import { downloadCsv, downloadJson } from "./export";
import { playLeaderAlert, useCountdown, useLocalStorageState, usePreviousMap } from "./hooks";

const SELECTED_STORAGE_KEY = "kerala-election:selected-constituencies";
const CACHED_RESULTS_KEY = "kerala-election:last-known-results";
const VIEWER_ID_STORAGE_KEY = "kerala-election:viewer-id";
const TIGHT_MARGIN_LIMIT = 5000;

const LIVE_CHANNELS = [
  { id: "reporter-tv", label: "Reporter Live", videoId: "nObUcHKZEGY" },
  { id: "24-news", label: "24 News", videoId: "1wECsnGZcfc" },
  { id: "asianet-news", label: "Asianet News", videoId: "4wExBtPQ-JA" },
  { id: "mediaone-tv", label: "MediaOne TV Live", videoId: "-8d8-c0yvyU" },
  { id: "mathrubhumi-news", label: "Mathrubhumi News", videoId: "YGEgelAiUf0" },
  { id: "manorama-news", label: "Manorama News", videoId: "tgBTspqA5nY" }
] as const;

type LeaderHistoryEntry = {
  at: number;
  leader: string;
  party: string;
  margin: number;
  status: string;
};

type WinnerNotification = {
  id: string;
  constituencyName: string;
  candidateName: string;
  party: string;
  photoUrl?: string;
  totalVotes: number;
  margin: number;
};

type LostNotification = WinnerNotification & {
  winnerName: string;
};

export function App() {
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useLocalStorageState<string[]>(SELECTED_STORAGE_KEY, []);
  const [hasBootstrappedFavorites, setHasBootstrappedFavorites] = useState(() =>
    localStorage.getItem(SELECTED_STORAGE_KEY) !== null
  );
  const [sortMode, setSortMode] = useLocalStorageState<SortMode>("kerala-election:sort-mode", "selected");
  const [darkMode, setDarkMode] = useLocalStorageState<boolean>("kerala-election:dark-mode", false);
  const [soundEnabled, setSoundEnabled] = useLocalStorageState<boolean>("kerala-election:sound", false);
  const [sidebarCollapsed, setSidebarCollapsed] = useLocalStorageState<boolean>("kerala-election:sidebar-collapsed", false);
  const [watchMode, setWatchMode] = useLocalStorageState<boolean>("kerala-election:watch-mode", false);
  const [autoScroll, setAutoScroll] = useLocalStorageState<boolean>("kerala-election:auto-scroll", false);
  const [pinnedIds, setPinnedIds] = useLocalStorageState<string[]>("kerala-election:pinned-constituencies", []);
  const [partyFilter, setPartyFilter] = useLocalStorageState<string>("kerala-election:party-filter", "all");
  const [watchedCandidateIds, setWatchedCandidateIds] = useLocalStorageState<string[]>("kerala-election:watched-candidates", []);
  const [lastChangedAt, setLastChangedAt] = useLocalStorageState<Record<string, number>>("kerala-election:last-changed-at", {});
  const [cachedResults, setCachedResults] = useLocalStorageState<Record<string, ConstituencyResult>>(CACHED_RESULTS_KEY, {});
  const [lastCheckedById, setLastCheckedById] = useLocalStorageState<Record<string, number>>("kerala-election:last-checked-by-id", {});
  const [leaderHistory, setLeaderHistory] = useLocalStorageState<Record<string, LeaderHistoryEntry[]>>("kerala-election:leader-history", {});
  const [constituencyNotes, setConstituencyNotes] = useLocalStorageState<Record<string, string>>("kerala-election:constituency-notes", {});
  const [alertThreshold, setAlertThreshold] = useLocalStorageState<number>("kerala-election:alert-threshold", 1000);
  const [seenWinnerIds, setSeenWinnerIds] = useLocalStorageState<string[]>("kerala-election:seen-winner-notifications", []);
  const [seenLostIds, setSeenLostIds] = useLocalStorageState<string[]>("kerala-election:seen-lost-notifications", []);
  const [viewerId] = useLocalStorageState<string>(VIEWER_ID_STORAGE_KEY, () => crypto.randomUUID());
  const [liveAudioStarted, setLiveAudioStarted] = useLocalStorageState<boolean>("kerala-election:live-audio-started", false);
  const [liveAudioExpanded, setLiveAudioExpanded] = useLocalStorageState<boolean>("kerala-election:live-audio-expanded", false);
  const [selectedLiveChannelId, setSelectedLiveChannelId] = useLocalStorageState<string>("kerala-election:live-audio-channel", "reporter-tv");
  const [toast, setToast] = useState("");
  const [winnerToasts, setWinnerToasts] = useState<WinnerNotification[]>([]);
  const [lostToasts, setLostToasts] = useState<LostNotification[]>([]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  useEffect(() => {
    if (!watchMode || !("wakeLock" in navigator)) return;
    let released = false;
    let lock: WakeLockSentinel | undefined;

    const requestLock = async () => {
      try {
        lock = await navigator.wakeLock.request("screen");
        lock.addEventListener("release", () => {
          if (!released && document.visibilityState === "visible") void requestLock();
        });
      } catch {
        lock = undefined;
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible" && !released) void requestLock();
    };

    void requestLock();
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      released = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      void lock?.release();
    };
  }, [watchMode]);

  useEffect(() => {
    if (!watchMode || !autoScroll) return;
    const timer = window.setInterval(() => {
      const nearBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 24;
      if (nearBottom) window.scrollTo({ top: 0, behavior: "smooth" });
      else window.scrollBy({ top: Math.max(260, window.innerHeight * 0.45), behavior: "smooth" });
    }, 7000);
    return () => window.clearInterval(timer);
  }, [autoScroll, watchMode]);

  useEffect(() => {
    if (!watchMode) return;
    let hideTimer = 0;
    const showCursor = () => {
      document.body.classList.remove("hide-cursor");
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => document.body.classList.add("hide-cursor"), 2500);
    };
    showCursor();
    window.addEventListener("mousemove", showCursor);
    window.addEventListener("keydown", showCursor);
    return () => {
      window.clearTimeout(hideTimer);
      document.body.classList.remove("hide-cursor");
      window.removeEventListener("mousemove", showCursor);
      window.removeEventListener("keydown", showCursor);
    };
  }, [watchMode]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const seats = params.get("seats");
    if (seats && localStorage.getItem(SELECTED_STORAGE_KEY) === null) {
      setSelectedIds(seats.split(",").map((seat) => seat.trim()).filter(Boolean));
      setHasBootstrappedFavorites(true);
    }
    const filter = params.get("filter");
    if (filter) setPartyFilter(filter);
    const sort = params.get("sort") as SortMode | null;
    if (sort && ["selected", "marginAsc", "marginDesc", "leader"].includes(sort)) setSortMode(sort);
  }, [setPartyFilter, setSelectedIds, setSortMode]);

  const constituenciesQuery = useQuery({
    queryKey: ["constituencies"],
    queryFn: fetchConstituencies
  });

  const candidatesQuery = useQuery({
    queryKey: ["candidates"],
    queryFn: fetchCandidates,
    staleTime: Infinity
  });

  const sourceConfigQuery = useQuery({
    queryKey: ["source-config"],
    queryFn: fetchSourceConfig
  });

  const trafficQuery = useQuery({
    queryKey: ["traffic", viewerId],
    queryFn: () => sendTrafficHeartbeat(viewerId),
    refetchInterval: 30_000
  });

  useEffect(() => {
    if (hasBootstrappedFavorites || !constituenciesQuery.data) return;
    const defaults = constituenciesQuery.data.constituencies
      .filter((item) => item.isFavoriteDefault)
      .map((item) => item.constituencyId);
    if (defaults.length) setSelectedIds(defaults);
    setHasBootstrappedFavorites(true);
  }, [constituenciesQuery.data, hasBootstrappedFavorites, setSelectedIds]);

  const selectedOptions = useMemo(() => {
    const options = constituenciesQuery.data?.constituencies ?? [];
    const byId = new Map(options.map((option) => [option.constituencyId, option]));
    return selectedIds.map((id) => byId.get(id)).filter(Boolean) as ConstituencyOption[];
  }, [constituenciesQuery.data?.constituencies, selectedIds]);

  const watchedCandidates = useMemo(() => {
    const byId = new Map((candidatesQuery.data?.candidates ?? []).map((candidate) => [candidate.candidateId, candidate]));
    return watchedCandidateIds.map((id) => byId.get(id)).filter(Boolean) as CandidateOption[];
  }, [candidatesQuery.data?.candidates, watchedCandidateIds]);

  const summaryQuery = useQuery({
    queryKey: ["summary", selectedIds],
    queryFn: () => fetchSummary(selectedIds),
    enabled: selectedIds.length > 0
  });

  const refreshMs = Math.max(5, sourceConfigQuery.data?.refreshIntervalSeconds ?? 30) * 1000;

  const allSummaryQuery = useQuery({
    queryKey: ["summary", "all-winner-watch", constituenciesQuery.data?.constituencies.map((item) => item.constituencyId).join(",") ?? ""],
    queryFn: () => fetchSummary(constituenciesQuery.data?.constituencies.map((item) => item.constituencyId) ?? []),
    enabled: Boolean(constituenciesQuery.data?.constituencies.length),
    refetchInterval: refreshMs
  });

  const partySummaryQuery = useQuery({
    queryKey: ["party-summary"],
    queryFn: fetchPartySummary,
    refetchInterval: refreshMs
  });

  const resultQueries = useQueries({
    queries: selectedIds.map((id) => ({
      queryKey: ["result", id],
      queryFn: () => fetchResult(id),
      enabled: selectedIds.length > 0 && Boolean(summaryQuery.data?.sourceConfigured),
      refetchInterval: refreshMs
    }))
  });

  const isFetching = constituenciesQuery.isFetching || summaryQuery.isFetching || allSummaryQuery.isFetching || resultQueries.some((query) => query.isFetching);
  const lastSuccessAt = latestDataUpdatedAt(resultQueries.map((query) => query.dataUpdatedAt));
  const countdown = useCountdown(refreshMs, lastSuccessAt);

  const liveResults = useMemo(
    () => resultQueries.map((query) => query.data).filter(Boolean) as ConstituencyResult[],
    [resultQueries]
  );
  const checkedAtById = useMemo(() => {
    const entries = selectedIds.map((id, index) => [id, resultQueries[index]?.dataUpdatedAt || 0] as const);
    return Object.fromEntries(entries);
  }, [resultQueries, selectedIds]);
  const results = useMemo(() => {
    const liveById = new Map(liveResults.map((result) => [result.constituencyId, result]));
    return selectedIds
      .map((id) => liveById.get(id) ?? cachedResults[id])
      .filter(Boolean) as ConstituencyResult[];
  }, [cachedResults, liveResults, selectedIds]);
  const previousResults = usePreviousMap(results);
  const leaderChanges = useMemo(() => {
    return results.filter((result) => {
      const previous = previousResults.get(result.constituencyId);
      return previous && previous.leadingCandidate && previous.leadingCandidate !== result.leadingCandidate;
    });
  }, [previousResults, results]);

  useEffect(() => {
    if (soundEnabled && leaderChanges.length) playLeaderAlert();
  }, [leaderChanges.length, soundEnabled]);

  useEffect(() => {
    if (!liveResults.length) return;
    setCachedResults((current) => {
      let changed = false;
      const next = { ...current };
      for (const result of liveResults) {
        if (current[result.constituencyId] === result) continue;
        next[result.constituencyId] = result;
        changed = true;
      }
      return changed ? next : current;
    });
    setLastCheckedById((current) => {
      const now = Date.now();
      let changed = false;
      const next = { ...current };
      for (const result of liveResults) {
        const updatedAt = checkedAtById[result.constituencyId] || now;
        if (next[result.constituencyId] === updatedAt) continue;
        next[result.constituencyId] = updatedAt;
        changed = true;
      }
      return changed ? next : current;
    });
  }, [checkedAtById, liveResults, setCachedResults, setLastCheckedById]);

  useEffect(() => {
    const summaries = allSummaryQuery.data?.results ?? [];
    if (!summaries.length) return;

    const declared = summaries.filter((summary) => isDeclaredWinner(summary.statusText || summary.roundStatus));
    if (!declared.length) return;

    if (!seenWinnerIds.length) {
      setSeenWinnerIds(declared.map((summary) => summary.constituencyId));
      return;
    }

    const newWinners = declared.filter((summary) => !seenWinnerIds.includes(summary.constituencyId)).slice(0, 4);
    if (!newWinners.length) return;

    setSeenWinnerIds((current) => [...new Set([...current, ...newWinners.map((winner) => winner.constituencyId)])]);
    newWinners.forEach((nextWinner, index) => {
      window.setTimeout(() => {
        void fetchResult(nextWinner.constituencyId)
          .then((result) => {
            const winner = result.candidates[0];
            addWinnerToast({
              id: result.constituencyId,
              constituencyName: result.constituencyName,
              candidateName: result.leadingCandidate || winner?.candidateName || nextWinner.leadingCandidate || "-",
              party: result.leadingParty || winner?.party || nextWinner.leadingParty || "-",
              photoUrl: winner?.photoUrl,
              totalVotes: winner?.totalVotes ?? 0,
              margin: result.margin || nextWinner.margin || 0
            });
            if (soundEnabled) playLeaderAlert();
          })
          .catch(() => {
            addWinnerToast({
              id: nextWinner.constituencyId,
              constituencyName: nextWinner.constituencyName,
              candidateName: nextWinner.leadingCandidate || "-",
              party: nextWinner.leadingParty || "-",
              totalVotes: 0,
              margin: nextWinner.margin || 0
            });
          });
      }, index * 4500);
    });
  }, [allSummaryQuery.data?.results, seenWinnerIds, setSeenWinnerIds, soundEnabled]);

  useEffect(() => {
    const closeDeclaredLosses = liveResults.filter((result) => {
      if (!isDeclaredWinner(result.statusText || result.roundStatus)) return false;
      if (result.margin > TIGHT_MARGIN_LIMIT) return false;
      if (seenLostIds.includes(result.constituencyId)) return false;
      return Boolean(result.candidates[1]);
    });
    if (!closeDeclaredLosses.length) return;

    setSeenLostIds((current) => [...new Set([...current, ...closeDeclaredLosses.map((result) => result.constituencyId)])]);
    closeDeclaredLosses.forEach((result, index) => {
      const loser = result.candidates[1];
      window.setTimeout(() => {
        addLostToast({
          id: result.constituencyId,
          constituencyName: result.constituencyName,
          candidateName: result.trailingCandidate || loser?.candidateName || "-",
          party: result.trailingParty || loser?.party || "-",
          photoUrl: loser?.photoUrl,
          totalVotes: loser?.totalVotes ?? 0,
          margin: result.margin,
          winnerName: result.leadingCandidate || result.candidates[0]?.candidateName || "-"
        });
      }, index * 4500);
    });
  }, [alertThreshold, liveResults, seenLostIds, setSeenLostIds]);

  useEffect(() => {
    if (!results.length) return;
    const changedEntries = results.filter((result) => {
      const previous = previousResults.get(result.constituencyId);
      if (!previous) return false;
      const previousLeader = previous.candidates[0];
      const currentLeader = result.candidates[0];
      return (
        previous.leadingCandidate !== result.leadingCandidate ||
        previous.margin !== result.margin ||
        previousLeader?.totalVotes !== currentLeader?.totalVotes ||
        previous.totalVotes !== result.totalVotes
      );
    });
    if (!changedEntries.length) return;
    const now = Date.now();
    setLastChangedAt((current) => ({
      ...current,
      ...Object.fromEntries(changedEntries.map((result) => [result.constituencyId, now]))
    }));
    setLeaderHistory((current) => {
      const next = { ...current };
      for (const result of changedEntries) {
        const entry: LeaderHistoryEntry = {
          at: now,
          leader: result.leadingCandidate || result.candidates[0]?.candidateName || "-",
          party: result.leadingParty || result.candidates[0]?.party || "-",
          margin: result.margin,
          status: result.statusText || result.roundStatus || "Counting"
        };
        next[result.constituencyId] = [entry, ...(next[result.constituencyId] ?? [])].slice(0, 5);
      }
      return next;
    });
    const urgent = changedEntries.find((result) => {
      const previous = previousResults.get(result.constituencyId);
      const statusChanged = previous && (previous.statusText || previous.roundStatus) !== (result.statusText || result.roundStatus);
      const closeNow = result.margin <= alertThreshold;
      return result.leadingCandidate !== previous?.leadingCandidate || statusChanged || closeNow;
    });
    if (urgent) {
      setToast(`${urgent.constituencyName}: ${urgent.leadingCandidate || urgent.candidates[0]?.candidateName || "Leader"} leads by ${formatNumber(urgent.margin)}.`);
      window.setTimeout(() => setToast(""), 5000);
    }
  }, [alertThreshold, previousResults, results, setLastChangedAt, setLeaderHistory]);

  const partyOptions = useMemo(() => {
    return [...new Set(results.map((result) => result.leadingParty || result.candidates[0]?.party).filter(Boolean))].sort();
  }, [results]);
  const visibleResults = useMemo(() => {
    return results.filter((result) => {
      if (partyFilter === "all") return true;
      if (partyFilter === "close") return result.margin <= 5000;
      const party = result.leadingParty || result.candidates[0]?.party || "";
      return party === partyFilter;
    });
  }, [partyFilter, results]);
  const sortedResults = sortResults(visibleResults, selectedIds, sortMode, pinnedIds);
  const hasSourceWarning = Boolean(constituenciesQuery.data?.warning || summaryQuery.data?.errors?.length);
  const sourceHealth = hasSourceWarning || partySummaryQuery.isError || resultQueries.some((query) => query.isError) ? "Issue" : "ECI OK";
  const enterWatchMode = () => {
    setWatchMode(true);
    void document.documentElement.requestFullscreen?.().catch(() => undefined);
  };
  const exitWatchMode = () => {
    setWatchMode(false);
    if (document.fullscreenElement) void document.exitFullscreen();
  };
  const togglePinned = (id: string) => {
    setPinnedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };
  const addWinnerToast = (winner: WinnerNotification) => {
    setWinnerToasts((current) => [...current.filter((item) => item.id !== winner.id), winner].slice(-5));
    window.setTimeout(() => {
      setWinnerToasts((current) => current.filter((item) => item.id !== winner.id));
    }, 12000);
  };
  const addLostToast = (lost: LostNotification) => {
    setLostToasts((current) => [...current.filter((item) => item.id !== lost.id), lost].slice(-5));
    window.setTimeout(() => {
      setLostToasts((current) => current.filter((item) => item.id !== lost.id));
    }, 12000);
  };
  const shareView = async () => {
    const params = new URLSearchParams();
    if (selectedIds.length) params.set("seats", selectedIds.join(","));
    if (partyFilter !== "all") params.set("filter", partyFilter);
    if (sortMode !== "selected") params.set("sort", sortMode);
    const url = `${window.location.origin}${window.location.pathname}${params.toString() ? `?${params}` : ""}`;
    await navigator.clipboard?.writeText(url).catch(() => undefined);
    window.history.replaceState(null, "", url);
    setToast("Share link copied for this view.");
    window.setTimeout(() => setToast(""), 3500);
  };
  const manualRefresh = () => {
    if (isFetching) return;
    if (resultQueries.length) {
      resultQueries.forEach((query) => void query.refetch());
      void partySummaryQuery.refetch();
      void allSummaryQuery.refetch();
    } else {
      void constituenciesQuery.refetch();
    }
  };

  return (
    <main className="min-h-screen">
      {!watchMode && <section className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mx-auto flex w-full max-w-[2200px] flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">Official ECI Source</p>
              <h1 className="mt-2 text-3xl font-bold text-zinc-950 dark:text-white">Kerala Assembly Election 2026 Live Tracker</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600 dark:text-zinc-300">
                Track only the constituencies you care about, refreshed every {sourceConfigQuery.data?.refreshIntervalSeconds ?? 30} seconds from configured ECI result pages.
              </p>
            </div>
            <div className="flex items-center gap-1.5 overflow-x-auto sm:gap-2">
              <button className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-semibold dark:border-zinc-700" onClick={() => setDarkMode(!darkMode)}>
                {darkMode ? <Sun className="mr-2 inline h-4 w-4" /> : <Moon className="mr-2 inline h-4 w-4" />}
                {darkMode ? "Light" : "Dark"}
              </button>
              <button className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-semibold dark:border-zinc-700" onClick={() => setSoundEnabled(!soundEnabled)}>
                <Bell className="mr-2 inline h-4 w-4" />
                Alerts {soundEnabled ? "On" : "Off"}
              </button>
              <button
                className="rounded-md bg-zinc-950 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-zinc-950"
                onClick={manualRefresh}
                disabled={isFetching}
              >
                <RefreshCw className={`mr-2 inline h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
                Refresh Now
              </button>
              <button
                className="shrink-0 rounded-md border border-zinc-300 px-3 py-2 text-sm font-semibold dark:border-zinc-700"
                onClick={enterWatchMode}
                title="Watch mode"
                aria-label="Watch mode"
              >
                ⛶
              </button>
            </div>
          </div>

          <div className="hidden gap-3 md:grid md:grid-cols-4">
            <DashboardMetrics selectedCount={selectedIds.length} countdown={countdown} lastSuccessAt={lastSuccessAt} sourceHealth={sourceHealth} />
          </div>
        </div>
      </section>}

      <section className={`${watchMode ? "mx-auto w-full max-w-[2400px] px-4 py-4 sm:px-6 lg:px-8" : "mx-auto w-full max-w-[2200px] px-4 py-6 sm:px-6 lg:px-8"}`}>
        {watchMode && (
          <button
            className="fixed right-4 top-4 z-50 rounded-full border border-zinc-200 bg-white p-3 text-zinc-700 shadow-lg hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
            onClick={exitWatchMode}
            title="Exit watch mode"
            aria-label="Exit watch mode"
          >
            <Maximize2 className="h-5 w-5 rotate-180" />
          </button>
        )}
        {watchMode && (
          <button
            className={`fixed right-4 top-20 z-50 rounded-full border p-3 shadow-lg ${autoScroll ? "border-emerald-500 bg-emerald-600 text-white" : "border-zinc-200 bg-white text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"}`}
            onClick={() => setAutoScroll(!autoScroll)}
            title={autoScroll ? "Stop auto scroll" : "Start auto scroll"}
            aria-label={autoScroll ? "Stop auto scroll" : "Start auto scroll"}
          >
            <Play className="h-5 w-5" />
          </button>
        )}
        {hasSourceWarning && (
          <div className="mb-5 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
            <AlertTriangle className="mr-2 inline h-4 w-4" />
            {constituenciesQuery.data?.warning ?? summaryQuery.data?.errors?.[0]?.message}
          </div>
        )}

        {leaderChanges.length > 0 && (
          <div className="mb-5 rounded-md border border-emerald-300 bg-emerald-50 p-4 text-sm font-semibold text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100">
            Leader changed in {leaderChanges.map((item) => item.constituencyName).join(", ")}.
          </div>
        )}

        <div className={watchMode ? "block" : `grid gap-5 ${sidebarCollapsed ? "lg:grid-cols-[72px_minmax(0,1fr)]" : "lg:grid-cols-[260px_minmax(0,1fr)]"}`}>
          {!watchMode && <aside className="order-2 space-y-4 lg:order-none lg:col-start-1 lg:row-start-1">
            <ConstituencySelector
              options={constituenciesQuery.data?.constituencies ?? []}
              selectedIds={selectedIds}
              onChange={setSelectedIds}
              isLoading={constituenciesQuery.isLoading}
              collapsed={sidebarCollapsed}
              onCollapsedChange={setSidebarCollapsed}
            />
            {!sidebarCollapsed && (
              <CandidateWatchlist
                candidates={candidatesQuery.data?.candidates ?? []}
                watchedCandidates={watchedCandidates}
                isLoading={candidatesQuery.isLoading || candidatesQuery.isFetching}
                onSelect={(candidate) => {
                  setWatchedCandidateIds((current) => current.includes(candidate.candidateId) ? current : [...current, candidate.candidateId]);
                  setSelectedIds((current) => current.includes(candidate.constituencyId) ? current : [...current, candidate.constituencyId]);
                }}
                onRemove={(candidateId) => setWatchedCandidateIds((current) => current.filter((id) => id !== candidateId))}
              />
            )}
          </aside>}

          <div
            className={watchMode ? "grid content-start gap-4" : "order-1 grid content-start gap-4 lg:col-start-2 lg:row-span-2 lg:row-start-1"}
            style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${watchMode ? "360px" : "320px"}), 1fr))` }}
          >
            {selectedIds.length === 0 && <EmptyState />}
            {selectedOptions.map((option, index) => {
              const query = resultQueries[index];
              const result = query?.data;
              const previous = result ? previousResults.get(result.constituencyId) : undefined;
              const sortedResult = sortedResults.find((item) => item.constituencyId === option.constituencyId);
              if (sortedResult) return null;
              if (result && !sortedResult) return null;
              return (
                <ResultPlaceholder
                  key={option.constituencyId}
                  option={option}
                  error={query?.error instanceof Error ? query.error.message : undefined}
                  loading={query?.isLoading || isFetching}
                  summary={summaryQuery.data?.results.find((item) => item.constituencyId === option.constituencyId)}
                  previous={previous}
                />
              );
            })}
            {sortedResults.map((result) => (
              <ResultCard
                key={result.constituencyId}
                result={result}
                previous={previousResults.get(result.constituencyId)}
                checkedAt={checkedAtById[result.constituencyId] || lastCheckedById[result.constituencyId] || lastSuccessAt}
                isPinned={pinnedIds.includes(result.constituencyId)}
                onTogglePin={() => togglePinned(result.constituencyId)}
                changedAt={lastChangedAt[result.constituencyId]}
                leaderChanged={leaderChanges.some((item) => item.constituencyId === result.constituencyId)}
                history={leaderHistory[result.constituencyId] ?? []}
                note={constituencyNotes[result.constituencyId] ?? ""}
                onNoteChange={(note) => setConstituencyNotes((current) => ({ ...current, [result.constituencyId]: note }))}
              />
            ))}
          </div>
          {!watchMode && !sidebarCollapsed && (
            <div className="order-3 flex flex-col gap-4 lg:col-start-1 lg:row-start-2">
              <div className="panel rounded-md p-4">
                <label className="text-sm font-semibold text-zinc-700 dark:text-zinc-200" htmlFor="sort">Sort cards</label>
                <select
                  id="sort"
                  className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                  value={sortMode}
                  onChange={(event) => setSortMode(event.target.value as SortMode)}
                >
                  <option value="selected">Selected order</option>
                  <option value="marginAsc">Closest margins first</option>
                  <option value="marginDesc">Largest leads first</option>
                  <option value="leader">Leading candidate</option>
                </select>
                <label className="mt-3 block text-sm font-semibold text-zinc-700 dark:text-zinc-200" htmlFor="party-filter">Watch group</label>
                <select
                  id="party-filter"
                  className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                  value={partyFilter}
                  onChange={(event) => setPartyFilter(event.target.value)}
                >
                  <option value="all">All selected</option>
                  <option value="close">Close fights</option>
                  {partyOptions.map((party) => (
                    <option key={party} value={party}>{party}</option>
                  ))}
                </select>
                <div className="mt-4 flex gap-2">
                  <button className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm font-semibold dark:border-zinc-700" onClick={() => downloadJson(results)} disabled={!results.length}>
                    <Download className="mr-2 inline h-4 w-4" />
                    JSON
                  </button>
                  <button className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm font-semibold dark:border-zinc-700" onClick={() => downloadCsv(results)} disabled={!results.length}>
                    <Download className="mr-2 inline h-4 w-4" />
                    CSV
                  </button>
                </div>
                <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                  <label className="sr-only" htmlFor="alert-threshold">Close alert margin</label>
                  <input
                    id="alert-threshold"
                    type="number"
                    min={100}
                    step={100}
                    className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                    value={alertThreshold}
                    onChange={(event) => setAlertThreshold(Number(event.target.value.replace(/\D/g, "")) || 1000)}
                    title="Close alert margin"
                  />
                  <button className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-semibold dark:border-zinc-700" onClick={shareView} title="Copy share link">
                    <Share2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <SourceConfigPanel
                sourceConfig={sourceConfigQuery.data}
                onUpdated={() => {
                  void queryClient.invalidateQueries({ queryKey: ["source-config"] });
                  void queryClient.invalidateQueries({ queryKey: ["constituencies"] });
                  void queryClient.invalidateQueries({ queryKey: ["summary"] });
                  void queryClient.invalidateQueries({ queryKey: ["result"] });
                  void queryClient.invalidateQueries({ queryKey: ["party-summary"] });
                  void queryClient.invalidateQueries({ queryKey: ["candidates"] });
                }}
              />
            </div>
          )}
          {!watchMode && (
            <div className="order-4 grid gap-3 md:hidden">
              <DashboardMetrics selectedCount={selectedIds.length} countdown={countdown} lastSuccessAt={lastSuccessAt} sourceHealth={sourceHealth} />
            </div>
          )}
        </div>
      </section>
      <PartySummaryDock parties={partySummaryQuery.data?.parties ?? []} checkedAt={partySummaryQuery.dataUpdatedAt} traffic={trafficQuery.data} />
      {toast && (
        <div className="fixed right-4 top-4 z-[60] max-w-sm rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-950 shadow-lg dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100">
          {toast}
        </div>
      )}
      {winnerToasts.length > 0 && (
        <div className="fixed bottom-24 right-4 z-[70] flex w-[calc(100vw-2rem)] max-w-md flex-col gap-3 sm:bottom-4">
          {winnerToasts.map((winner) => (
            <WinnerToast key={winner.id} winner={winner} onClose={() => setWinnerToasts((current) => current.filter((item) => item.id !== winner.id))} />
          ))}
        </div>
      )}
      {lostToasts.length > 0 && (
        <div className="fixed bottom-24 left-4 z-[70] flex w-[calc(100vw-2rem)] max-w-md flex-col gap-3 sm:bottom-24">
          {lostToasts.map((lost) => (
            <LostToast key={lost.id} lost={lost} onClose={() => setLostToasts((current) => current.filter((item) => item.id !== lost.id))} />
          ))}
        </div>
      )}
      <LiveAudioPlayer
        channels={LIVE_CHANNELS}
        selectedChannelId={selectedLiveChannelId}
        onSelectedChannelIdChange={setSelectedLiveChannelId}
        started={liveAudioStarted}
        expanded={liveAudioExpanded}
        onStart={() => {
          setLiveAudioStarted(true);
          setLiveAudioExpanded(true);
        }}
        onExpandedChange={setLiveAudioExpanded}
        onStop={() => {
          setLiveAudioStarted(false);
          setLiveAudioExpanded(false);
        }}
      />
    </main>
  );
}

function DashboardMetrics({
  selectedCount,
  countdown,
  lastSuccessAt,
  sourceHealth
}: {
  selectedCount: number;
  countdown: number;
  lastSuccessAt: number;
  sourceHealth: string;
}) {
  return (
    <>
      <Metric label="Selected" value={String(selectedCount)} />
      <Metric label="Next refresh" value={`${countdown}s`} />
      <Metric label="Last sync" value={lastSuccessAt ? new Date(lastSuccessAt).toLocaleTimeString() : "Waiting"} />
      <Metric label="Source" value={sourceHealth} />
    </>
  );
}

function WinnerToast({ winner, onClose }: { winner: WinnerNotification; onClose: () => void }) {
  return (
    <div className="animate-winner-toast rounded-md border border-emerald-300 bg-white p-3 shadow-2xl dark:border-emerald-800 dark:bg-zinc-950" role="status" aria-live="polite">
      <div className="flex items-start gap-3">
        <CandidatePhoto candidateName={winner.candidateName} photoUrl={winner.photoUrl} size="large" tone="leading" />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-black uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Winner Declared</div>
          <div className="mt-1 truncate text-lg font-black text-zinc-950 dark:text-white" title={winner.candidateName}>{winner.candidateName}</div>
          <div className="truncate text-sm font-bold text-zinc-600 dark:text-zinc-300" title={winner.party}>{shortPartyName(winner.party)}</div>
          <div className="mt-1 truncate text-xs font-semibold text-zinc-500">{winner.constituencyName}</div>
        </div>
        <button className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-bold dark:border-zinc-700" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-md bg-emerald-50 p-2 dark:bg-emerald-950/50">
          <div className="text-[10px] font-black uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Total votes</div>
          <div className="mt-1 text-xl font-black text-zinc-950 dark:text-white">{formatNumber(winner.totalVotes)}</div>
        </div>
        <div className="rounded-md bg-zinc-100 p-2 dark:bg-zinc-900">
          <div className="text-[10px] font-black uppercase tracking-wide text-zinc-500">Winning margin</div>
          <div className="mt-1 text-xl font-black text-emerald-700 dark:text-emerald-300">{formatNumber(winner.margin)}</div>
        </div>
      </div>
    </div>
  );
}

function LostToast({ lost, onClose }: { lost: LostNotification; onClose: () => void }) {
  return (
    <div className="animate-winner-toast rounded-md border border-rose-300 bg-white p-3 shadow-2xl dark:border-rose-800 dark:bg-zinc-950" role="status" aria-live="polite">
      <div className="flex items-start gap-3">
        <CandidatePhoto candidateName={lost.candidateName} photoUrl={lost.photoUrl} size="large" tone="trailing" />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-black uppercase tracking-wide text-rose-700 dark:text-rose-300">Narrow Loss</div>
          <div className="mt-1 truncate text-lg font-black text-zinc-950 dark:text-white" title={lost.candidateName}>{lost.candidateName}</div>
          <div className="truncate text-sm font-bold text-zinc-600 dark:text-zinc-300" title={lost.party}>{shortPartyName(lost.party)}</div>
          <div className="mt-1 truncate text-xs font-semibold text-zinc-500">{lost.constituencyName}</div>
        </div>
        <button className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-bold dark:border-zinc-700" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-md bg-rose-50 p-2 dark:bg-rose-950/50">
          <div className="text-[10px] font-black uppercase tracking-wide text-rose-700 dark:text-rose-300">Lost by</div>
          <div className="mt-1 text-xl font-black text-rose-700 dark:text-rose-300">{formatNumber(lost.margin)}</div>
        </div>
        <div className="rounded-md bg-zinc-100 p-2 dark:bg-zinc-900">
          <div className="text-[10px] font-black uppercase tracking-wide text-zinc-500">Total votes</div>
          <div className="mt-1 text-xl font-black text-zinc-950 dark:text-white">{formatNumber(lost.totalVotes)}</div>
        </div>
      </div>
      <div className="mt-2 truncate text-[10px] font-semibold text-zinc-500">
        Winner: {lost.winnerName}
      </div>
    </div>
  );
}

function LiveAudioPlayer({
  channels,
  selectedChannelId,
  onSelectedChannelIdChange,
  started,
  expanded,
  onStart,
  onExpandedChange,
  onStop
}: {
  channels: typeof LIVE_CHANNELS;
  selectedChannelId: string;
  onSelectedChannelIdChange: (channelId: string) => void;
  started: boolean;
  expanded: boolean;
  onStart: () => void;
  onExpandedChange: (expanded: boolean) => void;
  onStop: () => void;
}) {
  const selectedChannel = channels.find((channel) => channel.id === selectedChannelId) ?? channels[0];
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const requestPlay = () => {
    iframeRef.current?.contentWindow?.postMessage(JSON.stringify({
      event: "command",
      func: "playVideo",
      args: []
    }), "https://www.youtube.com");
  };

  useEffect(() => {
    if (!started) return;
    const timer = window.setTimeout(requestPlay, 500);
    return () => window.clearTimeout(timer);
  }, [selectedChannel.videoId, started]);

  if (!started) {
    return (
      <button
        className="fixed bottom-28 left-4 z-50 inline-flex items-center gap-2 rounded-md border border-zinc-200 bg-white/95 px-3 py-2 text-sm font-black text-zinc-800 shadow-lg backdrop-blur hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-950/95 dark:text-zinc-100 dark:hover:bg-zinc-900 sm:bottom-24"
        onClick={() => {
          onStart();
          window.setTimeout(requestPlay, 700);
        }}
        title="Live audio"
      >
        <Volume2 className="h-4 w-4 text-emerald-700 dark:text-emerald-300" />
        Live
      </button>
    );
  }

  return (
    <div className={`fixed bottom-28 left-4 z-50 rounded-md border border-zinc-200 bg-white/95 p-3 shadow-2xl backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95 sm:bottom-24 ${expanded ? "w-[min(320px,calc(100vw-2rem))]" : "w-auto"}`}>
      <div className="flex items-center gap-2">
        <Volume2 className="h-4 w-4 text-emerald-700 dark:text-emerald-300" />
        {expanded ? (
          <select
            className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs font-bold dark:border-zinc-700 dark:bg-zinc-900"
            value={selectedChannel.id}
            onChange={(event) => onSelectedChannelIdChange(event.target.value)}
            aria-label="Live channel"
          >
            {channels.map((channel) => (
              <option key={channel.id} value={channel.id}>{channel.label}</option>
            ))}
          </select>
        ) : (
          <button className="max-w-32 truncate text-left text-sm font-black" onClick={() => onExpandedChange(true)} title={selectedChannel.label}>
            {selectedChannel.label}
          </button>
        )}
        <button className="rounded-md border border-zinc-300 p-1.5 dark:border-zinc-700" onClick={() => onExpandedChange(!expanded)} title={expanded ? "Minimize live audio" : "Expand live audio"}>
          {expanded ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <button className="rounded-md border border-zinc-300 p-1.5 text-xs font-black dark:border-zinc-700" onClick={requestPlay} title="Play live audio">
          <Play className="h-4 w-4" />
        </button>
        <button className="rounded-md border border-zinc-300 p-1.5 dark:border-zinc-700" onClick={onStop} title="Stop live audio">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className={`${expanded ? "mt-3 h-auto opacity-100" : "pointer-events-none h-px w-px opacity-0"} overflow-hidden rounded-md border border-zinc-200 bg-black dark:border-zinc-800`}>
        <iframe
          ref={iframeRef}
          key={selectedChannel.videoId}
          className="aspect-video w-full"
          src={`https://www.youtube.com/embed/${selectedChannel.videoId}?autoplay=1&playsinline=1&rel=0&enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}`}
          title={`${selectedChannel.label} live`}
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
        />
      </div>
      {expanded && (
        <p className="mt-2 text-[10px] font-semibold leading-4 text-zinc-500">
          Click play once if the browser blocks audio. Minimize keeps audio alive.
        </p>
      )}
    </div>
  );
}

function CandidateWatchlist({
  candidates,
  watchedCandidates,
  isLoading,
  onSelect,
  onRemove
}: {
  candidates: CandidateOption[];
  watchedCandidates: CandidateOption[];
  isLoading: boolean;
  onSelect: (candidate: CandidateOption) => void;
  onRemove: (candidateId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const watchedIds = new Set(watchedCandidates.map((candidate) => candidate.candidateId));
  const matches = search.trim().length < 2
    ? []
    : candidates
        .filter((candidate) => !watchedIds.has(candidate.candidateId))
        .filter((candidate) =>
          `${candidate.candidateName} ${candidate.party} ${candidate.constituencyName} ${candidate.constituencyNumber}`.toLowerCase().includes(search.toLowerCase())
        )
        .slice(0, 8);

  return (
    <div className="panel rounded-md p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-bold text-zinc-950 dark:text-white">Candidate Watch</h2>
        <span className="text-xs font-bold text-zinc-500">{watchedCandidates.length}</span>
      </div>
      <div className="relative mt-3">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
        <input
          className="w-full rounded-md border border-zinc-300 bg-white py-2 pl-9 pr-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          placeholder={isLoading ? "Loading candidates..." : "Search candidate"}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      {watchedCandidates.length > 0 && (
        <div className="mt-3 flex max-h-24 flex-wrap gap-1 overflow-y-auto">
          {watchedCandidates.map((candidate) => (
            <button
              key={candidate.candidateId}
              className="rounded-md bg-sky-100 px-2 py-1 text-xs font-bold text-sky-900 dark:bg-sky-900 dark:text-sky-100"
              onClick={() => onRemove(candidate.candidateId)}
              title={`Remove ${candidate.candidateName}`}
            >
              {candidate.candidateName} ×
            </button>
          ))}
        </div>
      )}
      {search.trim().length >= 2 && (
        <div className="mt-2 max-h-56 overflow-y-auto rounded-md border border-zinc-200 dark:border-zinc-800">
          {isLoading && <div className="p-3 text-sm text-zinc-500">Building candidate list once...</div>}
          {!isLoading && matches.length === 0 && <div className="p-3 text-sm text-zinc-500">No candidate found.</div>}
          {matches.map((candidate) => (
            <button
              key={candidate.candidateId}
              className="block w-full border-b border-zinc-100 px-3 py-2 text-left last:border-b-0 hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-900"
              onClick={() => {
                onSelect(candidate);
                setSearch("");
              }}
            >
              <div className="truncate text-sm font-black text-zinc-950 dark:text-white">{candidate.candidateName}</div>
              <div className="mt-0.5 truncate text-xs font-semibold text-zinc-500">
                {shortPartyName(candidate.party)} · {candidate.constituencyName} ({candidate.constituencyNumber})
              </div>
            </button>
          ))}
        </div>
      )}
      {candidates.length > 0 && (
        <div className="mt-2 text-[10px] font-semibold text-zinc-500">
          {formatNumber(candidates.length)} candidates indexed.
        </div>
      )}
    </div>
  );
}

function ConstituencySelector({
  options,
  selectedIds,
  onChange,
  isLoading,
  collapsed,
  onCollapsedChange
}: {
  options: ConstituencyOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  isLoading: boolean;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(true);
  const selected = new Set(selectedIds);
  const selectedOptions = selectedIds
    .map((id) => options.find((option) => option.constituencyId === id))
    .filter(Boolean) as ConstituencyOption[];
  const filtered = options.filter((option) =>
    `${option.constituencyName} ${option.constituencyNumber}`.toLowerCase().includes(search.toLowerCase())
  );
  const favorites = options.filter((option) => option.isFavoriteDefault);

  const toggle = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange([...next]);
  };

  if (collapsed) {
    return (
      <div className="panel rounded-md p-2">
        <button
          className="flex w-full flex-col items-center gap-2 rounded-md border border-zinc-300 px-2 py-3 text-xs font-bold dark:border-zinc-700"
          onClick={() => onCollapsedChange(false)}
          title="Expand constituencies"
          aria-label="Expand constituencies"
        >
          <ChevronRight className="h-4 w-4" />
          <span>{selectedIds.length}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="panel rounded-md p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-bold text-zinc-950 dark:text-white">Constituencies</h2>
        <div className="flex items-center gap-2">
          {selectedIds.length > 0 && (
            <button className="text-sm font-semibold text-red-600 dark:text-red-400" onClick={() => onChange([])}>
              Clear
            </button>
          )}
          <button className="text-sm font-semibold text-emerald-700 dark:text-emerald-400" onClick={() => onChange(favorites.map((item) => item.constituencyId))}>
            Use favorites
          </button>
          <button
            className="rounded-md border border-zinc-300 p-1.5 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
            onClick={() => onCollapsedChange(true)}
            title="Collapse constituencies"
            aria-label="Collapse constituencies"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        </div>
      </div>
      <button
        className="mt-3 w-full rounded-md border border-zinc-300 px-3 py-2 text-left text-sm font-semibold dark:border-zinc-700"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        {selectedIds.length ? `${selectedIds.length} selected` : "Select constituencies"}
      </button>
      {open && (
        <>
          {selectedOptions.length > 0 && (
            <div className="mt-3 flex max-h-24 flex-wrap gap-1 overflow-y-auto rounded-md border border-zinc-200 p-2 dark:border-zinc-800">
              {selectedOptions.map((option) => (
                <button
                  key={option.constituencyId}
                  className="rounded-md bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100"
                  onClick={() => toggle(option.constituencyId)}
                  title={`Remove ${option.constituencyName}`}
                >
                  {option.constituencyName} ×
                </button>
              ))}
            </div>
          )}
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
            <input
              className="w-full rounded-md border border-zinc-300 bg-white py-2 pl-9 pr-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              placeholder="Search constituency"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="mt-3 max-h-[460px] overflow-y-auto pr-1">
            {isLoading && <p className="py-4 text-sm text-zinc-500">Loading constituencies...</p>}
            {!isLoading && filtered.length === 0 && <p className="py-4 text-sm text-zinc-500">No constituencies found.</p>}
            {filtered.map((option) => (
              <div
                key={option.constituencyId}
                role="button"
                tabIndex={0}
                className="flex w-full cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-900"
                onClick={() => toggle(option.constituencyId)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    toggle(option.constituencyId);
                  }
                }}
              >
                <input
                  type="checkbox"
                  checked={selected.has(option.constituencyId)}
                  onClick={(event) => event.stopPropagation()}
                  onChange={() => toggle(option.constituencyId)}
                  className="h-4 w-4 accent-emerald-700"
                />
                <span className="min-w-10 rounded-md bg-zinc-100 px-2 py-1 text-center text-xs font-bold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-200">
                  {option.constituencyNumber}
                </span>
                <span className="flex-1 text-sm font-medium">{option.constituencyName}</span>
                {option.isFavoriteDefault && <Star className="h-4 w-4 fill-amber-400 text-amber-500" />}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function SourceConfigPanel({
  sourceConfig,
  onUpdated
}: {
  sourceConfig?: PublicSourceConfig;
  onUpdated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState(() => sessionStorage.getItem("kerala-election:admin-password") ?? "");
  const [baseUrl, setBaseUrl] = useState(sourceConfig?.baseUrl ?? "");
  const [constituencyListUrl, setConstituencyListUrl] = useState(sourceConfig?.constituencyListUrl ?? "");
  const [candidateDetailUrlTemplate, setCandidateDetailUrlTemplate] = useState(sourceConfig?.candidateDetailUrlTemplate ?? "");
  const [refreshIntervalSeconds, setRefreshIntervalSeconds] = useState(String(sourceConfig?.refreshIntervalSeconds ?? 30));

  useEffect(() => {
    if (!sourceConfig) return;
    setBaseUrl(sourceConfig.baseUrl);
    setConstituencyListUrl(sourceConfig.constituencyListUrl);
    setCandidateDetailUrlTemplate(sourceConfig.candidateDetailUrlTemplate);
    setRefreshIntervalSeconds(String(sourceConfig.refreshIntervalSeconds));
  }, [sourceConfig]);

  const mutation = useMutation({
    mutationFn: () =>
      updateSourceConfig(password, {
        baseUrl,
        constituencyListUrl,
        candidateDetailUrlTemplate,
        refreshIntervalSeconds: Number(refreshIntervalSeconds)
      }),
    onSuccess: () => {
      sessionStorage.setItem("kerala-election:admin-password", password);
      onUpdated();
    }
  });
  const applyKeralaPreset = () => {
    const list = constituencyListUrl || "https://results.eci.gov.in/Kerala2026/statewiseS111.htm";
    const match = list.match(/^(.*\/)(statewise)(S\d+?)1\.htm$/i);
    if (match) {
      setBaseUrl(new URL(list).origin);
      setCandidateDetailUrlTemplate(`${match[1]}candidateswise-${match[3]}{constituencyNumber}.htm`);
    } else {
      setBaseUrl("https://results.eci.gov.in");
      setConstituencyListUrl("https://results.eci.gov.in/<KeralaElectionFolder>/statewiseS111.htm");
      setCandidateDetailUrlTemplate("https://results.eci.gov.in/<KeralaElectionFolder>/candidateswise-S11{constituencyNumber}.htm");
    }
  };

  return (
    <div className="panel rounded-md p-4">
      <button className="flex w-full items-center justify-between text-left font-bold" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span><Settings className="mr-2 inline h-4 w-4" /> Source URLs</span>
        <Lock className="h-4 w-4 text-zinc-500" />
      </button>
      <p className="mt-2 text-xs leading-5 text-zinc-500">
        Admin-only runtime settings. Detail templates must include {"{constituencyNumber}"}.
      </p>
      {open && (
        <div className="mt-4 space-y-3">
          <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500" htmlFor="base-url">Base URL</label>
          <input
            id="base-url"
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
          />
          <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500" htmlFor="list-url">Constituency list URL</label>
          <input
            id="list-url"
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            value={constituencyListUrl}
            onChange={(event) => setConstituencyListUrl(event.target.value)}
          />
          <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500" htmlFor="detail-url">Candidate detail URL template</label>
          <input
            id="detail-url"
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            value={candidateDetailUrlTemplate}
            onChange={(event) => setCandidateDetailUrlTemplate(event.target.value)}
          />
          <button
            className="w-full rounded-md border border-emerald-300 px-3 py-2 text-sm font-semibold text-emerald-800 dark:border-emerald-800 dark:text-emerald-300"
            onClick={applyKeralaPreset}
            type="button"
          >
            Kerala 2026 preset
          </button>
          <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500" htmlFor="refresh-seconds">Refresh seconds</label>
          <input
            id="refresh-seconds"
            type="number"
            min={5}
            max={300}
            step={1}
            inputMode="numeric"
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            value={refreshIntervalSeconds}
            onChange={(event) => setRefreshIntervalSeconds(event.target.value.replace(/\D/g, ""))}
          />
          <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500" htmlFor="admin-password">Admin password</label>
          <input
            id="admin-password"
            type="password"
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <button
            className="w-full rounded-md bg-zinc-950 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-zinc-950"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? "Saving..." : "Save Source URLs"}
          </button>
          {mutation.isError && <p className="text-sm text-red-600">{mutation.error instanceof Error ? mutation.error.message : "Could not save source URLs."}</p>}
          {mutation.isSuccess && <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">Source URLs updated.</p>}
          {sourceConfig && (
            <p className="text-xs text-zinc-500">
              Last updated by {sourceConfig.updatedBy} at {new Date(sourceConfig.updatedAt).toLocaleString()}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function PartySummaryDock({
  parties,
  checkedAt,
  traffic
}: {
  parties: { party: string; won: number; leading: number; total: number; color?: string }[];
  checkedAt?: number;
  traffic?: { watchingNow: number; totalViews: number };
}) {
  if (!parties.length && !traffic) return null;
  const visibleParties = parties.slice(0, 8);
  const totalSeats = parties.reduce((sum, party) => sum + party.total, 0);

  return (
    <div key={checkedAt ?? 0} className="animate-summary-refresh fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200 bg-white/95 shadow-[0_-12px_30px_rgba(15,23,42,0.12)] backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
      <div className="mx-auto flex max-w-7xl items-center gap-3 overflow-x-auto px-4 py-2 pr-28 sm:px-6 sm:pr-32 lg:px-8">
        {parties.length > 0 && (
          <div className="shrink-0 pr-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Seats</div>
            <div className="text-sm font-black text-zinc-950 dark:text-white">{formatNumber(totalSeats)}</div>
          </div>
        )}
        {visibleParties.map((party) => (
          <div
            key={`${party.party}-${checkedAt ?? 0}`}
            className="animate-party-card-refresh flex min-w-36 shrink-0 items-center gap-3 rounded-md border border-black/10 px-3 py-2 text-white shadow-sm"
            style={{ backgroundColor: party.color ?? "#71717a" }}
          >
            <div className="text-3xl font-black leading-none">{formatNumber(party.total)}</div>
            <div className="min-w-0">
              <div className="max-w-28 truncate text-xs font-black" title={party.party}>{shortPartyName(party.party)}</div>
              <div className="mt-1 flex gap-2 text-[10px] font-bold text-white/90">
                <span>Won {party.won}</span>
                <span>Lead {party.leading}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
      {traffic && (
        <div className="absolute bottom-2 right-3 flex items-center gap-3 rounded-md border border-zinc-200 bg-white/95 px-3 py-2 text-zinc-600 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/95 dark:text-zinc-300">
          <span className="inline-flex items-center gap-1 text-xs font-black" title="Watching now">
            <Users className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-300" />
            {formatNumber(traffic.watchingNow)}
          </span>
          <span className="inline-flex items-center gap-1 text-xs font-black" title="Total views">
            <Eye className="h-3.5 w-3.5 text-sky-700 dark:text-sky-300" />
            {formatNumber(traffic.totalViews)}
          </span>
        </div>
      )}
    </div>
  );
}

function ResultCard({
  result,
  previous,
  checkedAt,
  isPinned,
  onTogglePin,
  changedAt,
  leaderChanged,
  history,
  note,
  onNoteChange
}: {
  result: ConstituencyResult;
  previous?: ConstituencyResult;
  checkedAt?: number;
  isPinned: boolean;
  onTogglePin: () => void;
  changedAt?: number;
  leaderChanged: boolean;
  history: LeaderHistoryEntry[];
  note: string;
  onNoteChange: (note: string) => void;
}) {
  const [notesOpen, setNotesOpen] = useState(false);
  const leader = result.candidates[0];
  const runnerUp = result.candidates[1];
  const moreCandidates = result.candidates.slice(2, 4);
  const marginChange = previous ? result.margin - previous.margin : 0;
  const leaderName = result.leadingCandidate || leader?.candidateName || "-";
  const leaderParty = shortPartyName(result.leadingParty || leader?.party || "-");
  const runnerName = result.trailingCandidate || runnerUp?.candidateName || "-";
  const runnerParty = shortPartyName(result.trailingParty || runnerUp?.party || "-");
  const roundProgress = parseRoundProgress(result.roundStatus || result.statusText);
  const countingPercent = roundProgress ? Math.min(100, Math.round((roundProgress.current / roundProgress.total) * 100)) : undefined;
  const statusForDisplay = result.statusText || result.roundStatus;
  const declared = isDeclaredWinner(result.statusText || result.roundStatus);
  const closeFight = result.margin <= 5000;
  const veryCloseFight = result.margin <= 1000;

  return (
    <article key={`${result.constituencyId}-${checkedAt ?? 0}`} className={`panel animate-card-refresh relative overflow-visible rounded-md ${veryCloseFight ? "animate-close-fight ring-2 ring-rose-600" : closeFight ? "animate-close-watch ring-2 ring-amber-500" : ""}`}>
      <div className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-bold text-zinc-950 dark:text-white">{result.constituencyName}</h2>
            <StatusIcon status={statusForDisplay} />
            {leaderChanged && <span className="badge bg-rose-100 text-rose-900 dark:bg-rose-900 dark:text-rose-100">Changed</span>}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <HistoryTooltip history={history} />
            <button
              className={`rounded-md p-1 ${note ? "text-emerald-700 dark:text-emerald-300" : "text-zinc-400 hover:text-emerald-700"}`}
              onClick={() => setNotesOpen(!notesOpen)}
              title="Seat note"
              aria-label="Seat note"
            >
              <StickyNote className="h-4 w-4" />
            </button>
            <button
              className={`rounded-md p-1 ${isPinned ? "text-amber-500" : "text-zinc-400 hover:text-amber-500"}`}
              onClick={onTogglePin}
              title={isPinned ? "Unpin" : "Pin"}
              aria-label={isPinned ? "Unpin constituency" : "Pin constituency"}
            >
              <Star className={`h-4 w-4 ${isPinned ? "fill-current" : ""}`} />
            </button>
          </div>
        </div>
        </div>
      </div>
      <div className="px-4 pb-4">
        {notesOpen && (
          <textarea
            className="mt-3 h-16 w-full resize-none rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs dark:border-zinc-700 dark:bg-zinc-900"
            value={note}
            onChange={(event) => onNoteChange(event.target.value)}
            placeholder="Private note for this seat"
          />
        )}
        <div className="mt-4 grid grid-cols-[72px_1fr_auto] items-center gap-3">
          <CandidatePhoto candidateName={leaderName} photoUrl={leader?.photoUrl} size="large" tone="leading" crowned={declared} />
          <div className="min-w-0">
            <div className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
              <ArrowUp className="h-3.5 w-3.5" />
              Leading
            </div>
            <div className="mt-1 truncate text-base font-black text-zinc-950 dark:text-white" title={leaderName}>{leaderName}</div>
            <div className="truncate text-sm font-semibold text-zinc-600 dark:text-zinc-300" title={leaderParty}>{leaderParty}</div>
          </div>
          <div className="shrink-0 text-right">
            <div className={`text-xs font-semibold uppercase tracking-wide ${closeFight ? "text-amber-700 dark:text-amber-300" : "text-zinc-500"}`}>{veryCloseFight ? "Alert lead" : closeFight ? "Tight lead" : "Lead"}</div>
            <div className="text-lg font-black text-emerald-700 dark:text-emerald-300">{formatNumber(result.margin)}</div>
            <div className="mt-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Votes</div>
            <div className="text-sm font-black text-zinc-950 dark:text-white">{formatNumber(leader?.totalVotes ?? 0)}</div>
            {marginChange !== 0 && <div className="text-xs font-semibold text-zinc-500">{formatDelta(marginChange)}</div>}
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 rounded-md bg-zinc-100 px-2.5 py-2 dark:bg-zinc-900">
          <CandidatePhoto candidateName={runnerName} photoUrl={runnerUp?.photoUrl} size="tiny" tone="trailing" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-300">
              <ArrowDown className="h-3 w-3" />
              Trailing
            </div>
            <div className="truncate text-xs font-bold text-zinc-950 dark:text-white" title={runnerName}>{runnerName}</div>
            <div className="truncate text-xs font-semibold text-zinc-600 dark:text-zinc-300" title={runnerParty}>{runnerParty}</div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Votes</div>
            <div className="text-xs font-black text-zinc-950 dark:text-white">{formatNumber(runnerUp?.totalVotes ?? 0)}</div>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            {moreCandidates.map((candidate, index) => (
              <CandidateMiniTooltip key={`${candidate.serialNo}-${candidate.candidateName}`} candidate={candidate} position={index + 3} />
            ))}
          </div>
          <div className="text-right text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
            <div>Last checked {checkedAt ? new Date(checkedAt).toLocaleTimeString() : "-"}</div>
            {changedAt && <div>Changed {new Date(changedAt).toLocaleTimeString()}</div>}
          </div>
        </div>
      </div>
      {roundProgress && !declared && (
        <div className="relative h-4 overflow-hidden rounded-b-md bg-zinc-200 dark:bg-zinc-800" title={`Round ${roundProgress.current} of ${roundProgress.total}`}>
          <div className="h-full bg-gradient-to-r from-emerald-700 via-teal-500 to-sky-500" style={{ width: `${countingPercent}%` }} />
          <div className="absolute inset-0 flex items-center justify-center text-[10px] font-normal text-white">
            Counting: {countingPercent}% · R{roundProgress.current}/{roundProgress.total}
          </div>
        </div>
      )}
    </article>
  );
}

function CandidateMiniTooltip({
  candidate,
  position
}: {
  candidate: { candidateName: string; party: string; totalVotes: number; photoUrl?: string };
  position: number;
}) {
  return (
    <div className="group relative">
      <CandidatePhoto candidateName={candidate.candidateName} photoUrl={candidate.photoUrl} size="mini" />
      <div className="pointer-events-none absolute bottom-full left-0 z-30 mb-2 hidden w-48 rounded-md border border-zinc-200 bg-white p-2 text-left shadow-lg group-hover:block group-focus-within:block dark:border-zinc-800 dark:bg-zinc-950">
        <div className="text-[10px] font-black uppercase tracking-wide text-zinc-500">Position {position}</div>
        <div className="mt-1 text-xs font-black text-zinc-950 dark:text-white">{candidate.candidateName}</div>
        <div className="mt-0.5 text-[10px] font-semibold text-zinc-500">{shortPartyName(candidate.party)}</div>
        <div className="mt-1 text-xs font-black text-zinc-950 dark:text-white">{formatNumber(candidate.totalVotes)} votes</div>
      </div>
    </div>
  );
}

function HistoryTooltip({ history }: { history: LeaderHistoryEntry[] }) {
  return (
    <div className="group relative">
      <button
        className={`rounded-md p-1 ${history.length ? "text-sky-700 dark:text-sky-300" : "text-zinc-400"}`}
        title="Leader history"
        aria-label="Leader history"
        type="button"
      >
        <History className="h-4 w-4" />
      </button>
      <div className="pointer-events-none absolute right-0 top-full z-50 mt-2 hidden w-64 max-w-[calc(100vw-2rem)] rounded-md border border-zinc-200 bg-white p-3 text-left shadow-lg group-hover:block group-focus-within:block dark:border-zinc-800 dark:bg-zinc-950">
        <div className="text-[10px] font-black uppercase tracking-wide text-zinc-500">Recent movement</div>
        {history.length ? (
          <div className="mt-2 space-y-2">
            {history.map((entry) => (
              <div key={`${entry.at}-${entry.leader}`} className="text-xs">
                <div className="font-black text-zinc-950 dark:text-white">{entry.leader}</div>
                <div className="text-zinc-500">
                  {shortPartyName(entry.party)} by {formatNumber(entry.margin)} at {new Date(entry.at).toLocaleTimeString()}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-2 text-xs text-zinc-500">No change recorded in this browser yet.</div>
        )}
      </div>
    </div>
  );
}

function CandidateTable({ result, previous }: { result: ConstituencyResult; previous?: ConstituencyResult }) {
  const previousVotes = new Map(previous?.candidates.map((candidate) => [candidate.candidateName, candidate.totalVotes]) ?? []);
  const leaderName = result.candidates[0]?.candidateName;
  const runnerName = result.candidates[1]?.candidateName;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="bg-zinc-100 text-xs uppercase text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
          <tr>
            <th className="px-4 py-3">#</th>
            <th className="px-4 py-3">Candidate</th>
            <th className="px-4 py-3">Party</th>
            <th className="px-4 py-3 text-right">EVM</th>
            <th className="px-4 py-3 text-right">Postal</th>
            <th className="px-4 py-3 text-right">Total</th>
            <th className="px-4 py-3 text-right">Vote %</th>
            <th className="px-4 py-3 text-right">Change</th>
          </tr>
        </thead>
        <tbody>
          {result.candidates.map((candidate) => {
            const delta = candidate.totalVotes - (previousVotes.get(candidate.candidateName) ?? candidate.totalVotes);
            const isLeader = candidate.candidateName === leaderName;
            const isRunner = candidate.candidateName === runnerName;
            return (
              <tr key={`${candidate.serialNo}-${candidate.candidateName}`} className={isLeader ? "bg-emerald-50 dark:bg-emerald-950/40" : isRunner ? "bg-amber-50 dark:bg-amber-950/30" : ""}>
                <td className="px-4 py-3 font-semibold">{candidate.serialNo}</td>
                <td className="px-4 py-3">
                  <span className="font-semibold">{candidate.candidateName}</span>
                  {isLeader && <span className="badge ml-2 bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100">Leading</span>}
                  {isRunner && <span className="badge ml-2 bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100">Second</span>}
                </td>
                <td className="px-4 py-3">{candidate.party || "-"}</td>
                <td className="px-4 py-3 text-right">{formatNumber(candidate.evmVotes)}</td>
                <td className="px-4 py-3 text-right">{formatNumber(candidate.postalVotes)}</td>
                <td className="px-4 py-3 text-right font-bold">{formatNumber(candidate.totalVotes)}</td>
                <td className="px-4 py-3 text-right">{candidate.votePercent.toFixed(2)}</td>
                <td className={`px-4 py-3 text-right font-semibold ${delta > 0 ? "text-emerald-700 dark:text-emerald-300" : "text-zinc-500"}`}>{formatDelta(delta)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CandidatePhoto({
  candidateName,
  photoUrl,
  size,
  tone = "neutral",
  crowned = false
}: {
  candidateName: string;
  photoUrl?: string;
  size: "large" | "small" | "tiny" | "mini";
  tone?: "leading" | "trailing" | "neutral";
  crowned?: boolean;
}) {
  const classes = size === "large" ? "h-16 w-16" : size === "small" ? "h-12 w-12" : size === "tiny" ? "h-9 w-9" : "h-7 w-7";
  const toneClasses =
    tone === "leading"
      ? "ring-2 ring-emerald-700 dark:ring-emerald-400"
      : tone === "trailing"
        ? "ring-2 ring-rose-700 dark:ring-rose-400"
        : "ring-1 ring-zinc-300 dark:ring-zinc-700";
  return (
    <div className="relative shrink-0">
      {crowned && (
        <div className="absolute -right-1 -top-2 z-10 rounded-full bg-amber-400 p-1 text-amber-950 shadow-lg ring-2 ring-white dark:ring-zinc-950">
          <Crown className="h-4 w-4 fill-current" />
        </div>
      )}
      <div className={`${classes} ${toneClasses} overflow-hidden rounded-full border-2 border-white bg-zinc-200 shadow-sm dark:border-zinc-950 dark:bg-zinc-800`}>
        {photoUrl ? (
          <img className="h-full w-full object-cover" src={photoUrl} alt={candidateName} />
        ) : (
          <div className="flex h-full w-full items-center justify-center px-2 text-center text-xs font-black text-zinc-500">
            {initials(candidateName)}
          </div>
        )}
      </div>
    </div>
  );
}

function ResultPlaceholder({
  option,
  error,
  loading,
  summary
}: {
  option: ConstituencyOption;
  error?: string;
  loading?: boolean;
  summary?: { leadingCandidate?: string; leadingParty?: string; margin?: number; roundStatus?: string; statusText?: string };
  previous?: ConstituencyResult;
}) {
  return (
    <article className="panel rounded-md p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-bold">{option.constituencyName}</h2>
        <span className="badge bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">AC {option.constituencyNumber}</span>
      </div>
      {summary?.leadingCandidate && (
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
          {summary.leadingCandidate} ({summary.leadingParty}) leads by {formatNumber(summary.margin ?? 0)}.
        </p>
      )}
      <p className="mt-3 text-sm text-zinc-500">
        {error ? error : loading ? "Fetching candidate-wise result table..." : "Waiting for ECI detail page mapping."}
      </p>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 text-lg font-bold">{value}</div>
    </div>
  );
}

function Fact({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 font-bold text-zinc-950 dark:text-white">{value}</div>
      {sub && <div className="text-xs text-zinc-500">{sub}</div>}
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  const lower = status.toLowerCase();
  const declared = lower.includes("won") || lower.includes("declared");
  const leading = lower.includes("leading");
  const title = status || "Counting";

  if (declared) {
    return (
      <span className="inline-flex h-4 w-4 items-center justify-center rounded-sm bg-emerald-700 text-white shadow-sm ring-1 ring-emerald-800" title={title} aria-label={title}>
        <Check className="h-2.5 w-2.5 stroke-[4]" />
      </span>
    );
  }

  if (leading) {
    return (
      <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-sky-100 text-sky-800 ring-1 ring-sky-200 dark:bg-sky-900 dark:text-sky-100 dark:ring-sky-800" title={title} aria-label={title}>
        <ArrowUp className="h-3 w-3" />
      </span>
    );
  }

  return (
    <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200 dark:bg-emerald-900 dark:text-emerald-100 dark:ring-emerald-800" title={title} aria-label={title}>
      <Hourglass className="h-3 w-3 animate-hourglass" />
    </span>
  );
}

function EmptyState() {
  return (
    <div className="rounded-md border border-dashed border-zinc-300 p-10 text-center dark:border-zinc-700">
      <h2 className="text-xl font-bold">Choose constituencies or candidates to start tracking.</h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">Your watched seats and candidates stay saved in this browser.</p>
    </div>
  );
}

function sortResults(results: ConstituencyResult[], selectedIds: string[], sortMode: SortMode, pinnedIds: string[]) {
  const selectedOrder = new Map(selectedIds.map((id, index) => [id, index]));
  const pinned = new Set(pinnedIds);
  return [...results].sort((a, b) => {
    const pinnedDelta = Number(pinned.has(b.constituencyId)) - Number(pinned.has(a.constituencyId));
    if (pinnedDelta) return pinnedDelta;
    if (sortMode === "marginAsc") return a.margin - b.margin;
    if (sortMode === "marginDesc") return b.margin - a.margin;
    if (sortMode === "leader") return a.leadingCandidate.localeCompare(b.leadingCandidate);
    return (selectedOrder.get(a.constituencyId) ?? 0) - (selectedOrder.get(b.constituencyId) ?? 0);
  });
}

function latestDataUpdatedAt(values: number[]) {
  return Math.max(0, ...values.filter(Boolean));
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-IN").format(value || 0);
}

function formatDelta(value: number) {
  if (!value) return "0";
  return `${value > 0 ? "+" : ""}${formatNumber(value)}`;
}

function parseRoundProgress(value: string) {
  const match = value.match(/(\d+)\s*(?:\/|of)\s*(\d+)/i);
  if (!match) return null;
  const current = Number(match[1]);
  const total = Number(match[2]);
  if (!current || !total || current > total) return null;
  return { current, total };
}

function isDeclaredWinner(value: string) {
  return /\b(won|result\s+declared|declared)\b/i.test(value);
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

function shortPartyName(value: string) {
  const match = value.match(/\s-\s(.+)$/);
  if (match?.[1]) return match[1];
  const known: Record<string, string> = {
    "Bharatiya Janata Party": "BJP",
    "Janata Dal (United)": "JD(U)",
    "Rashtriya Janata Dal": "RJD",
    "Indian National Congress": "INC",
    "Communist Party of India": "CPI",
    "Communist Party of India (Marxist)": "CPM",
    "Communist Party of India (Marxist-Leninist) (Liberation)": "CPI(ML)(L)",
    "Lok Janshakti Party (Ram Vilas)": "LJPRV",
    "All India Majlis-E-Ittehadul Muslimeen": "AIMIM",
    "Hindustani Awam Morcha (Secular)": "HAMS",
    "None of the Above": "NOTA"
  };
  return known[value] ?? value;
}
