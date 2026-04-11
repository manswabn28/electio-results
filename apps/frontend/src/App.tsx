import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowDown, ArrowUp, Bell, ChevronLeft, ChevronRight, Download, Lock, Maximize2, Minimize2, Moon, Play, RefreshCw, Search, Settings, Star, Sun } from "lucide-react";
import type { ConstituencyOption, ConstituencyResult, PublicSourceConfig, SortMode } from "@kerala-election/shared";
import { fetchConstituencies, fetchPartySummary, fetchResult, fetchSourceConfig, fetchSummary, updateSourceConfig } from "./api";
import { downloadCsv, downloadJson } from "./export";
import { playLeaderAlert, useCountdown, useLocalStorageState, usePreviousMap } from "./hooks";

const SELECTED_STORAGE_KEY = "kerala-election:selected-constituencies";

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
  const [lastChangedAt, setLastChangedAt] = useLocalStorageState<Record<string, number>>("kerala-election:last-changed-at", {});

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

  const constituenciesQuery = useQuery({
    queryKey: ["constituencies"],
    queryFn: fetchConstituencies
  });

  const sourceConfigQuery = useQuery({
    queryKey: ["source-config"],
    queryFn: fetchSourceConfig
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

  const summaryQuery = useQuery({
    queryKey: ["summary", selectedIds],
    queryFn: () => fetchSummary(selectedIds),
    enabled: selectedIds.length > 0
  });

  const refreshMs = Math.max(5, sourceConfigQuery.data?.refreshIntervalSeconds ?? 30) * 1000;

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

  const isFetching = constituenciesQuery.isFetching || summaryQuery.isFetching || resultQueries.some((query) => query.isFetching);
  const lastSuccessAt = latestDataUpdatedAt(resultQueries.map((query) => query.dataUpdatedAt));
  const countdown = useCountdown(refreshMs, lastSuccessAt);

  const results = useMemo(
    () => resultQueries.map((query) => query.data).filter(Boolean) as ConstituencyResult[],
    [resultQueries]
  );
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
  }, [previousResults, results, setLastChangedAt]);

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
  const manualRefresh = () => {
    if (isFetching) return;
    if (resultQueries.length) {
      resultQueries.forEach((query) => void query.refetch());
    } else {
      void constituenciesQuery.refetch();
    }
  };

  return (
    <main className="min-h-screen">
      {!watchMode && <section className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
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

      <section className={`${watchMode ? "mx-auto max-w-[1800px] px-4 py-4 sm:px-6 lg:px-8" : "mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8"}`}>
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

        <div className={watchMode ? "block" : `grid gap-5 ${sidebarCollapsed ? "lg:grid-cols-[72px_1fr]" : "lg:grid-cols-[260px_1fr]"}`}>
          {!watchMode && <aside className="order-2 space-y-4 lg:order-none lg:col-start-1 lg:row-start-1">
            <ConstituencySelector
              options={constituenciesQuery.data?.constituencies ?? []}
              selectedIds={selectedIds}
              onChange={setSelectedIds}
              isLoading={constituenciesQuery.isLoading}
              collapsed={sidebarCollapsed}
              onCollapsedChange={setSidebarCollapsed}
            />
          </aside>}

          <div className={watchMode ? "grid content-start gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" : "order-1 grid content-start gap-4 md:grid-cols-2 xl:grid-cols-3 lg:col-start-2 lg:row-span-2 lg:row-start-1"}>
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
                checkedAt={resultQueries.find((query) => query.data?.constituencyId === result.constituencyId)?.dataUpdatedAt}
                isPinned={pinnedIds.includes(result.constituencyId)}
                onTogglePin={() => togglePinned(result.constituencyId)}
                changedAt={lastChangedAt[result.constituencyId]}
                leaderChanged={leaderChanges.some((item) => item.constituencyId === result.constituencyId)}
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
                <label className="mt-3 block text-sm font-semibold text-zinc-700 dark:text-zinc-200" htmlFor="party-filter">Filter</label>
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
              </div>
              <SourceConfigPanel
                sourceConfig={sourceConfigQuery.data}
                onUpdated={() => {
                  void queryClient.invalidateQueries({ queryKey: ["source-config"] });
                  void queryClient.invalidateQueries({ queryKey: ["constituencies"] });
                  void queryClient.invalidateQueries({ queryKey: ["summary"] });
                  void queryClient.invalidateQueries({ queryKey: ["result"] });
                  void queryClient.invalidateQueries({ queryKey: ["party-summary"] });
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
      <PartySummaryDock parties={partySummaryQuery.data?.parties ?? []} checkedAt={partySummaryQuery.dataUpdatedAt} />
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
  checkedAt
}: {
  parties: { party: string; won: number; leading: number; total: number; color?: string }[];
  checkedAt?: number;
}) {
  if (!parties.length) return null;
  const visibleParties = parties.slice(0, 8);
  const totalSeats = parties.reduce((sum, party) => sum + party.total, 0);

  return (
    <div key={checkedAt ?? 0} className="animate-summary-refresh fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200 bg-white/95 shadow-[0_-12px_30px_rgba(15,23,42,0.12)] backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
      <div className="mx-auto flex max-w-7xl items-center gap-3 overflow-x-auto px-4 py-2 sm:px-6 lg:px-8">
        <div className="shrink-0 pr-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Seats</div>
          <div className="text-sm font-black text-zinc-950 dark:text-white">{formatNumber(totalSeats)}</div>
        </div>
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
  leaderChanged
}: {
  result: ConstituencyResult;
  previous?: ConstituencyResult;
  checkedAt?: number;
  isPinned: boolean;
  onTogglePin: () => void;
  changedAt?: number;
  leaderChanged: boolean;
}) {
  const leader = result.candidates[0];
  const runnerUp = result.candidates[1];
  const moreCandidates = result.candidates.slice(2, 4);
  const marginChange = previous ? result.margin - previous.margin : 0;
  const leaderName = result.leadingCandidate || leader?.candidateName || "-";
  const leaderParty = shortPartyName(result.leadingParty || leader?.party || "-");
  const runnerName = result.trailingCandidate || runnerUp?.candidateName || "-";
  const runnerParty = shortPartyName(result.trailingParty || runnerUp?.party || "-");

  return (
    <article key={`${result.constituencyId}-${checkedAt ?? 0}`} className={`panel animate-card-refresh overflow-hidden rounded-md ${result.margin <= 1000 ? "ring-2 ring-rose-600" : result.margin <= 5000 ? "ring-2 ring-amber-400" : ""}`}>
      <div className="border-b border-zinc-200 p-4 dark:border-zinc-800">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-bold text-zinc-950 dark:text-white">{result.constituencyName}</h2>
            <StatusBadge status={result.statusText || result.roundStatus} />
            {result.margin <= 5000 && <span className="badge bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100">Close</span>}
            {leaderChanged && <span className="badge bg-rose-100 text-rose-900 dark:bg-rose-900 dark:text-rose-100">Changed</span>}
          </div>
          <button
            className={`shrink-0 rounded-md p-1 ${isPinned ? "text-amber-500" : "text-zinc-400 hover:text-amber-500"}`}
            onClick={onTogglePin}
            title={isPinned ? "Unpin" : "Pin"}
            aria-label={isPinned ? "Unpin constituency" : "Pin constituency"}
          >
            <Star className={`h-4 w-4 ${isPinned ? "fill-current" : ""}`} />
          </button>
        </div>
      </div>
      <div className="px-4 pb-4">
        <div className="mt-4 grid grid-cols-[72px_1fr_auto] items-center gap-3">
          <CandidatePhoto candidateName={leaderName} photoUrl={leader?.photoUrl} size="large" tone="leading" />
          <div className="min-w-0">
            <div className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
              <ArrowUp className="h-3.5 w-3.5" />
              Leading
            </div>
            <div className="mt-1 truncate text-base font-black text-zinc-950 dark:text-white" title={leaderName}>{leaderName}</div>
            <div className="truncate text-sm font-semibold text-zinc-600 dark:text-zinc-300" title={leaderParty}>{leaderParty}</div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Lead</div>
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
  tone = "neutral"
}: {
  candidateName: string;
  photoUrl?: string;
  size: "large" | "small" | "tiny" | "mini";
  tone?: "leading" | "trailing" | "neutral";
}) {
  const classes = size === "large" ? "h-16 w-16" : size === "small" ? "h-12 w-12" : size === "tiny" ? "h-9 w-9" : "h-7 w-7";
  const toneClasses =
    tone === "leading"
      ? "ring-2 ring-emerald-700 dark:ring-emerald-400"
      : tone === "trailing"
        ? "ring-2 ring-rose-700 dark:ring-rose-400"
        : "ring-1 ring-zinc-300 dark:ring-zinc-700";
  return (
    <div className={`${classes} ${toneClasses} shrink-0 overflow-hidden rounded-full border-2 border-white bg-zinc-200 shadow-sm dark:border-zinc-950 dark:bg-zinc-800`}>
      {photoUrl ? (
        <img className="h-full w-full object-cover" src={photoUrl} alt={candidateName} />
      ) : (
        <div className="flex h-full w-full items-center justify-center px-2 text-center text-xs font-black text-zinc-500">
          {initials(candidateName)}
        </div>
      )}
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

function StatusBadge({ status }: { status: string }) {
  const lower = status.toLowerCase();
  const classes = lower.includes("won") || lower.includes("declared")
    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100"
    : lower.includes("leading")
      ? "bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-100"
      : "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100";
  return <span className={`badge ${classes}`}>{status || "Counting"}</span>;
}

function EmptyState() {
  return (
    <div className="rounded-md border border-dashed border-zinc-300 p-10 text-center dark:border-zinc-700">
      <h2 className="text-xl font-bold">Choose constituencies to start tracking.</h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">Your selections stay saved in this browser.</p>
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
