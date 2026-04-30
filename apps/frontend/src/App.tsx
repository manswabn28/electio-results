import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import EmojiPicker, { Theme } from "emoji-picker-react";
import { toBlob as toImageBlob } from "html-to-image";
import { AlertTriangle, ArrowDown, ArrowUp, Bell, Check, ChevronLeft, ChevronRight, Crown, Download, Eraser, Eye, HelpCircle, History, Hourglass, Lock, Maximize2, MessageCircle, Moon, Play, RefreshCw, Search, Settings, Share2, Star, StickyNote, Sun, Users, Volume2, X } from "lucide-react";
import type { CandidateOption, ChatMessage, ConstituencyDetailResponse, ConstituencyElectionHistory, ConstituencyOption, ConstituencyResult, ConstituencySummary, DiscoveredSource, ElectionSourceProfile, ElectionTimelineEvent, PartySeatSummary, PublicSourceConfig, SortMode, SourceDiagnosticsResponse } from "@kerala-election/shared";
import { apiBaseForDiagnostics, applyDiscoveredSource, chatStreamUrl, createTelegramSubscriptionLink, deleteChatMessage, fetchCandidates, fetchChatMessages, fetchConstituencyHistory, fetchConstituencies, fetchConstituencyTimelines, fetchDiscoveryStatus, fetchPartySummary, fetchResult, fetchResults, fetchSourceConfig, fetchSourceDiagnostics, fetchSummary, fetchTelegramSubscriptionStatus, postChatMessage, revertSourceConfig, runSourceDiscovery, sendTrafficHeartbeat, shareImageProxyUrl, updateActiveSourceProfile, updateDiscoverySchedule, updateSourceConfig } from "./api";
import { downloadCsv, downloadJson } from "./export";
import { playChatMessageAlert, playLeaderAlert, primeAudioAlerts, useCountdown, useLocalStorageState, usePreviousMap } from "./hooks";
import { initAnalytics, trackEvent, trackPageView } from "./analytics";
import { applySeo } from "./seo";
import { ElectionBattleShareCard } from "./ElectionBattleShareCard";
import { buildElectionBattleShareCardPropsFromResult } from "./shareCardExport";
import { FinalVictoryShareCard, PartySummaryShareCard } from "./SharePremiumCards";
import { ConstituencyDetailPage } from "./ConstituencyDetailPage";
import { Footer } from "./Footer";
import { AboutUsPage } from "./AboutUsPage";
import { ContactUsPage } from "./ContactUsPage";
import { TermsAndConditionsPage } from "./TermsAndConditionsPage";

const SELECTED_STORAGE_KEY = "kerala-election:selected-constituencies";
const CACHED_RESULTS_KEY = "kerala-election:last-known-results";
const VIEWER_ID_STORAGE_KEY = "kerala-election:viewer-id";
const TIGHT_MARGIN_LIMIT = 5000;
const HIGH_TIGHT_MARGIN_LIMIT = 1000;
const TIGHT_RACE_NOTIFY_MIN_PROGRESS = 25;
const ADMIN_PASSWORD = "ldfudf#2026";
const KERALA_COUNTING_START_AT = "2026-05-04T06:00:00+05:30";
const VICTORY_OVERLAY_AUTO_CLOSE_MS = 18000;

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

type TightRaceNotification = {
  id: string;
  constituencyId: string;
  constituencyName: string;
  leadingCandidate: string;
  leadingCandidatePhotoUrl?: string;
  margin: number;
  declared: boolean;
  demo?: boolean;
};

type AlertRules = {
  leaderChange: boolean;
  winnerDeclared: boolean;
  highTightRace: boolean;
  candidateWatch: boolean;
};

type WatchProfile = {
  name: string;
  selectedIds: string[];
  watchedCandidateIds: string[];
  pinnedIds: string[];
  partyFilter: string;
  sortMode: SortMode;
};

type ChangeInsight = {
  kind: "leader" | "margin" | "winner";
  label: string;
  count: number;
  detail: string;
};

type AppView = "dashboard" | "help";
type AppRoute =
  | { kind: "dashboard" }
  | { kind: "help" }
  | { kind: "constituency"; stateSlug: string; constituencySlug: string }
  | { kind: "about" }
  | { kind: "contact" }
  | { kind: "terms" };
type ShareCardFormat = "square" | "story" | "landscape";
type ShareCardPayload =
  | {
      kind: "constituency";
      result: ConstituencyResult;
      checkedAt?: number;
      electionTitle: string;
      leftPartyColor?: string;
      rightPartyColor?: string;
    }
  | { kind: "party-summary"; parties: PartySeatSummary[]; electionTitle: string }
  | { kind: "battleground"; races: ConstituencySummary[]; electionTitle: string }
  | {
      kind: "victory";
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
    };

export function App() {
  const queryClient = useQueryClient();
  const [appRoute, setAppRoute] = useState<AppRoute>(() => parseAppRouteFromLocation());
  const appView: AppView = appRoute.kind === "help" ? "help" : "dashboard";
  const [selectedIds, setSelectedIds] = useLocalStorageState<string[]>(SELECTED_STORAGE_KEY, []);
  const [hasBootstrappedFavorites, setHasBootstrappedFavorites] = useState(() =>
    localStorage.getItem(SELECTED_STORAGE_KEY) !== null
  );
  const [sortMode, setSortMode] = useLocalStorageState<SortMode>("kerala-election:sort-mode", "selected");
  const [darkMode, setDarkMode] = useLocalStorageState<boolean>("kerala-election:dark-mode", true);
  const [soundEnabled, setSoundEnabled] = useLocalStorageState<boolean>("kerala-election:sound", false);
  const [sidebarCollapsed, setSidebarCollapsed] = useLocalStorageState<boolean>("kerala-election:sidebar-collapsed", false);
  const [watchMode, setWatchMode] = useLocalStorageState<boolean>("kerala-election:watch-mode", false);
  const [autoScroll, setAutoScroll] = useLocalStorageState<boolean>("kerala-election:auto-scroll", false);
  const [pinnedIds, setPinnedIds] = useLocalStorageState<string[]>("kerala-election:pinned-constituencies", []);
  const [partyFilter, setPartyFilter] = useLocalStorageState<string>("kerala-election:party-filter", "all");
  const [watchedCandidateIds, setWatchedCandidateIds] = useLocalStorageState<string[]>("kerala-election:watched-candidates", []);
  const [lastChangedAt, setLastChangedAt] = useLocalStorageState<Record<string, number>>("kerala-election:last-changed-at", {});
  const [cachedResults, setCachedResults] = useLocalStorageState<Record<string, ConstituencyResult>>(CACHED_RESULTS_KEY, {});
  const [cachedConstituencies, setCachedConstituencies] = useLocalStorageState<ConstituencyOption[]>("kerala-election:cached-constituencies", []);
  const [cachedCandidates, setCachedCandidates] = useLocalStorageState<CandidateOption[]>("kerala-election:cached-candidates", []);
  const [selectedIdsByProfile, setSelectedIdsByProfile] = useLocalStorageState<Record<string, string[]>>("kerala-election:selected-by-profile", {});
  const [watchedCandidateIdsByProfile, setWatchedCandidateIdsByProfile] = useLocalStorageState<Record<string, string[]>>("kerala-election:watched-candidates-by-profile", {});
  const [pinnedIdsByProfile, setPinnedIdsByProfile] = useLocalStorageState<Record<string, string[]>>("kerala-election:pinned-by-profile", {});
  const [cachedResultsByProfile, setCachedResultsByProfile] = useLocalStorageState<Record<string, Record<string, ConstituencyResult>>>("kerala-election:cached-results-by-profile", {});
  const [cachedConstituenciesByProfile, setCachedConstituenciesByProfile] = useLocalStorageState<Record<string, ConstituencyOption[]>>("kerala-election:cached-constituencies-by-profile", {});
  const [cachedCandidatesByProfile, setCachedCandidatesByProfile] = useLocalStorageState<Record<string, CandidateOption[]>>("kerala-election:cached-candidates-by-profile", {});
  const [cachedPartySummaryByProfile, setCachedPartySummaryByProfile] = useLocalStorageState<Record<string, PartySeatSummary[]>>("kerala-election:cached-party-summary-by-profile", {});
  const [lastCheckedById, setLastCheckedById] = useLocalStorageState<Record<string, number>>("kerala-election:last-checked-by-id", {});
  const [leaderHistory, setLeaderHistory] = useLocalStorageState<Record<string, LeaderHistoryEntry[]>>("kerala-election:leader-history", {});
  const [constituencyNotes, setConstituencyNotes] = useLocalStorageState<Record<string, string>>("kerala-election:constituency-notes", {});
  const [alertThreshold, setAlertThreshold] = useLocalStorageState<number>("kerala-election:alert-threshold", 1000);
  const [alertRules, setAlertRules] = useLocalStorageState<AlertRules>("kerala-election:alert-rules", {
    leaderChange: true,
    winnerDeclared: true,
    highTightRace: true,
    candidateWatch: true
  });
  const [watchProfiles, setWatchProfiles] = useLocalStorageState<WatchProfile[]>("kerala-election:watch-profiles", []);
  const [profileName, setProfileName] = useLocalStorageState<string>("kerala-election:profile-name", "My watchlist");
  const [seenCandidateWatchIds, setSeenCandidateWatchIds] = useLocalStorageState<string[]>("kerala-election:seen-candidate-watch-alerts", []);
  const [seenWinnerIds, setSeenWinnerIds] = useLocalStorageState<string[]>("kerala-election:seen-winner-notifications", []);
  const [seenLostIds, setSeenLostIds] = useLocalStorageState<string[]>("kerala-election:seen-lost-notifications", []);
  const [viewerId] = useLocalStorageState<string>(VIEWER_ID_STORAGE_KEY, () => crypto.randomUUID());
  const [chatDisplayName, setChatDisplayName] = useLocalStorageState<string>("kerala-election:chat-display-name", "");
  const [chatOpen, setChatOpen] = useLocalStorageState<boolean>("kerala-election:chat-open", false);
  const [lastSeenChatAtByProfile, setLastSeenChatAtByProfile] = useLocalStorageState<Record<string, string>>("kerala-election:last-seen-chat-at-by-profile", {});
  const [liveAudioStarted, setLiveAudioStarted] = useLocalStorageState<boolean>("kerala-election:live-audio-started", false);
  const [liveAudioExpanded, setLiveAudioExpanded] = useLocalStorageState<boolean>("kerala-election:live-audio-expanded", false);
  const [selectedLiveChannelId, setSelectedLiveChannelId] = useLocalStorageState<string>("kerala-election:live-audio-channel", "reporter-tv");
  const [activeProfileId, setActiveProfileId] = useLocalStorageState<string>("kerala-election:active-source-profile", "");
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
  const lowBandwidthMode = typeof navigator !== "undefined" && "connection" in navigator && Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData);
  const [toast, setToast] = useState("");
  const [winnerToasts, setWinnerToasts] = useState<WinnerNotification[]>([]);
  const [lostToasts, setLostToasts] = useState<LostNotification[]>([]);
  const [tightRaceToasts, setTightRaceToasts] = useState<TightRaceNotification[]>([]);
  const [activePartyModal, setActivePartyModal] = useState<string | null>(null);
  const [battlegroundOpen, setBattlegroundOpen] = useState(false);
  const [dismissedBattlegroundSignal, setDismissedBattlegroundSignal] = useLocalStorageState<string>("kerala-election:dismissed-battleground-signal", "");
  const [assemblyVictoryOpen, setAssemblyVictoryOpen] = useState(false);
  const [shareCardPayload, setShareCardPayload] = useState<ShareCardPayload | null>(null);
  const [seenTightRaceIds, setSeenTightRaceIds] = useLocalStorageState<string[]>("kerala-election:seen-tight-race-notifications", []);
  const pendingTightRaceToastIds = useRef<Set<string>>(new Set());
  const hydratedProfileRef = useRef("");
  const seenChatMessageIdsRef = useRef<Set<string>>(new Set());
  const shownAssemblyVictoryRef = useRef("");
  const previousAssemblyVictorySignatureRef = useRef("");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  useEffect(() => {
    const marks = new Set<number>();
    const onScroll = () => {
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      if (scrollable <= 0) return;
      const depth = Math.min(100, Math.round((window.scrollY / scrollable) * 100));
      for (const mark of [25, 50, 75, 100]) {
        if (depth >= mark && !marks.has(mark)) {
          marks.add(mark);
          trackEvent("scroll_depth", { percent: mark });
        }
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    initAnalytics();
    if (appRoute.kind === "constituency") return;
    const selectedCount = selectedIds.length;
    applySeo({
      title: appView === "help"
        ? "Election Tracker Help | User Manual & FAQ"
        : selectedCount
          ? `${selectedCount} Constituencies Tracked | Kerala Election Live`
          : "Kerala Assembly Election 2026 Live Tracker",
      description: appView === "help"
        ? "Complete user manual for the election tracker, including features, alerts, watch mode, admin controls, limitations, and FAQ."
        : selectedCount
          ? `Live ECI-backed Kerala Assembly Election results for ${selectedCount} selected constituencies, including candidate leads, margins, party totals, and updates.`
          : undefined
    });
    trackPageView(document.title);
  }, [appRoute.kind, appView, selectedIds.length]);

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
    const candidates = params.get("candidates");
    if (candidates) setWatchedCandidateIds(candidates.split(",").map((item) => item.trim()).filter(Boolean));
    const pinned = params.get("pinned");
    if (pinned) setPinnedIds(pinned.split(",").map((item) => item.trim()).filter(Boolean));
    const threshold = Number(params.get("alert"));
    if (Number.isFinite(threshold) && threshold > 0) setAlertThreshold(threshold);
  }, [setAlertThreshold, setPartyFilter, setPinnedIds, setSelectedIds, setSortMode, setWatchedCandidateIds]);

  useEffect(() => {
    const handlePopState = () => {
      setAppRoute(parseAppRouteFromLocation());
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const sourceConfigQuery = useQuery({
    queryKey: ["source-config"],
    queryFn: fetchSourceConfig
  });
  const sourceProfiles = useMemo(() => (sourceConfigQuery.data?.profiles ?? []).filter((profile) => profile.enabled), [sourceConfigQuery.data?.profiles]);
  const preferredProfile = useMemo(() => {
    return sourceProfiles.find((profile) => profile.profileId === activeProfileId)
      ?? sourceProfiles.find((profile) => /kerala/i.test(profile.stateName))
      ?? sourceProfiles.find((profile) => profile.profileId === sourceConfigQuery.data?.activeProfileId)
      ?? sourceProfiles[0];
  }, [activeProfileId, sourceConfigQuery.data?.activeProfileId, sourceProfiles]);
  const effectiveProfileId = preferredProfile?.profileId ?? "";

  useEffect(() => {
    if (!effectiveProfileId || activeProfileId === effectiveProfileId) return;
    setActiveProfileId(effectiveProfileId);
  }, [activeProfileId, effectiveProfileId, setActiveProfileId]);

  const activeProfile = useMemo(() => {
    return sourceProfiles.find((profile) => profile.profileId === effectiveProfileId);
  }, [effectiveProfileId, sourceProfiles]);
  const routedProfile = useMemo(() => {
    if (appRoute.kind !== "constituency") return undefined;
    return sourceProfiles.find((profile) => slugify(profile.stateName) === appRoute.stateSlug);
  }, [appRoute, sourceProfiles]);
  const detailProfileId = routedProfile?.profileId ?? effectiveProfileId;

  useEffect(() => {
    if (appRoute.kind !== "constituency" || !routedProfile?.profileId) return;
    if (activeProfileId === routedProfile.profileId) return;
    setActiveProfileId(routedProfile.profileId);
  }, [activeProfileId, appRoute.kind, routedProfile?.profileId, setActiveProfileId]);

  useEffect(() => {
    if (!effectiveProfileId || hydratedProfileRef.current === effectiveProfileId) return;
    hydratedProfileRef.current = effectiveProfileId;
    setSelectedIds(selectedIdsByProfile[effectiveProfileId] ?? []);
    setWatchedCandidateIds(watchedCandidateIdsByProfile[effectiveProfileId] ?? []);
    setPinnedIds(pinnedIdsByProfile[effectiveProfileId] ?? []);
    setCachedResults(cachedResultsByProfile[effectiveProfileId] ?? {});
    setCachedConstituencies(cachedConstituenciesByProfile[effectiveProfileId] ?? []);
    setCachedCandidates(cachedCandidatesByProfile[effectiveProfileId] ?? []);
  }, [cachedCandidatesByProfile, cachedConstituenciesByProfile, cachedResultsByProfile, effectiveProfileId, pinnedIdsByProfile, selectedIdsByProfile, setCachedCandidates, setCachedConstituencies, setCachedResults, setPinnedIds, setSelectedIds, setWatchedCandidateIds, watchedCandidateIdsByProfile]);

  useEffect(() => {
    if (!effectiveProfileId || hydratedProfileRef.current !== effectiveProfileId) return;
    setSelectedIdsByProfile((current) => areStringArraysEqual(current[effectiveProfileId] ?? [], selectedIds) ? current : { ...current, [effectiveProfileId]: selectedIds });
  }, [effectiveProfileId, selectedIds, setSelectedIdsByProfile]);

  useEffect(() => {
    if (!effectiveProfileId || hydratedProfileRef.current !== effectiveProfileId) return;
    setWatchedCandidateIdsByProfile((current) => areStringArraysEqual(current[effectiveProfileId] ?? [], watchedCandidateIds) ? current : { ...current, [effectiveProfileId]: watchedCandidateIds });
  }, [effectiveProfileId, setWatchedCandidateIdsByProfile, watchedCandidateIds]);

  useEffect(() => {
    if (!effectiveProfileId || hydratedProfileRef.current !== effectiveProfileId) return;
    setPinnedIdsByProfile((current) => areStringArraysEqual(current[effectiveProfileId] ?? [], pinnedIds) ? current : { ...current, [effectiveProfileId]: pinnedIds });
  }, [effectiveProfileId, pinnedIds, setPinnedIdsByProfile]);

  useEffect(() => {
    if (!effectiveProfileId || hydratedProfileRef.current !== effectiveProfileId) return;
    setCachedResultsByProfile((current) => current[effectiveProfileId] === cachedResults ? current : { ...current, [effectiveProfileId]: cachedResults });
  }, [cachedResults, effectiveProfileId, setCachedResultsByProfile]);

  useEffect(() => {
    if (!effectiveProfileId || hydratedProfileRef.current !== effectiveProfileId) return;
    setCachedConstituenciesByProfile((current) => current[effectiveProfileId] === cachedConstituencies ? current : { ...current, [effectiveProfileId]: cachedConstituencies });
  }, [cachedConstituencies, effectiveProfileId, setCachedConstituenciesByProfile]);

  useEffect(() => {
    if (!effectiveProfileId || hydratedProfileRef.current !== effectiveProfileId) return;
    setCachedCandidatesByProfile((current) => current[effectiveProfileId] === cachedCandidates ? current : { ...current, [effectiveProfileId]: cachedCandidates });
  }, [cachedCandidates, effectiveProfileId, setCachedCandidatesByProfile]);

  const constituenciesQuery = useQuery({
    queryKey: ["constituencies", effectiveProfileId],
    queryFn: () => fetchConstituencies(effectiveProfileId),
    enabled: Boolean(effectiveProfileId)
  });

  const candidatesQuery = useQuery({
    queryKey: ["candidates", effectiveProfileId],
    queryFn: () => fetchCandidates(effectiveProfileId),
    enabled: Boolean(effectiveProfileId),
    staleTime: Infinity
  });

  useEffect(() => {
    const constituencies = constituenciesQuery.data?.constituencies;
    if (constituencies?.length) setCachedConstituencies(constituencies);
  }, [constituenciesQuery.data?.constituencies, setCachedConstituencies]);

  useEffect(() => {
    const candidates = candidatesQuery.data?.candidates;
    if (candidates?.length) setCachedCandidates(candidates);
  }, [candidatesQuery.data?.candidates, setCachedCandidates]);

  const constituencyOptions = constituenciesQuery.data?.constituencies?.length
    ? constituenciesQuery.data.constituencies
    : cachedConstituencies;
  const candidateOptions = candidatesQuery.data?.candidates?.length
    ? candidatesQuery.data.candidates
    : cachedCandidates;

  const trafficQuery = useQuery({
    queryKey: ["traffic", viewerId],
    queryFn: () => sendTrafficHeartbeat(viewerId),
    refetchInterval: 20_000
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
    const options = constituencyOptions;
    const byId = new Map(options.map((option) => [option.constituencyId, option]));
    return selectedIds.map((id) => byId.get(id)).filter(Boolean) as ConstituencyOption[];
  }, [constituencyOptions, selectedIds]);

  const watchedCandidates = useMemo(() => {
    const byId = new Map(candidateOptions.map((candidate) => [candidate.candidateId, candidate]));
    return watchedCandidateIds.map((id) => byId.get(id)).filter(Boolean) as CandidateOption[];
  }, [candidateOptions, watchedCandidateIds]);
  useEffect(() => {
    if (!watchedCandidates.length) return;
    const ids = watchedCandidates.map((candidate) => candidate.constituencyId);
    setSelectedIds((current) => {
      const next = [...new Set([...current, ...ids])];
      return next.length === current.length ? current : next;
    });
  }, [setSelectedIds, watchedCandidates]);
  const candidatePhotoLookup = useMemo(() => {
    const lookup = new Map<string, string>();
    for (const candidate of candidateOptions) {
      if (!candidate.photoUrl) continue;
      lookup.set(`${candidate.constituencyId}:${normalizeCandidateName(candidate.candidateName)}`, candidate.photoUrl);
    }
    return lookup;
  }, [candidateOptions]);
  const constituencyHistoryQuery = useQuery({
    queryKey: ["constituency-history", effectiveProfileId, selectedIds],
    queryFn: () => fetchConstituencyHistory(selectedIds, effectiveProfileId),
    enabled: selectedIds.length > 0,
    staleTime: 30 * 60_000
  });
  const summaryQuery = useQuery({
    queryKey: ["summary", effectiveProfileId, selectedIds],
    queryFn: () => fetchSummary(selectedIds, effectiveProfileId),
    enabled: selectedIds.length > 0
  });

  const refreshMs = Math.max(5, sourceConfigQuery.data?.refreshIntervalSeconds ?? 30) * 1000;

  const constituencyTimelineQuery = useQuery({
    queryKey: ["constituency-timelines", effectiveProfileId, selectedIds],
    queryFn: () => fetchConstituencyTimelines(selectedIds, effectiveProfileId),
    enabled: selectedIds.length > 0,
    refetchInterval: refreshMs
  });

  const allSummaryQuery = useQuery({
    queryKey: ["summary", "all-winner-watch", effectiveProfileId, constituencyOptions.map((item) => item.constituencyId).join(",")],
    queryFn: () => fetchSummary(constituencyOptions.map((item) => item.constituencyId), effectiveProfileId),
    enabled: Boolean(constituencyOptions.length),
    refetchInterval: refreshMs
  });

  const partySummaryQuery = useQuery({
    queryKey: ["party-summary", effectiveProfileId],
    queryFn: () => fetchPartySummary(effectiveProfileId),
    placeholderData: cachedPartySummaryByProfile[effectiveProfileId]
      ? {
          generatedAt: new Date(0).toISOString(),
          sourceUrl: "",
          parties: cachedPartySummaryByProfile[effectiveProfileId]
        }
      : undefined,
    refetchInterval: refreshMs
  });
  const chatMessagesQuery = useQuery({
    queryKey: ["chat-messages", effectiveProfileId],
    queryFn: () => fetchChatMessages(120, effectiveProfileId),
    staleTime: Infinity
  });
  const telegramStatusQuery = useQuery({
    queryKey: ["telegram-status", viewerId, effectiveProfileId],
    queryFn: () => fetchTelegramSubscriptionStatus(viewerId, effectiveProfileId),
    enabled: Boolean(viewerId && effectiveProfileId),
    refetchInterval: 30_000
  });
  const telegramLinkMutation = useMutation({
    mutationFn: () => createTelegramSubscriptionLink({
      viewerId,
      profileId: effectiveProfileId,
      selectedIds,
      watchedCandidateIds
    }),
    onSuccess: (data) => {
      if (data.botUrl) {
        window.open(data.botUrl, "_blank", "noopener,noreferrer");
        setToast(data.linked ? "Telegram alerts already linked." : "Open Telegram and tap Start to activate alerts.");
        window.setTimeout(() => setToast(""), 4000);
      } else {
        setToast("Telegram alerts are not configured yet.");
        window.setTimeout(() => setToast(""), 4000);
      }
      void queryClient.invalidateQueries({ queryKey: ["telegram-status", viewerId, effectiveProfileId] });
    }
  });
  const chatPostMutation = useMutation({
    mutationFn: (payload: { profileId?: string; viewerId: string; displayName?: string; message: string; adminPassword?: string }) => postChatMessage(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["chat-messages", effectiveProfileId] });
    }
  });
  const chatDeleteMutation = useMutation({
    mutationFn: ({ password, messageId, profileId }: { password: string; messageId: string; profileId?: string }) => deleteChatMessage(password, messageId, profileId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["chat-messages", effectiveProfileId] });
    }
  });
  const [liveChatMessages, setLiveChatMessages] = useState<ChatMessage[]>([]);

  const detailResultsQuery = useQuery({
    queryKey: ["results", "details", effectiveProfileId, selectedIds],
    queryFn: () => fetchResults(selectedIds, effectiveProfileId),
    enabled: selectedIds.length > 0,
    refetchInterval: refreshMs,
    retry: 3,
    retryDelay: (attempt: number) => Math.min(12000, 1500 * 2 ** attempt)
  });

  const detailResultsById = useMemo(() => new Map((detailResultsQuery.data?.results ?? []).map((result) => [result.constituencyId, result])), [detailResultsQuery.data?.results]);
  const detailErrorsById = useMemo(() => new Map((detailResultsQuery.data?.errors ?? []).map((error) => [error.constituencyId ?? "", error])), [detailResultsQuery.data?.errors]);
  const resultQueries = useMemo(() => selectedIds.map((id) => {
    const apiError = detailErrorsById.get(id);
    return {
      data: detailResultsById.get(id),
      dataUpdatedAt: detailResultsQuery.dataUpdatedAt,
      error: apiError ? new Error(apiError.message) : detailResultsQuery.error,
      isError: Boolean(apiError) || detailResultsQuery.isError,
      isFetching: detailResultsQuery.isFetching,
      isLoading: detailResultsQuery.isLoading,
      refetch: detailResultsQuery.refetch
    };
  }), [detailErrorsById, detailResultsById, detailResultsQuery.dataUpdatedAt, detailResultsQuery.error, detailResultsQuery.isError, detailResultsQuery.isFetching, detailResultsQuery.isLoading, detailResultsQuery.refetch, selectedIds]);

  const isFetching = constituenciesQuery.isFetching || summaryQuery.isFetching || allSummaryQuery.isFetching || detailResultsQuery.isFetching;
  const lastSuccessAt = detailResultsQuery.dataUpdatedAt || latestDataUpdatedAt(resultQueries.map((query) => query.dataUpdatedAt));
  const countdown = useCountdown(refreshMs, lastSuccessAt);

  const liveResults = useMemo(
    () => resultQueries.map((query) => query.data).filter(Boolean) as ConstituencyResult[],
    [resultQueries]
  );
  const checkedAtById = useMemo(() => {
    const entries = selectedIds.map((id, index) => [id, resultQueries[index]?.dataUpdatedAt || 0] as const);
    return Object.fromEntries(entries);
  }, [resultQueries, selectedIds]);
  const resultFreshnessById = useMemo<Record<string, "Fresh" | "Cached" | "Stale">>(() => {
    const liveIds = new Set(liveResults.map((result) => result.constituencyId));
    const now = Date.now();
    return Object.fromEntries(selectedIds.map((id) => {
      const checkedAt = checkedAtById[id] || lastCheckedById[id] || 0;
      if (!liveIds.has(id)) return [id, "Cached"] as const;
      if (checkedAt && now - checkedAt > refreshMs * 2.5) return [id, "Stale"] as const;
      return [id, "Fresh"] as const;
    }));
  }, [checkedAtById, lastCheckedById, liveResults, refreshMs, selectedIds]);
  const lastSeenChatAt = lastSeenChatAtByProfile[effectiveProfileId] ?? "";
  const constituencyHistoryById = useMemo(() => new Map((constituencyHistoryQuery.data ?? []).map((history) => [history.constituencyId, history])), [constituencyHistoryQuery.data]);
  const constituencyTimelineById = useMemo(() => constituencyTimelineQuery.data ?? {}, [constituencyTimelineQuery.data]);
  const replayHistoryById = useMemo(() => {
    return Object.fromEntries(
      Object.entries(constituencyTimelineById).map(([constituencyId, timeline]) => [
        constituencyId,
        convertTimelineEventsToLeaderHistory(timeline)
      ])
    ) as Record<string, LeaderHistoryEntry[]>;
  }, [constituencyTimelineById]);
  const latestChatAt = useMemo(
    () => liveChatMessages.reduce((latest, message) => message.createdAt > latest ? message.createdAt : latest, ""),
    [liveChatMessages]
  );
  const unreadChatCount = useMemo(
    () => liveChatMessages.filter((message) => !message.deleted && message.createdAt > lastSeenChatAt).length,
    [lastSeenChatAt, liveChatMessages]
  );
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
    if (soundEnabled && alertRules.leaderChange && leaderChanges.length) playLeaderAlert();
  }, [alertRules.leaderChange, leaderChanges.length, soundEnabled]);

  useEffect(() => {
    const initialMessages = chatMessagesQuery.data?.messages;
    if (!initialMessages) return;
    if (seenChatMessageIdsRef.current.size === 0) {
      seenChatMessageIdsRef.current = new Set(initialMessages.map((message) => message.id));
    }
    setLiveChatMessages((current) => {
      if (!current.length) return initialMessages;
      const merged = new Map(current.map((message) => [message.id, message]));
      for (const message of initialMessages) merged.set(message.id, message);
      return [...merged.values()]
        .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
        .slice(-120);
    });
  }, [chatMessagesQuery.data?.messages]);

  useEffect(() => {
    if (!chatOpen || !latestChatAt) return;
    setLastSeenChatAtByProfile((current) => current[effectiveProfileId] === latestChatAt ? current : { ...current, [effectiveProfileId]: latestChatAt });
  }, [chatOpen, effectiveProfileId, latestChatAt, setLastSeenChatAtByProfile]);

  useEffect(() => {
    seenChatMessageIdsRef.current = new Set();
    setLiveChatMessages([]);
    const stream = new EventSource(chatStreamUrl(effectiveProfileId));
    stream.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as { type?: string; message?: ChatMessage };
        if (payload.type !== "message" || !payload.message) return;
        const nextMessage = payload.message;
        const isNewIncomingMessage = !seenChatMessageIdsRef.current.has(nextMessage.id) && !nextMessage.deleted;
        seenChatMessageIdsRef.current.add(nextMessage.id);
        setLiveChatMessages((current) => {
          const merged = new Map(current.map((message) => [message.id, message]));
          merged.set(nextMessage.id, nextMessage);
          return [...merged.values()]
            .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
            .slice(-120);
        });
        if (isNewIncomingMessage && nextMessage.viewerId !== viewerId && soundEnabled) playChatMessageAlert();
      } catch {
        // Ignore malformed stream payloads and wait for the next event.
      }
    };
    stream.onerror = () => {
      if (stream.readyState === EventSource.CLOSED) stream.close();
    };
    return () => stream.close();
  }, [effectiveProfileId, soundEnabled, viewerId]);

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
    const parties = partySummaryQuery.data?.parties;
    if (!parties?.length) return;
    setCachedPartySummaryByProfile((current) => {
      const existing = current[effectiveProfileId] ?? [];
      if (JSON.stringify(existing) === JSON.stringify(parties)) return current;
      return { ...current, [effectiveProfileId]: parties };
    });
  }, [effectiveProfileId, partySummaryQuery.data?.parties, setCachedPartySummaryByProfile]);

  useEffect(() => {
    if (!alertRules.winnerDeclared) return;
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
        void fetchResult(nextWinner.constituencyId, effectiveProfileId)
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
  }, [alertRules.winnerDeclared, allSummaryQuery.data?.results, effectiveProfileId, seenWinnerIds, setSeenWinnerIds, soundEnabled]);

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

  useEffect(() => {
    if (!alertRules.candidateWatch || !watchedCandidates.length || !liveResults.length) return;
    const watchedBySeat = new Map<string, CandidateOption[]>();
    for (const candidate of watchedCandidates) {
      watchedBySeat.set(candidate.constituencyId, [...(watchedBySeat.get(candidate.constituencyId) ?? []), candidate]);
    }
    const events: string[] = [];
    for (const result of liveResults) {
      const watched = watchedBySeat.get(result.constituencyId) ?? [];
      if (!watched.length) continue;
      const leader = result.candidates[0]?.candidateName ?? "";
      const runner = result.candidates[1]?.candidateName ?? "";
      const declared = isDeclaredWinner(result.statusText || result.roundStatus);
      for (const candidate of watched) {
        const name = normalizeCandidateName(candidate.candidateName);
        const position = normalizeCandidateName(leader) === name ? "leader" : normalizeCandidateName(runner) === name ? "second" : "";
        if (!position && !declared) continue;
        const eventId = `${result.constituencyId}:${candidate.candidateId}:${declared ? "declared" : position}:${result.margin}`;
        if (seenCandidateWatchIds.includes(eventId)) continue;
        events.push(eventId);
        const message = declared && position === "leader"
          ? `${candidate.candidateName} won ${result.constituencyName} by ${formatNumber(result.margin)}.`
          : declared
            ? `${candidate.candidateName} finished ${position || "outside top two"} in ${result.constituencyName}.`
            : `${candidate.candidateName} is ${position} in ${result.constituencyName}.`;
        setToast(message);
        window.setTimeout(() => setToast(""), 5000);
        if (soundEnabled && (position === "leader" || declared)) playLeaderAlert();
        break;
      }
    }
    if (events.length) setSeenCandidateWatchIds((current) => [...new Set([...current, ...events])]);
  }, [alertRules.candidateWatch, liveResults, seenCandidateWatchIds, setSeenCandidateWatchIds, soundEnabled, watchedCandidates]);

  const partyOptions = useMemo(() => {
    return [...new Set(results.map((result) => result.leadingParty || result.candidates[0]?.party).filter(Boolean))].sort();
  }, [results]);
  const tightRaceSuggestions = useMemo(() => {
    const selected = new Set(selectedIds);
    const all = allSummaryQuery.data?.results ?? [];
    const active = all
      .filter((summary) => !selected.has(summary.constituencyId))
      .filter((summary) => !isDeclaredWinner(summary.statusText || summary.roundStatus))
      .filter((summary) => summary.margin > 0 && summary.margin <= TIGHT_MARGIN_LIMIT)
      .sort((a, b) => a.margin - b.margin)
      .slice(0, 6);
    if (active.length) return active;
    return all
      .filter((summary) => !selected.has(summary.constituencyId))
      .filter((summary) => isDeclaredWinner(summary.statusText || summary.roundStatus))
      .filter((summary) => summary.margin > 0 && summary.margin <= TIGHT_MARGIN_LIMIT)
      .sort((a, b) => a.margin - b.margin)
      .slice(0, 6);
  }, [allSummaryQuery.data?.results, selectedIds]);
  const battlegroundRaces = useMemo(() => {
    const changed = new Set(leaderChanges.map((item) => item.constituencyId));
    const all = allSummaryQuery.data?.results ?? [];
    const activeClosest = all
      .filter((summary) => !isDeclaredWinner(summary.statusText || summary.roundStatus))
      .filter((summary) => summary.margin > 0 && summary.margin <= TIGHT_MARGIN_LIMIT);
    const declaredClosest = all
      .filter((summary) => isDeclaredWinner(summary.statusText || summary.roundStatus))
      .filter((summary) => summary.margin > 0 && summary.margin <= TIGHT_MARGIN_LIMIT);
    const pool = activeClosest.length ? activeClosest : declaredClosest;

    return pool
      .sort((left, right) => {
        const leftDeclared = isDeclaredWinner(left.statusText || left.roundStatus);
        const rightDeclared = isDeclaredWinner(right.statusText || right.roundStatus);
        const activeDelta = Number(leftDeclared) - Number(rightDeclared);
        if (activeDelta) return activeDelta;
        const leaderChangeDelta = Number(changed.has(right.constituencyId)) - Number(changed.has(left.constituencyId));
        if (leaderChangeDelta) return leaderChangeDelta;
        return left.margin - right.margin;
      })
      .slice(0, 20);
  }, [allSummaryQuery.data?.results, leaderChanges]);
  const battlegroundPreview = useMemo(() => battlegroundRaces.slice(0, 3), [battlegroundRaces]);
  const battlegroundSignal = useMemo(
    () => battlegroundPreview.map((item) => `${item.constituencyId}:${Math.min(item.margin, 1000)}:${isDeclaredWinner(item.statusText || item.roundStatus) ? "d" : "l"}`).join("|"),
    [battlegroundPreview]
  );
  useEffect(() => {
    const hasFreshHighSignal = battlegroundPreview.some((summary) => summary.margin <= HIGH_TIGHT_MARGIN_LIMIT || leaderChanges.some((item) => item.constituencyId === summary.constituencyId));
    if (battlegroundSignal && battlegroundSignal !== dismissedBattlegroundSignal && hasFreshHighSignal) {
      setDismissedBattlegroundSignal("");
    }
  }, [battlegroundPreview, battlegroundSignal, dismissedBattlegroundSignal, leaderChanges, setDismissedBattlegroundSignal]);
  const tightRaceNotificationCandidates = useMemo(() => {
    const realCandidates = tightRaceSuggestions
      .filter((summary) => isNotificationWorthyTightRace(summary))
      .map((summary) => ({ summary, demo: false }));
    if (realCandidates.length) return realCandidates;
    if (!import.meta.env.DEV) return [];

    const selected = new Set(selectedIds);
    return (allSummaryQuery.data?.results ?? [])
      .filter((summary) => !selected.has(summary.constituencyId))
      .filter((summary) => isDeclaredWinner(summary.statusText || summary.roundStatus))
      .filter((summary) => summary.margin > 0)
      .sort((a, b) => a.margin - b.margin)
      .slice(0, 2)
      .map((summary) => ({ summary, demo: true }));
  }, [allSummaryQuery.data?.results, selectedIds, tightRaceSuggestions]);
  useEffect(() => {
    const selected = new Set(selectedIds);
    const candidates = tightRaceNotificationCandidates
      .filter(({ summary }) => !selected.has(summary.constituencyId))
      .filter(({ summary, demo }) => {
        const id = tightRaceNotificationKey(summary, demo);
        return !seenTightRaceIds.includes(id) && !pendingTightRaceToastIds.current.has(id);
      })
      .slice(0, 2);
    if (!candidates.length) return;

    const timers = candidates.map(({ summary, demo }, index) => {
      const id = tightRaceNotificationKey(summary, demo);
      pendingTightRaceToastIds.current.add(id);
      return window.setTimeout(() => {
        addTightRaceToast({
          id,
          constituencyId: summary.constituencyId,
          constituencyName: summary.constituencyName,
          leadingCandidate: summary.leadingCandidate || "Leader",
          leadingCandidatePhotoUrl: candidatePhotoLookup.get(`${summary.constituencyId}:${normalizeCandidateName(summary.leadingCandidate)}`),
          margin: summary.margin,
          declared: isDeclaredWinner(summary.statusText || summary.roundStatus),
          demo
        });
        setSeenTightRaceIds((current) => current.includes(id) ? current : [...current, id]);
        pendingTightRaceToastIds.current.delete(id);
        if (!demo && soundEnabled && alertRules.highTightRace && summary.margin <= HIGH_TIGHT_MARGIN_LIMIT) playLeaderAlert();
      }, index * 4500);
    });

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      candidates.forEach(({ summary, demo }) => {
        pendingTightRaceToastIds.current.delete(tightRaceNotificationKey(summary, demo));
      });
    };
  }, [alertRules.highTightRace, candidatePhotoLookup, selectedIds, seenTightRaceIds, setSeenTightRaceIds, soundEnabled, tightRaceNotificationCandidates]);
  const visibleResults = useMemo(() => {
    return results.filter((result) => {
      if (partyFilter === "all") return true;
      if (partyFilter === "close") return result.margin <= 5000;
      const party = result.leadingParty || result.candidates[0]?.party || "";
      return party === partyFilter;
    });
  }, [partyFilter, results]);
  const hiddenByWatchGroupCount = useMemo(() => {
    if (partyFilter === "all") return 0;
    const visibleIds = new Set(visibleResults.map((result) => result.constituencyId));
    return results.filter((result) => !visibleIds.has(result.constituencyId)).length;
  }, [partyFilter, results, visibleResults]);
  const autoAttentionIds = useMemo(() => {
    const changed = new Set(leaderChanges.map((result) => result.constituencyId));
    return visibleResults
      .filter((result) => changed.has(result.constituencyId) || isDeclaredWinner(result.statusText || result.roundStatus) || result.margin <= alertThreshold)
      .map((result) => result.constituencyId);
  }, [alertThreshold, leaderChanges, visibleResults]);
  const summaryById = useMemo(() => new Map((summaryQuery.data?.results ?? []).map((summary) => [summary.constituencyId, summary])), [summaryQuery.data?.results]);
  const integrityWarningsById = useMemo(() => {
    const warnings: Record<string, string> = {};
    for (const result of results) {
      const summary = summaryById.get(result.constituencyId);
      if (!summary) continue;
      const summaryLeader = normalizeCandidateName(summary.leadingCandidate);
      const detailLeader = normalizeCandidateName(result.leadingCandidate || result.candidates[0]?.candidateName || "");
      const summaryMargin = Number(summary.margin || 0);
      if ((summaryLeader && detailLeader && summaryLeader !== detailLeader) || (summaryMargin > 0 && result.margin > 0 && Math.abs(summaryMargin - result.margin) > 0)) {
        warnings[result.constituencyId] = "State summary and detail page are not fully aligned yet. ECI pages may update at slightly different times.";
      }
    }
    return warnings;
  }, [results, summaryById]);
  const changeInsights = useMemo<ChangeInsight[]>(() => {
    const insights: ChangeInsight[] = [];
    const leaderChangedCount = leaderChanges.length;
    if (leaderChangedCount) {
      insights.push({
        kind: "leader",
        label: `Leader changed in ${leaderChangedCount} seat${leaderChangedCount === 1 ? "" : "s"}`,
        count: leaderChangedCount,
        detail: leaderChanges.slice(0, 3).map((result) => result.constituencyName).join(", ")
      });
    }

    const marginSwings = results.filter((result) => {
      const previous = previousResults.get(result.constituencyId);
      return previous && Math.abs(result.margin - previous.margin) >= 5000;
    });
    if (marginSwings.length) {
      insights.push({
        kind: "margin",
        label: `Margin swing > 5,000 in ${marginSwings.length} seat${marginSwings.length === 1 ? "" : "s"}`,
        count: marginSwings.length,
        detail: marginSwings.slice(0, 3).map((result) => result.constituencyName).join(", ")
      });
    }

    const newWinners = results.filter((result) => {
      const previous = previousResults.get(result.constituencyId);
      return isDeclaredWinner(result.statusText || result.roundStatus) && previous && !isDeclaredWinner(previous.statusText || previous.roundStatus);
    });
    if (newWinners.length) {
      insights.push({
        kind: "winner",
        label: `${newWinners.length} new winner${newWinners.length === 1 ? "" : "s"} declared`,
        count: newWinners.length,
        detail: newWinners.slice(0, 3).map((result) => result.constituencyName).join(", ")
      });
    }
    return insights;
  }, [leaderChanges, previousResults, results]);
  const partySeatDetails = useMemo(() => {
    const grouped = new Map<string, ConstituencySummary[]>();
    for (const summary of allSummaryQuery.data?.results ?? []) {
      const partyKey = partyLookupKey(summary.leadingParty?.trim() ?? "");
      if (!partyKey) continue;
      grouped.set(partyKey, [...(grouped.get(partyKey) ?? []), summary]);
    }
    for (const [party, list] of grouped.entries()) {
      grouped.set(
        party,
        [...list].sort((left, right) => {
          const declaredDelta = Number(isDeclaredWinner(right.statusText || right.roundStatus)) - Number(isDeclaredWinner(left.statusText || left.roundStatus));
          if (declaredDelta) return declaredDelta;
          return Number(right.margin || 0) - Number(left.margin || 0);
        })
      );
    }
    return grouped;
  }, [allSummaryQuery.data?.results]);
  const partyColorsByKey = useMemo(() => {
    const entries = (partySummaryQuery.data?.parties ?? [])
      .map((party) => [partyLookupKey(party.party), party.color] as const)
      .filter(([key, color]) => Boolean(key && color));
    return new Map<string, string>(entries as [string, string][]);
  }, [partySummaryQuery.data?.parties]);
  const activePartySummaries = useMemo(() => {
    if (!activePartyModal) return [];
    return partySeatDetails.get(partyLookupKey(activePartyModal)) ?? [];
  }, [activePartyModal, partySeatDetails]);
  const assemblyVictory = useMemo(() => {
    const summaries = allSummaryQuery.data?.results ?? [];
    const parties = partySummaryQuery.data?.parties ?? [];
    if (!parties.length) return null;

    const uniqueSummaries = Array.from(
      new Map(summaries.map((summary) => [summary.constituencyId || summary.constituencyNumber, summary])).values()
    );
    const totalWonSeats = parties.reduce((sum, party) => sum + party.won, 0);
    const totalLeadOrWonSeats = parties.reduce((sum, party) => sum + party.total, 0);
    const expectedSeats = Math.max(
      uniqueSummaries.length,
      constituencyOptions.length,
      totalLeadOrWonSeats
    );

    if (!expectedSeats) return null;

    const summariesFullyDeclared =
      uniqueSummaries.length >= expectedSeats &&
      uniqueSummaries.every((summary) => isDeclaredWinner(summary.statusText || summary.roundStatus));
    const partyTotalsFullyDeclared = totalWonSeats >= expectedSeats && totalLeadOrWonSeats >= expectedSeats;

    if (!summariesFullyDeclared && !partyTotalsFullyDeclared) return null;

    const sortedParties = [...parties].sort((left, right) => right.total - left.total);
    const winner = sortedParties[0];
    if (!winner || winner.total <= 0) return null;
    const runnerUp = sortedParties[1];
    const closest = [...uniqueSummaries].filter((summary) => summary.margin > 0).sort((left, right) => left.margin - right.margin)[0];
    const biggest = [...uniqueSummaries].sort((left, right) => right.margin - left.margin)[0];
    const totalSeats = parties.reduce((sum, party) => sum + party.total, 0) || expectedSeats;
    return {
      winner,
      runnerUp,
      totalSeats,
      majorityMark: Math.floor(totalSeats / 2) + 1,
      seatLead: Math.max(0, winner.total - (runnerUp?.total ?? 0)),
      closest,
      biggest,
      electionTitle: activeProfile?.electionTitle || sourceConfigQuery.data?.activeTitle || "Assembly Election"
    };
  }, [activeProfile?.electionTitle, allSummaryQuery.data?.results, constituencyOptions.length, partySummaryQuery.data?.parties, sourceConfigQuery.data?.activeTitle]);
  const sortedResults = sortResults(visibleResults, selectedIds, sortMode, pinnedIds, autoAttentionIds);
  const hasSourceWarning = Boolean(constituenciesQuery.data?.warning || summaryQuery.data?.errors?.length);
  const lastEciChangeAt = latestDataUpdatedAt(Object.values(lastChangedAt));
  const sourceHealth = hasSourceWarning || partySummaryQuery.isError || resultQueries.some((query) => query.isError)
    ? "ECI issue"
    : isFetching
      ? "Syncing"
      : lastEciChangeAt
        ? `Changed ${new Date(lastEciChangeAt).toLocaleTimeString()}`
        : "ECI OK";
  const preElectionWindowActive = Date.now() < Date.parse(KERALA_COUNTING_START_AT) && isOldPreviewSource(sourceConfigQuery.data, activeProfile);
  const showOldResultNotice = preElectionWindowActive && !sourceConfigQuery.data?.hidePreviewBanner;
  const showCountingCountdown = preElectionWindowActive && !sourceConfigQuery.data?.hideCountdown;
  const adminSessionPassword = typeof window !== "undefined" ? sessionStorage.getItem("kerala-election:admin-password") ?? "" : "";
  useEffect(() => {
    const signature = assemblyVictory
      ? `${effectiveProfileId}:${assemblyVictory.winner.party}:${assemblyVictory.winner.total}:${assemblyVictory.totalSeats}`
      : "";

    if (!signature) {
      previousAssemblyVictorySignatureRef.current = "";
      return;
    }

    const isFirstLoadForThisWinner = shownAssemblyVictoryRef.current !== signature;
    const justTurnedDeclared = previousAssemblyVictorySignatureRef.current !== signature;

    previousAssemblyVictorySignatureRef.current = signature;
    if (!isFirstLoadForThisWinner && !justTurnedDeclared) return;
    shownAssemblyVictoryRef.current = signature;
    setAssemblyVictoryOpen(true);
  }, [assemblyVictory, effectiveProfileId]);

  useEffect(() => {
    if (!assemblyVictoryOpen) return;
    const timer = window.setTimeout(() => {
      setAssemblyVictoryOpen(false);
    }, VICTORY_OVERLAY_AUTO_CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [assemblyVictoryOpen]);
  const enterWatchMode = () => {
    trackEvent("watch_mode_enter", { selected_count: selectedIds.length });
    setWatchMode(true);
    void document.documentElement.requestFullscreen?.().catch(() => undefined);
  };
  const exitWatchMode = () => {
    trackEvent("watch_mode_exit", { selected_count: selectedIds.length });
    setWatchMode(false);
    if (document.fullscreenElement) void document.exitFullscreen();
  };
  const activateSelectionPanel = () => {
    if (watchMode) exitWatchMode();
    if (sidebarCollapsed) setSidebarCollapsed(false);
    trackEvent("empty_state_activate");
    window.setTimeout(() => {
      const selector = document.querySelector<HTMLInputElement>('input[aria-label="Quick add seat or candidate"]')
        ?? document.querySelector<HTMLInputElement>('input[placeholder="Search constituency"]')
        ?? document.querySelector<HTMLInputElement>('input[placeholder="Search candidate"]');
      selector?.focus();
      selector?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);
  };
  const togglePinned = (id: string) => {
    trackEvent("constituency_pin_toggle", { constituency_id: id, pinned: !pinnedIds.includes(id) });
    setPinnedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };
  const removeSelectedConstituency = (id: string) => {
    trackEvent("constituency_card_remove", { constituency_id: id });
    setSelectedIds((current) => current.filter((item) => item !== id));
    setPinnedIds((current) => current.filter((item) => item !== id));
    const watchedInSeat = new Set(candidateOptions.filter((candidate) => candidate.constituencyId === id).map((candidate) => candidate.candidateId));
    if (watchedInSeat.size) {
      setWatchedCandidateIds((current) => current.filter((candidateId) => !watchedInSeat.has(candidateId)));
    }
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
  const addTightRaceToast = (race: TightRaceNotification) => {
    setTightRaceToasts((current) => [...current.filter((item) => item.id !== race.id), race].slice(-3));
    window.setTimeout(() => {
      setTightRaceToasts((current) => current.filter((item) => item.id !== race.id));
    }, 10000);
  };
  const shareView = async () => {
    const params = new URLSearchParams();
    if (selectedIds.length) params.set("seats", selectedIds.join(","));
    if (watchedCandidateIds.length) params.set("candidates", watchedCandidateIds.join(","));
    if (pinnedIds.length) params.set("pinned", pinnedIds.join(","));
    if (partyFilter !== "all") params.set("filter", partyFilter);
    if (sortMode !== "selected") params.set("sort", sortMode);
    if (alertThreshold !== 1000) params.set("alert", String(alertThreshold));
    const url = `${window.location.origin}${window.location.pathname}${params.toString() ? `?${params}` : ""}`;
    await navigator.clipboard?.writeText(url).catch(() => undefined);
    window.history.replaceState(null, "", url);
    trackEvent("share_view", { selected_count: selectedIds.length, candidate_count: watchedCandidateIds.length, filter: partyFilter, sort: sortMode });
    setToast("Share link copied for this view.");
    window.setTimeout(() => setToast(""), 3500);
  };
  const applySeatPreset = (preset: "favorites" | "tight" | "leaders") => {
    let ids: string[] = [];
    if (preset === "favorites") {
      ids = constituencyOptions.filter((option) => option.isFavoriteDefault).map((option) => option.constituencyId);
    } else if (preset === "tight") {
      ids = tightRaceSuggestions.map((summary) => summary.constituencyId);
    } else {
      ids = allSummaryQuery.data?.results
        ?.filter((summary) => summary.leadingParty && summary.margin > 0)
        .sort((a, b) => b.margin - a.margin)
        .slice(0, 6)
        .map((summary) => summary.constituencyId) ?? [];
    }
    if (!ids.length) return;
    trackEvent("preset_apply", { preset, count: ids.length });
    setSelectedIds((current) => [...new Set([...current, ...ids])]);
  };
  const saveWatchProfile = () => {
    const name = profileName.trim() || "Home";
    const profile: WatchProfile = { name, selectedIds, watchedCandidateIds, pinnedIds, partyFilter, sortMode };
    setWatchProfiles((current) => [profile, ...current.filter((item) => item.name !== name)].slice(0, 5));
    setToast(`${name} profile saved.`);
    window.setTimeout(() => setToast(""), 2500);
  };
  const loadWatchProfile = (profile: WatchProfile) => {
    setSelectedIds(profile.selectedIds);
    setWatchedCandidateIds(profile.watchedCandidateIds);
    setPinnedIds(profile.pinnedIds);
    setPartyFilter(profile.partyFilter);
    setSortMode(profile.sortMode);
    trackEvent("profile_load", { name: profile.name, selected_count: profile.selectedIds.length });
  };
  const manualRefresh = () => {
    if (isFetching) return;
    trackEvent("refresh_now", { selected_count: selectedIds.length });
    if (selectedIds.length) {
      void detailResultsQuery.refetch();
      void partySummaryQuery.refetch();
      void allSummaryQuery.refetch();
    } else {
      void constituenciesQuery.refetch();
    }
  };
  const switchSourceProfile = async (profile: ElectionSourceProfile) => {
    if (profile.profileId === effectiveProfileId) {
      setSourcePickerOpen(false);
      return;
    }
    trackEvent("source_profile_switch", { profile_id: profile.profileId, state: profile.stateName });
    setActiveProfileId(profile.profileId);
    setSourcePickerOpen(false);
    await updateActiveSourceProfile(profile.profileId).catch(() => undefined);
    void queryClient.invalidateQueries();
  };

  const openConstituencyShareCard = async (constituencyId: string) => {
    const existingResult = detailResultsById.get(constituencyId) ?? cachedResults[constituencyId];
    if (existingResult) {
      setShareCardPayload({
        kind: "constituency",
        result: existingResult,
        checkedAt: checkedAtById[constituencyId] || lastCheckedById[constituencyId] || lastSuccessAt,
        electionTitle: activeProfile?.electionTitle || sourceConfigQuery.data?.activeTitle || "Assembly Election",
        leftPartyColor: partyColorsByKey.get(partyLookupKey(existingResult.leadingParty || existingResult.candidates[0]?.party || "")),
        rightPartyColor: partyColorsByKey.get(partyLookupKey(existingResult.trailingParty || existingResult.candidates[1]?.party || ""))
      });
      return;
    }

    setToast("Preparing share card...");
    window.setTimeout(() => setToast(""), 2500);
    try {
      const result = await fetchResult(constituencyId, effectiveProfileId);
      setShareCardPayload({
        kind: "constituency",
        result,
        checkedAt: Date.now(),
        electionTitle: activeProfile?.electionTitle || sourceConfigQuery.data?.activeTitle || "Assembly Election",
        leftPartyColor: partyColorsByKey.get(partyLookupKey(result.leadingParty || result.candidates[0]?.party || "")),
        rightPartyColor: partyColorsByKey.get(partyLookupKey(result.trailingParty || result.candidates[1]?.party || ""))
      });
    } catch {
      setToast("Could not prepare the constituency share card right now.");
      window.setTimeout(() => setToast(""), 3500);
    }
  };

  const openHelpPage = () => {
    const url = new URL(window.location.href);
    url.searchParams.set("view", "help");
    window.history.pushState(null, "", url);
    setAppRoute({ kind: "help" });
    trackEvent("help_open");
  };

  const closeHelpPage = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("view");
    window.history.pushState(null, "", url);
    setAppRoute({ kind: "dashboard" });
    trackEvent("help_close");
  };

  const navigateToPath = (path: string) => {
    if (typeof window === "undefined") return;
    window.history.pushState(null, "", path);
    setAppRoute(parseAppRouteFromLocation());
  };

  if (appView === "help") {
    return (
      <HelpPage
        activeProfileTitle={activeProfile?.electionTitle || sourceConfigQuery.data?.activeTitle || "Assembly Election"}
        refreshSeconds={sourceConfigQuery.data?.refreshIntervalSeconds ?? 30}
        onBack={closeHelpPage}
        onNavigate={navigateToPath}
      />
    );
  }

  if (appRoute.kind === "about") {
    return <AboutUsPage onBack={() => navigateToPath("/")} onNavigate={navigateToPath} />;
  }

  if (appRoute.kind === "contact") {
    return <ContactUsPage onBack={() => navigateToPath("/")} onNavigate={navigateToPath} />;
  }

  if (appRoute.kind === "terms") {
    return <TermsAndConditionsPage onBack={() => navigateToPath("/")} onNavigate={navigateToPath} />;
  }

  if (appRoute.kind === "constituency") {
    return (
      <>
        <ConstituencyDetailPage
          stateSlug={appRoute.stateSlug}
          constituencySlug={appRoute.constituencySlug}
          profileId={detailProfileId}
          watchedIds={detailProfileId && detailProfileId !== effectiveProfileId ? (selectedIdsByProfile[detailProfileId] ?? []) : selectedIds}
          onBack={() => {
            navigateToPath("/");
          }}
          onToggleWatchlist={(constituencyId) => {
            setSelectedIds((current) => current.includes(constituencyId)
              ? current.filter((item) => item !== constituencyId)
              : [...current, constituencyId]);
          }}
          onGenerateShareCard={(detail) => setShareCardPayload(buildConstituencySharePayloadFromDetail(
            detail,
            activeProfile?.electionTitle || sourceConfigQuery.data?.activeTitle || "Assembly Election",
            partyColorsByKey
          ))}
          onOpenAlerts={() => telegramLinkMutation.mutate()}
          onNavigate={navigateToPath}
        />
        {shareCardPayload && <ShareCardModal payload={shareCardPayload} onClose={() => setShareCardPayload(null)} />}
      </>
    );
  }

  return (
    <>
    <main className="min-h-screen max-w-full overflow-x-hidden">
      {(showOldResultNotice || showCountingCountdown) && (
        <OldResultNotice showBanner={showOldResultNotice} showCountdown={showCountingCountdown} />
      )}
      {!watchMode && <section className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mx-auto flex w-full max-w-[2200px] flex-col gap-4 px-4 py-3 sm:gap-6 sm:px-6 sm:py-5 lg:px-8">
          <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <p className="hidden text-sm font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400 sm:block">Official ECI Source</p>
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="relative min-w-0">
                  <button
                    className="brand-title min-w-0 rounded-md text-left text-lg leading-tight text-zinc-950 transition hover:text-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 dark:text-white dark:hover:text-emerald-200 sm:mt-2 sm:text-3xl"
                    onClick={() => setSourcePickerOpen((current) => !current)}
                    title="Change focused assembly result"
                    aria-label="Change focused assembly result"
                    type="button"
                  >
                    {activeProfile?.electionTitle || sourceConfigQuery.data?.activeTitle || "Assembly Election"} Live Tracker
                  </button>
                  {sourcePickerOpen && (
                    <SourceProfilePicker
                      profiles={sourceProfiles}
                      activeProfileId={effectiveProfileId}
                      onSelect={(profile) => void switchSourceProfile(profile)}
                    />
                  )}
                </div>
                <button
                  className="btn-press inline-flex shrink-0 items-center justify-center rounded-md border border-zinc-300 p-2 text-zinc-700 transition hover:bg-zinc-100 active:scale-[0.98] dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900 sm:hidden"
                  onClick={enterWatchMode}
                  title="Watch mode"
                  aria-label="Watch mode"
                  type="button"
                >
                  <Maximize2 className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-2 flex max-w-3xl flex-wrap items-center gap-x-3 gap-y-1 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
                <p>Track only what matters. Ignore the noise.</p>
                <button
                  className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:text-emerald-900 dark:text-emerald-400 dark:hover:text-emerald-200"
                  onClick={openHelpPage}
                  type="button"
                >
                  <HelpCircle className="h-3.5 w-3.5" />
                  Help & user guide
                </button>
              </div>
            </div>
            <div className="grid w-full min-w-0 grid-cols-3 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:overflow-visible">
              <QuickAddSearch
                constituencies={constituencyOptions}
                candidates={candidateOptions}
                onAdd={(constituencyId, candidateId) => {
                  trackEvent("quick_add", { constituency_id: constituencyId, has_candidate: Boolean(candidateId) });
                  setSelectedIds((current) => current.includes(constituencyId) ? current : [...current, constituencyId]);
                  if (candidateId) setWatchedCandidateIds((current) => current.includes(candidateId) ? current : [...current, candidateId]);
                }}
              />
              <button className="btn-press inline-flex w-full items-center justify-center rounded-md border border-zinc-300 px-3 py-2 text-sm font-semibold dark:border-zinc-700 sm:w-auto" onClick={() => setDarkMode(!darkMode)}>
                {darkMode ? <Sun className="mr-2 inline h-4 w-4" /> : <Moon className="mr-2 inline h-4 w-4" />}
                {darkMode ? "Light" : "Dark"}
              </button>
              <button
                className="btn-press inline-flex w-full items-center justify-center rounded-md border border-zinc-300 px-3 py-2 text-sm font-semibold dark:border-zinc-700 sm:w-auto"
                onClick={() => {
                  const next = !soundEnabled;
                  setSoundEnabled(next);
                  if (next) void primeAudioAlerts();
                }}
              >
                <Bell className="mr-2 inline h-4 w-4" />
                Alerts {soundEnabled ? "On" : "Off"}
              </button>
              <button
                className="btn-press-dark inline-flex w-full items-center justify-center rounded-md bg-zinc-950 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 dark:border dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 sm:w-auto"
                onClick={manualRefresh}
                disabled={isFetching}
              >
                <RefreshCw className={`mr-2 inline h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
                <span className="sm:hidden">Refresh</span>
                <span className="hidden sm:inline">Refresh Now</span>
              </button>
              <button
                className="btn-press hidden w-full shrink-0 items-center justify-center rounded-md border border-zinc-300 px-3 py-2 text-[0px] font-semibold dark:border-zinc-700 sm:inline-flex sm:w-auto"
                onClick={enterWatchMode}
                title="Watch mode"
                aria-label="Watch mode"
                type="button"
              >
                <Maximize2 className="h-4 w-4" />
                ?
              </button>
            </div>
          </div>

          <div className="hidden gap-3 md:grid md:grid-cols-4">
            <DashboardMetrics selectedCount={selectedIds.length} countdown={countdown} lastSuccessAt={lastSuccessAt} sourceHealth={sourceHealth} />
          </div>
        </div>
      </section>}

      <section className={`${watchMode ? "mx-auto w-full max-w-[2400px] overflow-x-hidden px-4 py-4 sm:px-6 lg:px-8" : "mx-auto w-full max-w-[2200px] overflow-x-hidden px-4 py-6 sm:px-6 lg:px-8"}`}>
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
        {battlegroundPreview.length > 0 && dismissedBattlegroundSignal !== battlegroundSignal && (
          <BattlegroundStrip
            key={battlegroundSignal}
            races={battlegroundPreview}
            selectedIds={selectedIds}
            leaderChanges={leaderChanges}
            candidatePhotoLookup={candidatePhotoLookup}
            onAdd={(summary) => {
              trackEvent("battleground_add", { constituency_id: summary.constituencyId, margin: summary.margin });
              setSelectedIds((current) => current.includes(summary.constituencyId) ? current : [...current, summary.constituencyId]);
            }}
            onShare={(summary) => void openConstituencyShareCard(summary.constituencyId)}
            onOpenAll={() => {
              trackEvent("battleground_open_all", { count: battlegroundRaces.length });
              setBattlegroundOpen(true);
            }}
            onDismiss={() => setDismissedBattlegroundSignal(battlegroundSignal)}
          />
        )}

        <div className={watchMode ? "block min-w-0" : `grid min-w-0 gap-5 ${sidebarCollapsed ? "lg:grid-cols-[72px_minmax(0,1fr)]" : "lg:grid-cols-[260px_minmax(0,1fr)]"}`}>
          {!watchMode && <aside className="order-2 space-y-4 lg:order-none lg:col-start-1 lg:row-start-1">
            <ConstituencySelector
              options={constituencyOptions}
              selectedIds={selectedIds}
              onChange={(ids) => {
                trackEvent("constituency_selection_change", { selected_count: ids.length });
                setSelectedIds(ids);
                if (!ids.length) setWatchedCandidateIds([]);
              }}
              isLoading={!constituencyOptions.length && constituenciesQuery.isLoading}
              collapsed={sidebarCollapsed}
              onCollapsedChange={setSidebarCollapsed}
            />
            {!sidebarCollapsed && (
              <CandidateWatchlist
                candidates={candidateOptions}
                watchedCandidates={watchedCandidates}
                isLoading={!candidateOptions.length && (candidatesQuery.isLoading || candidatesQuery.isFetching)}
                onSelect={(candidate) => {
                  trackEvent("candidate_watch_add", {
                    candidate_id: candidate.candidateId,
                    constituency_id: candidate.constituencyId,
                    party: shortPartyName(candidate.party)
                  });
                  setWatchedCandidateIds((current) => current.includes(candidate.candidateId) ? current : [...current, candidate.candidateId]);
                  setSelectedIds((current) => current.includes(candidate.constituencyId) ? current : [...current, candidate.constituencyId]);
                }}
                onRemove={(candidate) => {
                  trackEvent("candidate_watch_remove", { candidate_id: candidate.candidateId, constituency_id: candidate.constituencyId });
                  setWatchedCandidateIds((current) => current.filter((id) => id !== candidate.candidateId));
                  setSelectedIds((current) => current.filter((id) => id !== candidate.constituencyId));
                }}
              />
            )}
          </aside>}

          <div
            className={watchMode ? "grid min-w-0 content-start gap-4" : "order-1 grid min-w-0 content-start gap-4 lg:col-start-2 lg:row-span-2 lg:row-start-1"}
            style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${watchMode ? "360px" : "300px"}), 1fr))` }}
          >
            {selectedIds.length === 0 && <EmptyState onActivate={activateSelectionPanel} />}
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
                freshness={resultFreshnessById[result.constituencyId] ?? "Cached"}
                isPinned={pinnedIds.includes(result.constituencyId)}
                onTogglePin={() => togglePinned(result.constituencyId)}
                onRemove={() => removeSelectedConstituency(result.constituencyId)}
                changedAt={lastChangedAt[result.constituencyId]}
                leaderChanged={leaderChanges.some((item) => item.constituencyId === result.constituencyId)}
                integrityWarning={integrityWarningsById[result.constituencyId]}
                lowBandwidthMode={lowBandwidthMode}
                history={replayHistoryById[result.constituencyId] ?? leaderHistory[result.constituencyId] ?? []}
                seatHistory={constituencyHistoryById.get(result.constituencyId)}
                note={constituencyNotes[result.constituencyId] ?? ""}
                onNoteChange={(note) => setConstituencyNotes((current) => ({ ...current, [result.constituencyId]: note }))}
                onNavigate={() => {
                  const nextPath = buildConstituencyPath(activeProfile?.stateName, result.constituencyName);
                  window.history.pushState(null, "", nextPath);
                  setAppRoute(parseAppRouteFromLocation());
                  trackEvent("constituency_detail_open", { constituency_id: result.constituencyId, constituency: result.constituencyName });
                }}
                onShare={() => setShareCardPayload({
                  kind: "constituency",
                  result,
                  checkedAt: checkedAtById[result.constituencyId] || lastCheckedById[result.constituencyId] || lastSuccessAt,
                  electionTitle: activeProfile?.electionTitle || sourceConfigQuery.data?.activeTitle || "Assembly Election",
                  leftPartyColor: partyColorsByKey.get(partyLookupKey(result.leadingParty || result.candidates[0]?.party || "")),
                  rightPartyColor: partyColorsByKey.get(partyLookupKey(result.trailingParty || result.candidates[1]?.party || ""))
                })}
              />
            ))}
          </div>
          {!watchMode && !sidebarCollapsed && (
            <div id="controls-pane" className="order-3 flex flex-col gap-4 lg:col-start-1 lg:row-start-2">
              <div className="panel rounded-md p-4">
                <label className="text-sm font-semibold text-zinc-700 dark:text-zinc-200" htmlFor="sort">Sort cards</label>
                <select
                  id="sort"
                  className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-base dark:border-zinc-700 dark:bg-zinc-900 sm:text-sm"
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
                  className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-base dark:border-zinc-700 dark:bg-zinc-900 sm:text-sm"
                  value={partyFilter}
                  onChange={(event) => setPartyFilter(event.target.value)}
                >
                  <option value="all">All selected</option>
                  <option value="close">Close fights</option>
                  {partyOptions.map((party) => (
                    <option key={party} value={party}>{party}</option>
                  ))}
                </select>
                {hiddenByWatchGroupCount > 0 && (
                  <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] font-semibold text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
                    {formatNumber(hiddenByWatchGroupCount)} selected {hiddenByWatchGroupCount === 1 ? "seat is" : "seats are"} hidden by the current watch group.
                  </div>
                )}
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
                    className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-base dark:border-zinc-700 dark:bg-zinc-900 sm:text-sm"
                    value={alertThreshold}
                    onChange={(event) => setAlertThreshold(Number(event.target.value.replace(/\D/g, "")) || 1000)}
                    title="Close alert margin"
                  />
                  <button className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-semibold dark:border-zinc-700" onClick={shareView} title="Copy share link">
                    <Share2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-1.5">
                  <button className="rounded-md border border-zinc-300 px-2 py-1.5 text-[10px] font-black uppercase text-zinc-600 transition hover:border-emerald-500 hover:bg-emerald-50 hover:text-emerald-800 active:scale-[0.98] active:bg-emerald-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-emerald-700 dark:hover:bg-emerald-950/50 dark:hover:text-emerald-200" onClick={() => applySeatPreset("favorites")}>
                    Key
                  </button>
                  <button className="rounded-md border border-zinc-300 px-2 py-1.5 text-[10px] font-black uppercase text-zinc-600 transition hover:border-amber-500 hover:bg-amber-50 hover:text-amber-800 active:scale-[0.98] active:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-500/40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-amber-700 dark:hover:bg-amber-950/50 dark:hover:text-amber-200" onClick={() => applySeatPreset("tight")}>
                    Tight
                  </button>
                  <button className="rounded-md border border-zinc-300 px-2 py-1.5 text-[10px] font-black uppercase text-zinc-600 transition hover:border-sky-500 hover:bg-sky-50 hover:text-sky-800 active:scale-[0.98] active:bg-sky-100 focus:outline-none focus:ring-2 focus:ring-sky-500/40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-sky-700 dark:hover:bg-sky-950/50 dark:hover:text-sky-200" onClick={() => applySeatPreset("leaders")}>
                    Leads
                  </button>
                </div>
                <AlertRulesControl rules={alertRules} onChange={setAlertRules} />
                <WatchProfiles
                  name={profileName}
                  profiles={watchProfiles}
                  onNameChange={setProfileName}
                  onSave={saveWatchProfile}
                  onLoad={loadWatchProfile}
                />
                <div className="mt-3 rounded-md border border-sky-200 bg-sky-50 p-3 dark:border-sky-900 dark:bg-sky-950/30">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[11px] font-black uppercase tracking-wide text-sky-800 dark:text-sky-200">Telegram alerts</div>
                      <div className="mt-1 text-xs font-semibold text-sky-900 dark:text-sky-100">
                        {telegramStatusQuery.data?.linked
                          ? `Linked to ${telegramStatusQuery.data.chatLabel || "Telegram"}.`
                          : "Get lead changes, winners, and tight-race alerts on Telegram."}
                      </div>
                    </div>
                    <button
                      className="btn-press rounded-md border border-sky-300 bg-white px-3 py-2 text-xs font-black uppercase text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100"
                      onClick={() => telegramLinkMutation.mutate()}
                      disabled={telegramLinkMutation.isPending || !effectiveProfileId}
                      type="button"
                      title="Get Telegram alerts"
                    >
                      <TelegramIcon className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="mt-2 text-[11px] text-sky-800 dark:text-sky-200">
                    {telegramStatusQuery.data?.linked
                      ? `${telegramStatusQuery.data.selectedCount ?? selectedIds.length} seat alerts active for this election profile.`
                      : "Tap the icon, open the bot, and press Start once."}
                  </div>
                </div>
                <DiagnosticsMini
                  total={selectedIds.length}
                  fresh={Object.values(resultFreshnessById).filter((item) => item === "Fresh").length}
                  cached={Object.values(resultFreshnessById).filter((item) => item === "Cached").length}
                  stale={Object.values(resultFreshnessById).filter((item) => item === "Stale").length}
                  failed={resultQueries.filter((query) => query.isError).length}
                />
                <WhatChangedPanel insights={changeInsights} lastCheckedAt={lastSuccessAt} />
              </div>
              <TightRaceSuggestions
                suggestions={tightRaceSuggestions}
                onAdd={(summary) => {
                  trackEvent("tight_race_add", {
                    constituency_id: summary.constituencyId,
                    margin: summary.margin
                  });
                  setSelectedIds((current) => current.includes(summary.constituencyId) ? current : [...current, summary.constituencyId]);
                }}
              />
              <SourceConfigPanel
                sourceConfig={sourceConfigQuery.data}
                activeProfileId={effectiveProfileId}
                onUpdated={() => {
                  setCachedConstituencies([]);
                  setCachedCandidates([]);
                  setCachedResults({});
                  setCachedConstituenciesByProfile((current) => ({ ...current, [effectiveProfileId]: [] }));
                  setCachedCandidatesByProfile((current) => ({ ...current, [effectiveProfileId]: [] }));
                  setCachedResultsByProfile((current) => ({ ...current, [effectiveProfileId]: {} }));
                  setWatchedCandidateIds([]);
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
      <Footer navigate={navigateToPath} />
    </main>
      <PartySummaryDock
        parties={partySummaryQuery.data?.parties ?? []}
        checkedAt={partySummaryQuery.dataUpdatedAt}
        traffic={trafficQuery.data}
        chatOpen={chatOpen}
        chatUnreadCount={unreadChatCount}
        onChatClick={() => setChatOpen((current) => !current)}
        onShare={() => setShareCardPayload({
          kind: "party-summary",
          parties: partySummaryQuery.data?.parties ?? [],
          electionTitle: activeProfile?.electionTitle || sourceConfigQuery.data?.activeTitle || "Assembly Election"
        })}
        onPartyClick={(party) => {
          setActivePartyModal(party);
          trackEvent("party_summary_open", { party: shortPartyName(party) });
        }}
      />
      <CommunityChatPanel
        open={chatOpen}
        onOpenChange={setChatOpen}
        messages={liveChatMessages}
        unreadCount={unreadChatCount}
        darkMode={darkMode}
        displayName={chatDisplayName}
        onDisplayNameChange={setChatDisplayName}
        onSend={(message) => chatPostMutation.mutateAsync({
          profileId: effectiveProfileId,
          viewerId,
          displayName: chatDisplayName,
          adminPassword: adminSessionPassword === ADMIN_PASSWORD ? adminSessionPassword : undefined,
          message
        })}
        onDelete={(messageId) => chatDeleteMutation.mutateAsync({ password: adminSessionPassword, messageId, profileId: effectiveProfileId })}
        isLoading={chatMessagesQuery.isLoading && liveChatMessages.length === 0}
        isSending={chatPostMutation.isPending}
        isDeleting={chatDeleteMutation.isPending}
        sendError={chatPostMutation.error instanceof Error ? chatPostMutation.error.message : undefined}
        deleteError={chatDeleteMutation.error instanceof Error ? chatDeleteMutation.error.message : undefined}
        canModerate={adminSessionPassword === ADMIN_PASSWORD}
      />
      {activePartyModal && (
        <PartyConstituencyModal
          party={activePartyModal}
          summaries={activePartySummaries}
          candidatePhotoLookup={candidatePhotoLookup}
          suppressImage={lowBandwidthMode}
          onClose={() => setActivePartyModal(null)}
        />
      )}
      {assemblyVictoryOpen && assemblyVictory && (
        <AssemblyVictoryOverlay
          outcome={assemblyVictory}
          onShare={() => setShareCardPayload({ kind: "victory", outcome: assemblyVictory })}
          onClose={() => setAssemblyVictoryOpen(false)}
        />
      )}
      {battlegroundOpen && (
        <BattlegroundModal
          races={battlegroundRaces}
          selectedIds={selectedIds}
          leaderChanges={leaderChanges}
          candidatePhotoLookup={candidatePhotoLookup}
          onAdd={(summary) => {
            setSelectedIds((current) => current.includes(summary.constituencyId) ? current : [...current, summary.constituencyId]);
            trackEvent("battleground_modal_add", { constituency_id: summary.constituencyId, margin: summary.margin });
          }}
          onShareRace={(summary) => void openConstituencyShareCard(summary.constituencyId)}
          onShare={() => setShareCardPayload({
            kind: "battleground",
            races: battlegroundRaces.slice(0, 5),
            electionTitle: activeProfile?.electionTitle || sourceConfigQuery.data?.activeTitle || "Assembly Election"
          })}
          onClose={() => setBattlegroundOpen(false)}
        />
      )}
      {shareCardPayload && <ShareCardModal payload={shareCardPayload} onClose={() => setShareCardPayload(null)} />}
      {toast && (
        <div className="fixed right-4 top-4 z-[60] max-w-sm rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-950 shadow-lg dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100">
          {toast}
        </div>
      )}
      {watchMode && (leaderChanges.length > 0 || winnerToasts.length > 0 || tightRaceToasts.length > 0) && (
        <WatchModeSignal count={leaderChanges.length + winnerToasts.length + tightRaceToasts.length} />
      )}
      {(winnerToasts.length > 0 || tightRaceToasts.length > 0 || lostToasts.length > 0) && (
        <div className="fixed bottom-24 right-4 z-[70] flex w-[calc(100vw-2rem)] max-w-md flex-col gap-3 sm:bottom-4">
          {winnerToasts.map((winner) => (
            <WinnerToast key={`winner-${winner.id}`} winner={winner} onClose={() => setWinnerToasts((current) => current.filter((item) => item.id !== winner.id))} />
          ))}
          {tightRaceToasts.map((race) => (
            <TightRaceToast
              key={`tight-${race.id}`}
              race={race}
              onAdd={() => {
                setSelectedIds((current) => current.includes(race.constituencyId) ? current : [...current, race.constituencyId]);
                setTightRaceToasts((current) => current.filter((item) => item.id !== race.id));
                trackEvent("tight_race_toast_add", { constituency_id: race.constituencyId, margin: race.margin });
              }}
              onClose={() => setTightRaceToasts((current) => current.filter((item) => item.id !== race.id))}
            />
          ))}
          {lostToasts.map((lost) => (
            <LostToast key={`lost-${lost.id}`} lost={lost} onClose={() => setLostToasts((current) => current.filter((item) => item.id !== lost.id))} />
          ))}
        </div>
      )}
      <LiveAudioPlayer
        channels={LIVE_CHANNELS}
        selectedChannelId={selectedLiveChannelId}
        onSelectedChannelIdChange={setSelectedLiveChannelId}
        started={liveAudioStarted && !lowBandwidthMode}
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
    </>
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

function OldResultNotice({ showBanner, showCountdown }: { showBanner: boolean; showCountdown: boolean }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const startsAt = new Date(KERALA_COUNTING_START_AT);
  const remainingMs = startsAt.getTime() - now;
  if (remainingMs <= 0 || (!showBanner && !showCountdown)) return null;

  return (
    <>
      {showBanner && (
        <div className="pointer-events-none fixed inset-x-0 top-0 z-[90] overflow-hidden border-b border-amber-300 bg-amber-50/95 text-amber-950 shadow-sm backdrop-blur dark:border-amber-800 dark:bg-amber-950/90 dark:text-amber-100" role="status" aria-live="polite">
          <div className="animate-notice-marquee whitespace-nowrap px-3 py-1.5 text-[11px] font-bold sm:text-xs">
            Current preview uses old Bihar Assembly Election 2025 result data from ECI. Kerala Assembly Election 2026 live results will appear here after counting starts on {startsAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })} IST.
          </div>
        </div>
      )}
      {showCountdown && <CountingCountdown remainingMs={remainingMs} />}
    </>
  );
}

function CountingCountdown({ remainingMs }: { remainingMs: number }) {
  const parts = countdownParts(remainingMs);
  return (
    <div className="pointer-events-none fixed right-3 top-8 z-[91] rounded-md border border-emerald-200 bg-white/95 px-3 py-2 text-zinc-950 shadow-lg backdrop-blur dark:border-emerald-800 dark:bg-zinc-950/95 dark:text-white sm:right-4" aria-label="Countdown to Kerala counting start">
      <div className="text-[9px] font-black uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Kerala counting starts in</div>
      <div className="mt-1 flex items-end gap-1.5">
        <CountdownUnit label="D" value={parts.days} />
        <CountdownUnit label="H" value={parts.hours} />
        <CountdownUnit label="M" value={parts.minutes} />
        <CountdownUnit label="S" value={parts.seconds} animated />
      </div>
    </div>
  );
}

function CountdownUnit({ label, value, animated = false }: { label: string; value: number; animated?: boolean }) {
  return (
    <div className={`min-w-8 rounded bg-zinc-100 px-1.5 py-1 text-center dark:bg-zinc-900 ${animated ? "animate-countdown-second" : ""}`}>
      <div className="font-mono text-base font-black leading-none tabular-nums text-zinc-950 dark:text-white">{String(value).padStart(2, "0")}</div>
      <div className="mt-0.5 text-[8px] font-black text-zinc-500">{label}</div>
    </div>
  );
}

function WatchModeSignal({ count }: { count: number }) {
  return (
    <div className="fixed right-0 top-1/2 z-[66] -translate-y-1/2 rounded-l-md border border-r-0 border-emerald-300 bg-emerald-600 px-1.5 py-3 text-[10px] font-black text-white shadow-lg dark:border-emerald-800" title={`${count} live alert${count === 1 ? "" : "s"}`}>
      {count}
    </div>
  );
}

function SourceProfilePicker({
  profiles,
  activeProfileId,
  onSelect
}: {
  profiles: ElectionSourceProfile[];
  activeProfileId: string;
  onSelect: (profile: ElectionSourceProfile) => void;
}) {
  const enabledProfiles = profiles.filter((profile) => profile.enabled);
  if (enabledProfiles.length <= 1) return null;
  return (
    <div className="absolute left-0 top-full z-[80] mt-2 w-[min(92vw,360px)] rounded-md border border-zinc-200 bg-white p-2 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
      <div className="px-2 pb-2 text-[10px] font-black uppercase tracking-wide text-zinc-500">Focus assembly result</div>
      <div className="max-h-72 overflow-y-auto">
        {enabledProfiles.map((profile) => (
          <button
            key={profile.profileId}
            className={`btn-press block w-full rounded-md px-3 py-2 text-left ${profile.profileId === activeProfileId ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100" : "hover:bg-zinc-100 dark:hover:bg-zinc-900"}`}
            onClick={() => onSelect(profile)}
            type="button"
          >
            <div className="truncate text-sm font-black">{profile.electionTitle}</div>
            <div className="mt-1 flex items-center gap-2 text-[10px] font-semibold text-zinc-500">
              <span>{formatNumber(profile.constituencyCount)} seats</span>
              <span>{profile.sampleVerified ? "Verified" : "Review"}</span>
              <span>{profile.confidence}%</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function QuickAddSearch({
  constituencies,
  candidates,
  onAdd
}: {
  constituencies: ConstituencyOption[];
  candidates: CandidateOption[];
  onAdd: (constituencyId: string, candidateId?: string) => void;
}) {
  const [query, setQuery] = useState("");
  const searchTerm = query.trim().toLowerCase();
  const matches = searchTerm.length < 1
    ? []
    : [
        ...constituencies
          .filter((constituency) => `${constituency.constituencyName} ${constituency.constituencyNumber}`.toLowerCase().includes(searchTerm))
          .slice(0, 6)
          .map((constituency) => ({
            id: `seat-${constituency.constituencyId}`,
            kind: "Seat",
            label: constituency.constituencyName,
            meta: `AC ${constituency.constituencyNumber}`,
            constituencyId: constituency.constituencyId,
            candidateId: undefined
          })),
        ...candidates
          .filter((candidate) => `${candidate.candidateName} ${candidate.party} ${candidate.constituencyName} ${candidate.constituencyNumber}`.toLowerCase().includes(searchTerm))
          .slice(0, 4)
          .map((candidate) => ({
            id: `candidate-${candidate.candidateId}`,
            kind: "Candidate",
            label: candidate.candidateName,
            meta: `${shortPartyName(candidate.party)} - ${candidate.constituencyName}`,
            constituencyId: candidate.constituencyId,
            candidateId: candidate.candidateId
          }))
      ].slice(0, 8);

  return (
    <div className="relative col-span-3 w-full sm:col-span-1 sm:w-auto sm:shrink-0">
      <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-zinc-400" />
      <input
        className="w-full rounded-md border border-zinc-300 bg-white py-2 pl-8 pr-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 sm:w-52"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || !matches[0]) return;
          event.preventDefault();
          onAdd(matches[0].constituencyId, matches[0].candidateId);
          setQuery("");
        }}
        placeholder="Add seat/candidate"
        aria-label="Quick add seat or candidate"
      />
      {matches.length > 0 && (
        <div className="absolute left-0 top-full z-50 mt-2 w-full rounded-md border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-800 dark:bg-zinc-950 sm:left-auto sm:right-0 sm:w-72">
          {matches.map((item) => (
            <button
              type="button"
              key={item.id}
              className="block w-full rounded-md px-2 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-900"
              onClick={() => {
                onAdd(item.constituencyId, item.candidateId);
                setQuery("");
              }}
            >
              <div className="flex items-center gap-2">
                <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[9px] font-black uppercase text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{item.kind}</span>
                <span className="min-w-0 flex-1 truncate text-xs font-black text-zinc-950 dark:text-white">{item.label}</span>
              </div>
              <div className="mt-0.5 truncate pl-12 text-[10px] font-semibold text-zinc-500">{item.meta}</div>
            </button>
          ))}
        </div>
      )}
    </div>
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

function TightRaceToast({
  race,
  onAdd,
  onClose
}: {
  race: TightRaceNotification;
  onAdd: () => void;
  onClose: () => void;
}) {
  return (
    <div className="animate-winner-toast rounded-md border border-amber-300 bg-white p-3 shadow-2xl dark:border-amber-800 dark:bg-zinc-950" role="status" aria-live="polite">
      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          <CandidatePhoto candidateName={race.leadingCandidate} photoUrl={race.leadingCandidatePhotoUrl} size="tiny" tone="leading" />
          <div className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            <AlertTriangle size={10} />
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-black uppercase tracking-wide text-amber-700 dark:text-amber-300">
            {race.demo ? "Demo alert" : race.declared ? "Narrow result" : "Tight race"}
          </div>
          <div className="mt-1 truncate text-sm font-black text-zinc-950 dark:text-white" title={race.constituencyName}>
            {race.constituencyName}
          </div>
          <div className="mt-1 truncate text-xs font-semibold text-zinc-600 dark:text-zinc-300" title={race.leadingCandidate}>
            {race.leadingCandidate} leads by {formatNumber(race.margin)}
          </div>
        </div>
        <button className="rounded-md border border-zinc-300 px-2 py-1 text-[10px] font-black dark:border-zinc-700" onClick={onClose} aria-label="Dismiss tight race alert">
          <X size={12} />
        </button>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold text-zinc-500">
          {race.demo ? "Local demo only" : race.margin <= HIGH_TIGHT_MARGIN_LIMIT ? "High tight race alert" : "Tap add to track it"}
        </span>
        <button className="rounded-md bg-zinc-950 px-3 py-1.5 text-[10px] font-black uppercase text-white dark:bg-white dark:text-zinc-950" onClick={onAdd}>
          Add
        </button>
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
            className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-base font-bold dark:border-zinc-700 dark:bg-zinc-900 sm:text-xs"
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
  onRemove: (candidate: CandidateOption) => void;
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
          className="w-full rounded-md border border-zinc-300 bg-white py-2 pl-9 pr-3 text-base dark:border-zinc-700 dark:bg-zinc-900 sm:text-sm"
          placeholder={isLoading ? "Loading candidates..." : "Search candidate"}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
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
              <div className="flex items-center gap-2">
                <CandidatePhoto candidateName={candidate.candidateName} photoUrl={candidate.photoUrl} size="mini" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-black text-zinc-950 dark:text-white">{candidate.candidateName}</div>
                  <div className="mt-0.5 truncate text-xs font-semibold text-zinc-500">
                    {shortPartyName(candidate.party)} · {candidate.constituencyName} ({candidate.constituencyNumber})
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
      {watchedCandidates.length > 0 && (
        <div className="mt-3 flex max-h-24 flex-wrap gap-1 overflow-y-auto">
          {watchedCandidates.map((candidate) => (
            <button
              key={candidate.candidateId}
              className="inline-flex items-center gap-1.5 rounded-md bg-sky-100 px-2 py-1 text-xs font-bold text-sky-900 dark:bg-sky-900 dark:text-sky-100"
              onClick={() => onRemove(candidate)}
              title={`Remove ${candidate.candidateName}`}
            >
              <CandidatePhoto candidateName={candidate.candidateName} photoUrl={candidate.photoUrl} size="mini" />
              <span className="max-w-28 truncate">{candidate.candidateName}</span>
              <X className="h-3 w-3" />
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

function TightRaceSuggestions({
  suggestions,
  onAdd
}: {
  suggestions: ConstituencySummary[];
  onAdd: (summary: ConstituencySummary) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="panel rounded-md p-4">
      <button className="flex w-full items-center justify-between gap-2 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="font-bold text-zinc-950 dark:text-white">Tight races</span>
        <span className="rounded-md bg-amber-100 px-2 py-1 text-xs font-black text-amber-900 dark:bg-amber-900 dark:text-amber-100">{suggestions.length}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-2">
          {suggestions.length === 0 && <div className="text-sm text-zinc-500">No untracked tight races right now.</div>}
          {suggestions.map((summary) => (
            <div key={summary.constituencyId} className="rounded-md border border-zinc-200 p-2 dark:border-zinc-800">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-black text-zinc-950 dark:text-white">{summary.constituencyName}</div>
                  <div className="mt-0.5 truncate text-xs font-semibold text-zinc-500">
                    {summary.leadingCandidate || "Leader"} by {formatNumber(summary.margin)}
                  </div>
                </div>
                <button
                  className="shrink-0 rounded-md border border-amber-300 px-2 py-1 text-xs font-black text-amber-800 transition hover:-translate-y-0.5 hover:bg-amber-50 hover:shadow-sm active:translate-y-0 active:scale-[0.97] focus:outline-none focus:ring-2 focus:ring-amber-500/40 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-950/50"
                  onClick={() => onAdd(summary)}
                >
                  Add
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AlertRulesControl({ rules, onChange }: { rules: AlertRules; onChange: (value: AlertRules | ((current: AlertRules) => AlertRules)) => void }) {
  const items: Array<[keyof AlertRules, string]> = [
    ["leaderChange", "Leader"],
    ["winnerDeclared", "Winner"],
    ["highTightRace", "Tight"],
    ["candidateWatch", "Watch"]
  ];
  return (
    <div className="mt-3">
      <div className="text-[10px] font-black uppercase tracking-wide text-zinc-500">Wake me for</div>
      <div className="mt-2 grid grid-cols-4 gap-1">
        {items.map(([key, label]) => (
          <button
            key={key}
            className={`rounded-md border px-1.5 py-1 text-[10px] font-black ${rules[key] ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200" : "border-zinc-300 text-zinc-500 dark:border-zinc-700"}`}
            onClick={() => onChange((current) => ({ ...current, [key]: !current[key] }))}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function WatchProfiles({
  name,
  profiles,
  onNameChange,
  onSave,
  onLoad
}: {
  name: string;
  profiles: WatchProfile[];
  onNameChange: (name: string) => void;
  onSave: () => void;
  onLoad: (profile: WatchProfile) => void;
}) {
  return (
    <div className="mt-3">
      <div className="mb-1 text-[10px] font-black uppercase tracking-wide text-zinc-500">Save current view</div>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <input
          className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-base dark:border-zinc-700 dark:bg-zinc-900 sm:text-xs"
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder="Watchlist name"
          aria-label="Watchlist name"
        />
        <button className="btn-press rounded-md border border-zinc-300 px-2 py-1.5 text-xs font-black dark:border-zinc-700" onClick={onSave} type="button">
          Save
        </button>
      </div>
      {profiles.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {profiles.slice(0, 5).map((profile) => (
            <button key={profile.name} className="btn-press rounded-md bg-zinc-100 px-2 py-1 text-[10px] font-bold text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200" onClick={() => onLoad(profile)} type="button">
              {profile.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function DiagnosticsMini({ total, fresh, cached, stale, failed }: { total: number; fresh: number; cached: number; stale: number; failed: number }) {
  return (
    <div className="mt-3 rounded-md border border-zinc-200 px-2 py-1.5 text-[10px] font-bold text-zinc-500 dark:border-zinc-800" title="Fetched / cached / stale / failed cards">
      Data {fresh}/{total} fresh · {cached} cached · {stale} stale · {failed} failed
    </div>
  );
}

function WhatChangedPanel({ insights, lastCheckedAt }: { insights: ChangeInsight[]; lastCheckedAt?: number }) {
  return (
    <div className="mt-3 rounded-md border border-zinc-200 p-2 dark:border-zinc-800">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-black uppercase tracking-wide text-zinc-600 dark:text-zinc-300">What changed</span>
        <span className="text-[10px] font-semibold text-zinc-400">{lastCheckedAt ? new Date(lastCheckedAt).toLocaleTimeString() : "Waiting"}</span>
      </div>
      <div className="mt-2 space-y-1.5">
        {insights.length ? insights.map((insight) => (
          <div key={insight.kind} className={`rounded-md px-2 py-1.5 text-[11px] font-bold ${changeInsightClass(insight.kind)}`} title={insight.detail || insight.label}>
            <div className="flex items-center justify-between gap-2">
              <span className="truncate">{changeInsightIcon(insight.kind)} {insight.label}</span>
              <span className="shrink-0 rounded bg-white/60 px-1.5 py-0.5 text-[10px] dark:bg-black/20">{insight.count}</span>
            </div>
            {insight.detail && <div className="mt-0.5 truncate text-[10px] font-semibold opacity-75">{insight.detail}</div>}
          </div>
        )) : (
          <div className="rounded-md bg-zinc-50 px-2 py-1.5 text-[11px] font-semibold text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
            No major changes in the latest refresh.
          </div>
        )}
      </div>
    </div>
  );
}

function CommunityChatPanel({
  open,
  onOpenChange,
  messages,
  unreadCount,
  darkMode,
  displayName,
  onDisplayNameChange,
  onSend,
  onDelete,
  isLoading,
  isSending,
  isDeleting,
  sendError,
  deleteError,
  canModerate
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  messages: ChatMessage[];
  unreadCount: number;
  darkMode: boolean;
  displayName: string;
  onDisplayNameChange: (value: string) => void;
  onSend: (message: string) => Promise<unknown>;
  onDelete: (messageId: string) => Promise<unknown>;
  isLoading: boolean;
  isSending: boolean;
  isDeleting: boolean;
  sendError?: string;
  deleteError?: string;
  canModerate: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const emojiPickerWidth = typeof window !== "undefined" && window.innerWidth < 640
    ? Math.max(280, Math.min(window.innerWidth - 16, 420))
    : 320;

  useEffect(() => {
    if (!open) return;
    const element = listRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [messages, open]);

  useEffect(() => {
    if (!emojiOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!composerRef.current?.contains(event.target as Node)) setEmojiOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [emojiOpen]);

  useEffect(() => {
    if (!open) setEmojiOpen(false);
  }, [open]);

  const submit = async () => {
    const message = draft.trim();
    if (!message || isSending) return;
    await onSend(message);
    setDraft("");
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  const insertEmoji = (emoji: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      setDraft((current) => `${current}${emoji}`);
      setEmojiOpen(false);
      return;
    }
    const start = textarea.selectionStart ?? draft.length;
    const end = textarea.selectionEnd ?? draft.length;
    const nextValue = `${draft.slice(0, start)}${emoji}${draft.slice(end)}`;
    setDraft(nextValue);
    setEmojiOpen(false);
    requestAnimationFrame(() => {
      textarea.focus();
      const position = start + emoji.length;
      textarea.setSelectionRange(position, position);
    });
  };

  return (
    <div className="pointer-events-none fixed bottom-24 left-2 right-2 z-[85] flex w-auto justify-end sm:bottom-20 sm:left-auto sm:right-4 sm:w-full sm:max-w-sm">
      {open && (
        <div className="pointer-events-auto w-full overflow-hidden rounded-md border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-black text-zinc-950 dark:text-white">Community chat</h2>
              <div className="mt-0.5 text-[10px] font-semibold text-zinc-500">
                {formatNumber(messages.filter((message) => !message.deleted).length)} messages
                {unreadCount > 0 ? ` · ${formatNumber(unreadCount)} new` : ""}
              </div>
            </div>
            <button className="btn-press rounded-md border border-zinc-300 p-1.5 dark:border-zinc-700" onClick={() => onOpenChange(false)} type="button" aria-label="Minimize chat">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="p-3">
            <div>
              <label className="text-[10px] font-black uppercase tracking-wide text-zinc-500" htmlFor="chat-display-name">Name</label>
              <input
                id="chat-display-name"
                className="mt-1 h-8 w-full rounded-full border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                maxLength={40}
                placeholder="Anonymous"
                value={displayName}
                onChange={(event) => onDisplayNameChange(event.target.value)}
              />
            </div>
            <div ref={listRef} className="mt-3 max-h-72 space-y-2 overflow-y-auto rounded-md border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-900/60">
              {isLoading && <div className="rounded-md bg-white px-3 py-2 text-sm font-semibold text-zinc-500 dark:bg-zinc-950">Loading chat...</div>}
              {!isLoading && messages.length === 0 && (
                <div className="rounded-md bg-white px-3 py-2 text-sm font-semibold text-zinc-500 dark:bg-zinc-950">
                  No messages yet. Start the room.
                </div>
              )}
              {messages.map((message) => (
                <div key={message.id} className={`rounded-md px-3 py-2 text-sm shadow-sm ${message.isAdmin ? "border border-rose-200 bg-rose-50/80 dark:border-rose-900 dark:bg-rose-950/30" : "bg-white dark:bg-zinc-950"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="inline-flex h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: message.isAdmin ? "#dc2626" : chatIdentityColor(message.viewerId) }}
                          aria-hidden="true"
                        />
                        <div
                          className="truncate text-xs font-black"
                          style={{ color: message.isAdmin ? "#dc2626" : chatIdentityColor(message.viewerId) }}
                        >
                          {chatIdentityLabel(message)}
                        </div>
                        {message.isAdmin && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-1.5 py-0.5 text-[9px] font-black uppercase text-rose-700 dark:bg-rose-950/70 dark:text-rose-300">
                            <Lock className="h-2.5 w-2.5" />
                            Admin
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-[10px] font-semibold text-zinc-500">{new Date(message.createdAt).toLocaleString()}</div>
                    </div>
                    {canModerate && !message.deleted && (
                      <button
                        className="btn-press rounded-md border border-rose-200 px-2 py-1 text-[10px] font-black uppercase text-rose-700 dark:border-rose-900 dark:text-rose-300"
                        onClick={() => void onDelete(message.id)}
                        disabled={isDeleting}
                        type="button"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                  <div className={`mt-2 whitespace-pre-wrap break-words ${message.deleted ? "italic text-zinc-400" : "text-zinc-700 dark:text-zinc-200"}`}>{message.message}</div>
                </div>
              ))}
            </div>
            <div className="mt-3">
              <label className="sr-only" htmlFor="chat-message">Message</label>
              <div ref={composerRef} className="relative">
                {emojiOpen && (
                  <div className="absolute bottom-full left-0 right-0 z-10 mb-2 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950 sm:right-auto">
                    <EmojiPicker
                      onEmojiClick={(emojiData) => insertEmoji(emojiData.emoji)}
                      lazyLoadEmojis
                      searchDisabled={false}
                      skinTonesDisabled={false}
                      previewConfig={{ showPreview: false }}
                      width={emojiPickerWidth}
                      height={380}
                      theme={darkMode ? Theme.DARK : Theme.LIGHT}
                    />
                  </div>
                )}
              <div className="flex items-end gap-2 rounded-full border border-zinc-300 bg-white px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900">
                <button
                  className="btn-press inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                  type="button"
                  title="Open emoji picker"
                  aria-label="Open emoji picker"
                  onClick={() => setEmojiOpen((current) => !current)}
                >
                  <span className="text-lg leading-none">🙂</span>
                </button>
                <textarea
                  id="chat-message"
                  ref={textareaRef}
                  className="max-h-24 min-h-[30px] flex-1 resize-none bg-transparent px-1 py-0.5 text-sm leading-5 outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
                  maxLength={400}
                  placeholder="Type a message"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={handleComposerKeyDown}
                  rows={1}
                />
                <button
                  className="btn-press-dark inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-500 dark:bg-emerald-600 dark:hover:bg-emerald-500 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-600"
                  onClick={() => void submit()}
                  disabled={!draft.trim() || isSending}
                  type="button"
                  title={isSending ? "Sending..." : "Send message"}
                  aria-label={isSending ? "Sending..." : "Send message"}
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
              </div>
              </div>
              <div className="mt-1 px-1 text-[10px] font-semibold text-zinc-500">Anonymous if name is blank.</div>
            </div>
            {(sendError || deleteError) && <div className="mt-2 text-xs text-rose-600">{sendError || deleteError}</div>}
          </div>
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
  const selectAllRef = useRef<HTMLInputElement | null>(null);
  const selected = new Set(selectedIds);
  const allSelected = options.length > 0 && selectedIds.length === options.length;
  const someSelected = selectedIds.length > 0 && !allSelected;
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

  useEffect(() => {
    if (!selectAllRef.current) return;
    selectAllRef.current.indeterminate = someSelected;
  }, [someSelected]);

  const toggleAll = () => {
    onChange(allSelected ? [] : options.map((option) => option.constituencyId));
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
        <div className="flex items-center gap-1.5">
          {selectedIds.length > 0 && (
            <button
              className="btn-press rounded-md border border-red-200 p-1.5 text-red-600 transition hover:border-red-300 hover:bg-red-50 hover:text-red-700 active:scale-[0.98] dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/40"
              onClick={() => onChange([])}
              title="Clear selected constituencies"
              aria-label="Clear selected constituencies"
              type="button"
            >
              <Eraser className="h-4 w-4" />
            </button>
          )}
          <button
            className="btn-press rounded-md border border-amber-200 p-1.5 text-amber-600 transition hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700 active:scale-[0.98] dark:border-amber-900/60 dark:text-amber-400 dark:hover:bg-amber-950/40"
            onClick={() => onChange(favorites.map((item) => item.constituencyId))}
            title="Use favorite constituencies"
            aria-label="Use favorite constituencies"
            type="button"
          >
            <Star className="h-4 w-4" />
          </button>
          <button
            className="btn-press rounded-md border border-zinc-300 p-1.5 text-zinc-700 transition hover:bg-zinc-100 active:scale-[0.98] dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
            onClick={() => onCollapsedChange(true)}
            title="Collapse constituencies"
            aria-label="Collapse constituencies"
            type="button"
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
            <div className="mt-3 flex max-h-32 flex-wrap gap-1 overflow-y-auto rounded-md border border-zinc-200 p-2 pr-1 dark:border-zinc-800">
              {selectedOptions.map((option) => (
                <button
                  key={option.constituencyId}
                  className="inline-flex items-center rounded-md bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100"
                  onClick={() => toggle(option.constituencyId)}
                  title={`Remove ${option.constituencyName}`}
                >
                  <span className="truncate">{option.constituencyName}</span>
                  <X className="ml-1 h-3 w-3" />
                </button>
              ))}
            </div>
          )}
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
            <input
              className="w-full rounded-md border border-zinc-300 bg-white py-2 pl-9 pr-3 text-base dark:border-zinc-700 dark:bg-zinc-900 sm:text-sm"
              placeholder="Search constituency"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          {!isLoading && options.length > 0 && (
            <button
              className="mt-3 flex w-full items-center justify-between rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-left transition hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900/60 dark:hover:bg-zinc-900"
              onClick={toggleAll}
              type="button"
              aria-pressed={allSelected}
              title={allSelected ? "Unselect all constituencies" : "Select all constituencies"}
            >
              <span className="flex items-center gap-3">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allSelected}
                  onClick={(event) => event.stopPropagation()}
                  onChange={toggleAll}
                  className="h-4 w-4 accent-emerald-700"
                />
                <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                  {allSelected ? "Unselect all constituencies" : "Select all constituencies"}
                </span>
              </span>
              <span className="text-xs font-bold text-zinc-500">
                {selectedIds.length}/{options.length}
              </span>
            </button>
          )}
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
  activeProfileId,
  onUpdated
}: {
  sourceConfig?: PublicSourceConfig;
  activeProfileId: string;
  onUpdated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState(() => sessionStorage.getItem("kerala-election:admin-password") ?? "");
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem("kerala-election:admin-password") === ADMIN_PASSWORD);
  const [baseUrl, setBaseUrl] = useState(sourceConfig?.baseUrl ?? "");
  const [constituencyListUrl, setConstituencyListUrl] = useState(sourceConfig?.constituencyListUrl ?? "");
  const [candidateDetailUrlTemplate, setCandidateDetailUrlTemplate] = useState(sourceConfig?.candidateDetailUrlTemplate ?? "");
  const [refreshIntervalSeconds, setRefreshIntervalSeconds] = useState(String(sourceConfig?.refreshIntervalSeconds ?? 30));
  const [hidePreviewBanner, setHidePreviewBanner] = useState(sourceConfig?.hidePreviewBanner ?? false);
  const [hideCountdown, setHideCountdown] = useState(sourceConfig?.hideCountdown ?? false);

  useEffect(() => {
    if (!sourceConfig) return;
    setBaseUrl(sourceConfig.baseUrl);
    setConstituencyListUrl(sourceConfig.constituencyListUrl);
    setCandidateDetailUrlTemplate(sourceConfig.candidateDetailUrlTemplate);
    setRefreshIntervalSeconds(String(sourceConfig.refreshIntervalSeconds));
    setHidePreviewBanner(sourceConfig.hidePreviewBanner ?? false);
    setHideCountdown(sourceConfig.hideCountdown ?? false);
  }, [sourceConfig]);

  const mutation = useMutation({
    mutationFn: () =>
      updateSourceConfig(password, {
        baseUrl,
        constituencyListUrl,
        candidateDetailUrlTemplate,
        refreshIntervalSeconds: Number(refreshIntervalSeconds),
        hidePreviewBanner,
        hideCountdown
      }),
    onSuccess: () => {
      sessionStorage.setItem("kerala-election:admin-password", password);
      onUpdated();
    }
  });
  const discoveryStatusQuery = useQuery({
    queryKey: ["source-discovery-status"],
    queryFn: () => fetchDiscoveryStatus(password),
    enabled: open && unlocked,
    refetchInterval: open && unlocked ? 2_000 : false
  });
  const sourceDiagnosticsQuery = useQuery({
    queryKey: ["source-diagnostics", activeProfileId],
    queryFn: () => fetchSourceDiagnostics(password, activeProfileId),
    enabled: open && unlocked,
    refetchInterval: open && unlocked ? 60_000 : false
  });
  const discoveryRunMutation = useMutation({
    mutationFn: () => runSourceDiscovery(password),
    onSuccess: () => {
      void discoveryStatusQuery.refetch();
    }
  });
  const discoveryApplyMutation = useMutation({
    mutationFn: () => applyDiscoveredSource(password),
    onSuccess: () => {
      onUpdated();
      void discoveryStatusQuery.refetch();
    }
  });
  const discoveryScheduleMutation = useMutation({
    mutationFn: (enabled: boolean) => updateDiscoverySchedule(password, enabled),
    onSuccess: () => {
      void discoveryStatusQuery.refetch();
    }
  });
  const revertMutation = useMutation({
    mutationFn: () => revertSourceConfig(password),
    onSuccess: () => {
      onUpdated();
      void discoveryStatusQuery.refetch();
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
  const applyElectionDayMode = () => {
    setRefreshIntervalSeconds("10");
  };

  return (
    <div className="panel rounded-md p-4">
      <button className="flex w-full items-center justify-between text-left font-bold" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span><Settings className="mr-2 inline h-4 w-4" /> Admin settings</span>
        <Lock className="h-4 w-4 text-zinc-500" />
      </button>
      <p className="mt-2 text-xs leading-5 text-zinc-500">
        Locked controls for source URLs and refresh timing.
      </p>
      {open && (
        <div className="mt-4 space-y-3">
          {!unlocked && (
            <>
              <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500" htmlFor="admin-unlock-password">Admin password</label>
              <input
                id="admin-unlock-password"
                type="password"
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-base dark:border-zinc-700 dark:bg-zinc-900 sm:text-sm"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <button
                className="btn-press-dark w-full rounded-md bg-zinc-950 px-3 py-2 text-sm font-semibold text-white dark:border dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                onClick={() => {
                  if (password !== ADMIN_PASSWORD) {
                    sessionStorage.removeItem("kerala-election:admin-password");
                    return;
                  }
                  sessionStorage.setItem("kerala-election:admin-password", password);
                  setUnlocked(true);
                }}
                type="button"
              >
                Unlock admin settings
              </button>
              {password && password !== ADMIN_PASSWORD && <p className="text-sm text-red-600">Invalid admin password.</p>}
            </>
          )}
          {unlocked && (
            <>
          {!sourceConfig && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs font-semibold text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
              Loading saved source settings from backend...
            </div>
          )}
          <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500" htmlFor="base-url">Base URL</label>
          <input
            id="base-url"
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-base dark:border-zinc-700 dark:bg-zinc-900 sm:text-sm"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
          />
          <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500" htmlFor="list-url">Constituency list URL</label>
          <input
            id="list-url"
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-base dark:border-zinc-700 dark:bg-zinc-900 sm:text-sm"
            value={constituencyListUrl}
            onChange={(event) => setConstituencyListUrl(event.target.value)}
          />
          <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500" htmlFor="detail-url">Candidate detail URL template</label>
          <input
            id="detail-url"
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-base dark:border-zinc-700 dark:bg-zinc-900 sm:text-sm"
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
          <button
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm font-semibold text-zinc-700 dark:border-zinc-700 dark:text-zinc-200"
            onClick={applyElectionDayMode}
            type="button"
            title="Sets frontend refresh to 10 seconds. Save to apply."
          >
            Election day mode
          </button>
          <SourceDiscoveryAdmin
            status={discoveryStatusQuery.data}
            isLoading={discoveryStatusQuery.isLoading || discoveryRunMutation.isPending}
            isApplying={discoveryApplyMutation.isPending}
            error={
              discoveryRunMutation.error instanceof Error
                ? discoveryRunMutation.error.message
                : discoveryApplyMutation.error instanceof Error
                  ? discoveryApplyMutation.error.message
                  : discoveryScheduleMutation.error instanceof Error
                    ? discoveryScheduleMutation.error.message
                    : revertMutation.error instanceof Error
                      ? revertMutation.error.message
                    : discoveryStatusQuery.error instanceof Error
                      ? discoveryStatusQuery.error.message
                      : undefined
            }
            onRun={() => discoveryRunMutation.mutate()}
            onApply={() => discoveryApplyMutation.mutate()}
            onRevert={() => revertMutation.mutate()}
            onScheduleChange={(enabled) => discoveryScheduleMutation.mutate(enabled)}
          />
          <DeploymentReadinessPanel
            diagnostics={sourceDiagnosticsQuery.data}
            isLoading={sourceDiagnosticsQuery.isFetching}
            error={sourceDiagnosticsQuery.error instanceof Error ? sourceDiagnosticsQuery.error.message : undefined}
            onRun={() => void sourceDiagnosticsQuery.refetch()}
          />
          <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500" htmlFor="refresh-seconds">Refresh seconds</label>
          <input
            id="refresh-seconds"
            type="number"
            min={5}
            max={300}
            step={1}
            inputMode="numeric"
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-base dark:border-zinc-700 dark:bg-zinc-900 sm:text-sm"
            value={refreshIntervalSeconds}
            onChange={(event) => setRefreshIntervalSeconds(event.target.value.replace(/\D/g, ""))}
          />
          <div className="grid gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
            <label className="flex items-start gap-3 text-sm text-zinc-700 dark:text-zinc-200">
              <input
                type="checkbox"
                checked={hideCountdown}
                onChange={(event) => setHideCountdown(event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded accent-emerald-700"
              />
              <span>
                <span className="block font-semibold">Hide top-right countdown</span>
                <span className="block text-xs text-zinc-500 dark:text-zinc-400">Turns off the pre-election countdown badge until counting day.</span>
              </span>
            </label>
            <label className="flex items-start gap-3 text-sm text-zinc-700 dark:text-zinc-200">
              <input
                type="checkbox"
                checked={hidePreviewBanner}
                onChange={(event) => setHidePreviewBanner(event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded accent-emerald-700"
              />
              <span>
                <span className="block font-semibold">Hide top scrolling banner</span>
                <span className="block text-xs text-zinc-500 dark:text-zinc-400">Turns off the pre-election old-results notice banner.</span>
              </span>
            </label>
          </div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-zinc-500" htmlFor="admin-password">Admin password</label>
          <input
            id="admin-password"
            type="password"
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-base dark:border-zinc-700 dark:bg-zinc-900 sm:text-sm"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <button
            className="w-full rounded-md bg-zinc-950 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 dark:border dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
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
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SourceDiscoveryAdmin({
  status,
  isLoading,
  isApplying,
  error,
  onRun,
  onApply,
  onRevert,
  onScheduleChange
}: {
  status?: DiscoveredSource;
  isLoading: boolean;
  isApplying: boolean;
  error?: string;
  onRun: () => void;
  onApply: () => void;
  onRevert: () => void;
  onScheduleChange: (enabled: boolean) => void;
}) {
  const canApply = Boolean(status?.constituencyListUrl && status?.candidateDetailUrlTemplate && status.confidence >= 60);
  const schedule = status?.schedule;
  const [trailOpen, setTrailOpen] = useState(false);
  const runWithTrail = () => {
    setTrailOpen(true);
    onRun();
  };
  return (
    <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-xs font-black uppercase tracking-wide text-zinc-600 dark:text-zinc-300">ECI auto discovery</div>
          <div className="mt-1 text-[11px] font-semibold leading-4 text-zinc-500">
            Scheduled: May 4, 2026, 5:30-7:00 AM IST. Fast checks from 5:55 AM.
          </div>
        </div>
        <span className={`rounded-md px-2 py-1 text-[10px] font-black uppercase ${schedule?.activeNow ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100" : schedule?.enabled ? "bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300" : "bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-100"}`}>
          {schedule?.activeNow ? "Active" : schedule?.enabled ? "On" : "Off"}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-[1fr_auto] items-center gap-2 rounded-md bg-zinc-50 px-2 py-2 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
        <div>
          <div>Backend discovery service: {schedule?.enabled ? "On" : "Off"}</div>
          <div className="mt-0.5">
            {schedule?.activeNow
              ? `Running now; interval ${schedule.intenseIntervalSeconds}s near counting start.`
              : schedule?.nextRunAt
                ? `Next scheduled check: ${new Date(schedule.nextRunAt).toLocaleString()}`
                : "No upcoming scheduled check in the active window."}
          </div>
        </div>
        <button
          className={`rounded-md px-2 py-1 text-[10px] font-black ${schedule?.enabled ? "bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-100" : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100"}`}
          onClick={() => onScheduleChange(!schedule?.enabled)}
          type="button"
        >
          {schedule?.enabled ? "Turn off" : "Turn on"}
        </button>
      </div>
      <div className="mt-2 text-[11px] leading-4 text-zinc-500">
        {status?.message ?? "Backend discovery will scan official ECI result links, build available assembly profiles, and validate candidate pages before applying."}
      </div>
      {status?.checkedAt && <div className="mt-1 text-[10px] font-semibold text-zinc-500">Last check {new Date(status.checkedAt).toLocaleString()} · Confidence {status.confidence}%</div>}
      {status?.constituencyListUrl && (
        <div className="mt-2 truncate text-[10px] text-zinc-500" title={status.constituencyListUrl}>
          Found: {status.constituencyCount ?? 0} seats · {status.sampleVerified ? "details verified" : "details pending"}
        </div>
      )}
      {status?.checkedAt && (
        <div className="mt-2 grid grid-cols-3 gap-1">
          {[
            ["Kerala page", Boolean(status.constituencyListUrl)],
            ["Detail URL", Boolean(status.candidateDetailUrlTemplate)],
            ["Samples", Boolean(status.sampleVerified)]
          ].map(([label, ok]) => (
            <div key={String(label)} className={`rounded-md px-2 py-1 text-center text-[10px] font-black ${ok ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400"}`}>
              {ok ? "OK" : "Wait"} · {label}
            </div>
          ))}
        </div>
      )}
      {status?.status === "applied" && (
        <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 p-2 text-[10px] leading-4 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">
          <div className="font-black uppercase tracking-wide">Auto-apply report</div>
          <div>Applied: {status.appliedAt ? new Date(status.appliedAt).toLocaleString() : "-"}</div>
          <div>Confidence: {status.confidence}% · Seats: {status.constituencyCount ?? 0} · Detail check: {status.sampleVerified ? "passed" : "not verified"}</div>
          <div className="mt-1 truncate" title={status.constituencyListUrl}>List: {status.constituencyListUrl}</div>
          <div className="truncate" title={status.candidateDetailUrlTemplate}>Detail: {status.candidateDetailUrlTemplate}</div>
          {status.partySummaryUrl && <div className="truncate" title={status.partySummaryUrl}>Summary: {status.partySummaryUrl}</div>}
        </div>
      )}
      {status?.warnings?.length ? <div className="mt-1 text-[10px] text-amber-700 dark:text-amber-300">{status.warnings[0]}</div> : null}
      {error && <div className="mt-1 text-xs text-red-600">{error}</div>}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <button className="btn-press rounded-md border border-zinc-300 px-2 py-1.5 text-xs font-black dark:border-zinc-700" onClick={runWithTrail} disabled={isLoading} type="button">
          {isLoading ? "Checking..." : "Auto discover"}
        </button>
        <button className="btn-press-dark rounded-md bg-zinc-950 px-2 py-1.5 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-50 dark:border dark:border-zinc-700 dark:bg-zinc-900" onClick={onApply} disabled={!canApply || isApplying} type="button">
          {isApplying ? "Applying..." : "Apply found"}
        </button>
        <button className="btn-press rounded-md border border-zinc-300 px-2 py-1.5 text-xs font-black disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700" onClick={onRevert} disabled={!status?.previousAvailable} type="button">
          Revert
        </button>
      </div>
      {trailOpen && (
        <DiscoveryTrailDialog
          status={status}
          isLoading={isLoading}
          isApplying={isApplying}
          canApply={canApply}
          onApply={onApply}
          onClose={() => setTrailOpen(false)}
        />
      )}
    </div>
  );
}

function DiscoveryTrailDialog({
  status,
  isLoading,
  isApplying,
  canApply,
  onApply,
  onClose
}: {
  status?: DiscoveredSource;
  isLoading: boolean;
  isApplying: boolean;
  canApply: boolean;
  onApply: () => void;
  onClose: () => void;
}) {
  const trail = status?.trail ?? [];
  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <div
        className="max-h-[86vh] w-full max-w-2xl overflow-hidden rounded-md border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div>
            <div className="text-sm font-black">ECI auto discovery progress</div>
            <div className="mt-1 text-xs text-zinc-500">{status?.message ?? "Waiting for discovery to start..."}</div>
          </div>
          <button className="btn-press rounded-md border border-zinc-300 p-2 dark:border-zinc-700" type="button" onClick={onClose} aria-label="Close discovery progress">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[56vh] space-y-2 overflow-y-auto p-4">
          {trail.length === 0 && (
            <div className="rounded-md bg-zinc-50 p-3 text-xs font-semibold text-zinc-500 dark:bg-zinc-900">
              Starting discovery trail...
            </div>
          )}
          {trail.map((item, index) => (
            <div key={`${item.time}-${index}`} className="rounded-md border border-zinc-200 p-3 text-xs dark:border-zinc-800">
              <div className="flex items-center justify-between gap-2">
                <span className={`font-black ${item.status === "success" ? "text-emerald-700 dark:text-emerald-300" : item.status === "error" ? "text-red-700 dark:text-red-300" : item.status === "warning" ? "text-amber-700 dark:text-amber-300" : "text-zinc-700 dark:text-zinc-200"}`}>
                  {item.status === "success" ? "OK" : item.status === "error" ? "Issue" : item.status === "warning" ? "Check" : "Doing"}
                </span>
                <span className="text-[10px] font-semibold text-zinc-400">{new Date(item.time).toLocaleTimeString()}</span>
              </div>
              <div className="mt-1 font-semibold text-zinc-700 dark:text-zinc-200">{item.message}</div>
              {item.details?.length ? (
                <div className="mt-2 space-y-1">
                  {item.details.slice(0, 6).map((detail) => (
                    <div key={detail} className="truncate rounded bg-zinc-50 px-2 py-1 text-[10px] text-zinc-500 dark:bg-zinc-900" title={detail}>{detail}</div>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
          {status?.profiles?.length ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100">
              <div className="font-black">Profiles found</div>
              <div className="mt-2 space-y-2">
                {status.profiles.map((profile, index) => (
                  <div key={profile.profileId} className="rounded-md bg-white/70 p-2 dark:bg-zinc-950/60">
                    <div className="font-black">{index + 1}. {profile.electionTitle}</div>
                    <div className="mt-1 truncate" title={profile.constituencyListUrl}>Constituencies: {profile.constituencyListUrl}</div>
                    <div className="truncate" title={profile.candidateDetailUrlTemplate}>Candidates: {profile.candidateDetailUrlTemplate}</div>
                    {profile.partySummaryUrl && <div className="truncate" title={profile.partySummaryUrl}>Summary: {profile.partySummaryUrl}</div>}
                    <div className="mt-1">Seats {profile.constituencyCount} · Confidence {profile.confidence}% · {profile.sampleVerified ? "verified" : "needs review"}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <button className="btn-press rounded-md border border-zinc-300 px-3 py-2 text-xs font-black dark:border-zinc-700" type="button" onClick={onClose}>
            Close
          </button>
          <button className="btn-press-dark rounded-md bg-zinc-950 px-3 py-2 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-50 dark:border dark:border-zinc-700 dark:bg-zinc-900" type="button" onClick={onApply} disabled={!canApply || isApplying || isLoading}>
            {isApplying ? "Applying..." : "Apply changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DeploymentReadinessPanel({
  diagnostics,
  isLoading,
  error,
  onRun
}: {
  diagnostics?: SourceDiagnosticsResponse;
  isLoading: boolean;
  error?: string;
  onRun: () => void;
}) {
  const checks = [
    { label: "Seats", value: diagnostics?.constituencyCount ?? 0, ok: Boolean((diagnostics?.constituencyCount ?? 0) > 0) },
    { label: "Details", value: diagnostics?.sampleDetailCount ?? 0, ok: Boolean((diagnostics?.sampleDetailCount ?? 0) > 0) },
    { label: "Candidates", value: diagnostics?.sampleCandidateCount ?? 0, ok: Boolean((diagnostics?.sampleCandidateCount ?? 0) > 0) },
    { label: "Parties", value: diagnostics?.partySummaryCount ?? 0, ok: Boolean((diagnostics?.partySummaryCount ?? 0) > 0) }
  ];
  return (
    <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-xs font-black uppercase tracking-wide text-zinc-600 dark:text-zinc-300">Deployment readiness</div>
          <div className="mt-1 text-[11px] font-semibold text-zinc-500">
            API {apiBaseForDiagnostics()} · TTL {diagnostics?.cacheTtlSeconds ?? "-"}s · Uptime {diagnostics ? formatDuration(diagnostics.uptimeSeconds) : "-"}
          </div>
        </div>
        <button className="btn-press rounded-md border border-zinc-300 px-2 py-1.5 text-xs font-black dark:border-zinc-700" onClick={onRun} disabled={isLoading} type="button">
          {isLoading ? "Testing..." : "Test source"}
        </button>
      </div>
      <div className="mt-2 grid grid-cols-4 gap-1">
        {checks.map((check) => (
          <div key={check.label} className={`rounded-md px-2 py-1 text-center text-[10px] font-black ${check.ok ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400"}`}>
            <div>{formatNumber(check.value)}</div>
            <div className="font-semibold">{check.label}</div>
          </div>
        ))}
      </div>
      {diagnostics?.errors?.length ? <div className="mt-2 truncate text-[10px] text-amber-700 dark:text-amber-300" title={diagnostics.errors[0].message}>{diagnostics.errors[0].message}</div> : null}
      {error && <div className="mt-2 text-xs text-red-600">{error}</div>}
    </div>
  );
}

function PartySummaryDock({
  parties,
  checkedAt,
  traffic,
  chatOpen,
  chatUnreadCount,
  onChatClick,
  onShare,
  onPartyClick
}: {
  parties: { party: string; won: number; leading: number; total: number; color?: string }[];
  checkedAt?: number;
  traffic?: { watchingNow: number; totalViews: number };
  chatOpen?: boolean;
  chatUnreadCount?: number;
  onChatClick?: () => void;
  onShare?: () => void;
  onPartyClick?: (party: string) => void;
}) {
  const previousTotals = useRef<Record<string, number>>({});
  const visibleParties = parties.slice(0, 8);
  const totalSeats = parties.reduce((sum, party) => sum + party.total, 0);
  const deltas = Object.fromEntries(parties.map((party) => [party.party, party.total - (previousTotals.current[party.party] ?? party.total)]));
  useEffect(() => {
    previousTotals.current = Object.fromEntries(parties.map((party) => [party.party, party.total]));
  }, [parties]);
  if (!parties.length && !traffic) return null;

  return (
    <div key={checkedAt ?? 0} className="animate-summary-wave-refresh animate-refresh-wave fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200 bg-white/95 shadow-[0_-12px_30px_rgba(15,23,42,0.12)] backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
      <div className="mx-auto flex max-w-7xl items-center gap-3 overflow-x-auto px-4 py-2 pr-28 sm:px-6 sm:pr-32 lg:px-8">
        {parties.length > 0 && (
          <div className="shrink-0 pr-2">
            <div className="flex items-center gap-1">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Seats</div>
              {onShare && (
                <button
                  className="btn-press inline-flex h-5 w-5 items-center justify-center rounded-md border border-zinc-300 text-zinc-500 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-400 dark:hover:text-white"
                  onClick={onShare}
                  title="Share party summary"
                  aria-label="Share party summary"
                  type="button"
                >
                  <Share2 className="h-3 w-3" />
                </button>
              )}
            </div>
            <div className="text-sm font-black text-zinc-950 dark:text-white">{formatNumber(totalSeats)}</div>
          </div>
        )}
        {visibleParties.map((party) => (
          <button
            key={`${party.party}-${checkedAt ?? 0}`}
            className="animate-party-card-refresh flex min-w-36 shrink-0 items-center gap-3 rounded-md border border-black/10 px-3 py-2 text-left text-white shadow-sm"
            style={{ backgroundColor: party.color ?? "#71717a" }}
            onClick={() => onPartyClick?.(party.party)}
            type="button"
          >
            <div className="text-3xl font-black leading-none">{formatNumber(party.total)}</div>
            <div className="min-w-0">
              <div className="max-w-28 truncate text-xs font-black" title={party.party}>{shortPartyName(party.party)}</div>
              <div className="mt-1 flex gap-2 text-[10px] font-bold text-white/90">
                <span>Won {party.won}</span>
                <span>Lead {party.leading}</span>
                {deltas[party.party] !== 0 && <span>{deltas[party.party] > 0 ? "+" : ""}{deltas[party.party]}</span>}
              </div>
            </div>
          </button>
        ))}
      </div>
      {traffic && (
        <div className="absolute bottom-2 right-3 flex items-center gap-1.5 rounded-md border border-zinc-200/60 bg-white/65 px-1.5 py-0.5 text-zinc-600 shadow-[0_4px_18px_rgba(15,23,42,0.08)] backdrop-blur-sm dark:border-zinc-700/50 dark:bg-zinc-950/55 dark:text-zinc-300">
          <button
            className={`btn-press relative inline-flex h-6 w-6 items-center justify-center rounded-full border p-0 transition ${chatOpen ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300" : "border-zinc-300 bg-white text-zinc-700 hover:border-emerald-300 hover:text-emerald-700 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:border-emerald-800 dark:hover:text-emerald-300"}`}
            onClick={onChatClick}
            title="Open community chat"
            aria-label="Open community chat"
            type="button"
          >
            <MessageCircle className="h-3 w-3" />
            {(chatUnreadCount ?? 0) > 0 && (
              <span className="absolute -right-1 -top-1 min-w-[1rem] rounded-full bg-rose-500 px-1 text-[9px] font-black leading-4 text-white">
                {(chatUnreadCount ?? 0) > 9 ? "9+" : chatUnreadCount}
              </span>
            )}
          </button>
          <span className="inline-flex items-center gap-0.5 text-[11px] font-black" title="Watching now">
            <Users className="h-3 w-3 text-emerald-700 dark:text-emerald-300" />
            {formatNumber(traffic.watchingNow)}
          </span>
          <span className="inline-flex items-center gap-0.5 text-[11px] font-black" title="Total views">
            <Eye className="h-3 w-3 text-sky-700 dark:text-sky-300" />
            {formatNumber(traffic.totalViews)}
          </span>
        </div>
      )}
    </div>
  );
}

function PartyConstituencyModal({
  party,
  summaries,
  candidatePhotoLookup,
  suppressImage = false,
  onClose
}: {
  party: string;
  summaries: ConstituencySummary[];
  candidatePhotoLookup: Map<string, string>;
  suppressImage?: boolean;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-md border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div className="min-w-0">
            <div className="text-[10px] font-black uppercase tracking-wide text-zinc-500">Party seats</div>
            <div className="mt-1 text-xl font-black text-zinc-950 dark:text-white">{party}</div>
            <div className="mt-1 text-xs font-semibold text-zinc-500">{formatNumber(summaries.length)} constituencies currently leading or won</div>
          </div>
          <button className="btn-press rounded-md border border-zinc-300 p-2 dark:border-zinc-700" type="button" onClick={onClose} aria-label="Close party constituencies">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {summaries.length === 0 ? (
            <div className="rounded-md border border-dashed border-zinc-300 p-8 text-center text-sm font-semibold text-zinc-500 dark:border-zinc-700">
              No constituencies available for this party yet.
            </div>
          ) : (
            <div className="grid gap-2">
              {summaries.map((summary) => {
                const declared = isDeclaredWinner(summary.statusText || summary.roundStatus);
                const photoUrl = candidatePhotoLookup.get(`${summary.constituencyId}:${normalizeCandidateName(summary.leadingCandidate)}`);
                return (
                  <div key={summary.constituencyId} className="rounded-md border border-zinc-200 px-3 py-3 dark:border-zinc-800">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex min-w-0 items-start gap-3">
                        <CandidatePhoto
                          candidateName={summary.leadingCandidate || "-"}
                          photoUrl={photoUrl}
                          size="small"
                          tone="leading"
                          crowned={declared}
                          suppressImage={suppressImage}
                        />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-black text-zinc-950 dark:text-white">
                            {summary.constituencyName}
                            <span className="ml-0 block text-xs font-semibold text-zinc-500 sm:ml-2 sm:inline">AC {summary.constituencyNumber}</span>
                          </div>
                          <div className="mt-1 truncate text-sm font-bold text-zinc-700 dark:text-zinc-200">
                            {summary.leadingCandidate || "-"}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-3 sm:block sm:shrink-0 sm:text-right">
                        <span className={`inline-flex shrink-0 rounded-md px-2 py-1 text-[10px] font-black uppercase ${declared ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100" : "bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-100"}`}>
                          {declared ? "Won" : "Leading"}
                        </span>
                        <div className="flex min-w-0 items-baseline justify-end gap-2 sm:mt-2">
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Margin</div>
                          <div className="truncate text-lg font-black text-emerald-700 dark:text-emerald-300">
                            {formatNumber(summary.margin || 0)}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AssemblyVictoryOverlay({
  outcome,
  onShare,
  onClose
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
  onShare: () => void;
  onClose: () => void;
}) {
  const winnerColor = outcome.winner.color ?? "#166534";
  const winnerShort = shortPartyName(outcome.winner.party);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[160] bg-black/70 backdrop-blur-md" onMouseDown={onClose}>
      <div className="flex min-h-screen items-center justify-center p-4 sm:p-6" onMouseDown={(event) => event.stopPropagation()}>
        <div className="relative w-full max-w-5xl overflow-hidden rounded-md border border-white/15 bg-zinc-950 text-white shadow-2xl">
          <div className="absolute inset-0 opacity-20" style={{ background: `radial-gradient(circle at top, ${winnerColor}, transparent 55%)` }} />
          <div className="absolute left-8 top-8 h-32 w-32 rounded-full bg-amber-300/20 blur-3xl" />
          <div className="absolute right-8 top-12 h-28 w-28 rounded-full bg-emerald-400/20 blur-3xl" />
          <button
            className="btn-press absolute right-14 top-4 z-10 rounded-full border border-white/20 bg-black/20 p-2 text-white hover:bg-white/10"
            onClick={onShare}
            aria-label="Share victory card"
            type="button"
          >
            <Share2 className="h-4 w-4" />
          </button>
          <button
            className="btn-press absolute right-4 top-4 z-10 rounded-full border border-white/20 bg-black/20 p-2 text-white hover:bg-white/10"
            onClick={onClose}
            aria-label="Close victory announcement"
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="relative p-6 sm:p-8">
            <div className="flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="text-[11px] font-black uppercase tracking-[0.24em] text-amber-300">Result Declared</div>
                <div className="mt-3 flex items-center gap-3">
                  <div className="relative">
                    <div className="absolute inset-0 animate-ping rounded-full bg-amber-300/30" />
                    <div className="relative rounded-full bg-amber-300 p-3 text-amber-950 shadow-lg">
                      <Crown className="h-8 w-8 fill-current" />
                    </div>
                  </div>
                  <div>
                    <div className="text-sm font-semibold uppercase tracking-wide text-zinc-300">{outcome.electionTitle}</div>
                    <div className="text-xs font-semibold text-zinc-400">All constituencies declared</div>
                  </div>
                </div>
                <div className="mt-8 text-5xl font-black leading-none sm:text-7xl" style={{ color: winnerColor }}>
                  {winnerShort}
                </div>
                <div className="mt-3 text-xl font-bold text-white sm:text-2xl">{outcome.winner.party}</div>
                <div className="mt-4 flex flex-wrap items-center gap-3 text-sm font-semibold text-zinc-300">
                  <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1">Wins {formatNumber(outcome.winner.won)} seats</span>
                  <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1">Leads/Wins total {formatNumber(outcome.winner.total)}</span>
                  <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1">Majority mark {formatNumber(outcome.majorityMark)}</span>
                </div>
              </div>
              <div className="grid w-full max-w-xl grid-cols-2 gap-3">
                <VictoryFactCard label="Winning Seats" value={formatNumber(outcome.winner.total)} accent={winnerColor} />
                <VictoryFactCard label="Seat Lead" value={formatNumber(outcome.seatLead)} accent="#f59e0b" />
                <VictoryFactCard
                  label="Runner-up"
                  value={outcome.runnerUp ? shortPartyName(outcome.runnerUp.party) : "-"}
                  sub={outcome.runnerUp ? `${formatNumber(outcome.runnerUp.total)} seats` : "No runner-up data"}
                />
                <VictoryFactCard label="Assembly Size" value={formatNumber(outcome.totalSeats)} />
              </div>
            </div>
            <div className="mt-8 grid gap-3 lg:grid-cols-3">
              <VictoryStoryCard
                title="Closest Result"
                value={outcome.closest?.constituencyName ?? "-"}
                sub={outcome.closest ? `${shortPartyName(outcome.closest.leadingParty)} by ${formatNumber(outcome.closest.margin)}` : "No margin data"}
              />
              <VictoryStoryCard
                title="Biggest Winning Margin"
                value={outcome.biggest?.constituencyName ?? "-"}
                sub={outcome.biggest ? `${shortPartyName(outcome.biggest.leadingParty)} by ${formatNumber(outcome.biggest.margin)}` : "No margin data"}
              />
              <VictoryStoryCard
                title="Runner-up Gap"
                value={formatNumber(outcome.seatLead)}
                sub={outcome.runnerUp ? `${winnerShort} ahead of ${shortPartyName(outcome.runnerUp.party)}` : "Single-party finish"}
              />
            </div>
            <div className="mt-8 flex justify-end">
              <button className="btn-press-dark rounded-md bg-white px-4 py-2 text-sm font-black text-zinc-950" onClick={onClose} type="button">
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function VictoryFactCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/5 p-4">
      <div className="text-[10px] font-black uppercase tracking-wide text-zinc-400">{label}</div>
      <div className="mt-2 text-3xl font-black" style={accent ? { color: accent } : undefined}>{value}</div>
      {sub ? <div className="mt-1 text-xs font-semibold text-zinc-400">{sub}</div> : null}
    </div>
  );
}

function VictoryStoryCard({ title, value, sub }: { title: string; value: string; sub: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-black/20 p-4">
      <div className="text-[10px] font-black uppercase tracking-wide text-zinc-400">{title}</div>
      <div className="mt-2 truncate text-lg font-black text-white">{value}</div>
      <div className="mt-1 text-sm font-semibold text-zinc-300">{sub}</div>
    </div>
  );
}

function BattlegroundStrip({
  races,
  selectedIds,
  leaderChanges,
  candidatePhotoLookup,
  onAdd,
  onShare,
  onOpenAll,
  onDismiss
}: {
  races: ConstituencySummary[];
  selectedIds: string[];
  leaderChanges: ConstituencyResult[];
  candidatePhotoLookup: Map<string, string>;
  onAdd: (summary: ConstituencySummary) => void;
  onShare: (summary: ConstituencySummary) => void;
  onOpenAll: () => void;
  onDismiss: () => void;
}) {
  const changed = useMemo(() => new Set(leaderChanges.map((item) => item.constituencyId)), [leaderChanges]);
  return (
    <section className="animate-refresh-wave relative mb-5 rounded-md border border-amber-200 bg-gradient-to-r from-amber-50 via-white to-rose-50 p-4 dark:border-amber-900 dark:from-amber-950/40 dark:via-zinc-950 dark:to-rose-950/30">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-[11px] font-black uppercase tracking-[0.22em] text-amber-700 dark:text-amber-300">Battleground Races</div>
          <div className="mt-1 text-sm font-semibold text-zinc-600 dark:text-zinc-300">Closest contests updated live</div>
        </div>
        <div className="flex items-center gap-2 self-start">
          <button
            className="btn-press inline-flex items-center gap-2 rounded-md border border-amber-300 px-3 py-2 text-sm font-semibold text-amber-900 transition hover:bg-amber-100 dark:border-amber-800 dark:text-amber-100 dark:hover:bg-amber-950/60"
            onClick={onOpenAll}
            type="button"
          >
            View all battleground seats
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            className="btn-press inline-flex h-9 w-9 items-center justify-center rounded-md border border-amber-300 text-amber-900 dark:border-amber-800 dark:text-amber-100"
            onClick={onDismiss}
            type="button"
            title="Hide battleground races"
            aria-label="Hide battleground races"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {races.map((summary) => {
          const selected = selectedIds.includes(summary.constituencyId);
          const severity = battlegroundSeverity(summary);
          const leadChanged = changed.has(summary.constituencyId);
          const leaderPhoto = candidatePhotoLookup.get(`${summary.constituencyId}:${normalizeCandidateName(summary.leadingCandidate)}`);
          const trailingPhoto = candidatePhotoLookup.get(`${summary.constituencyId}:${normalizeCandidateName(summary.trailingCandidate)}`);
          return (
            <div key={summary.constituencyId} className="group relative overflow-hidden rounded-md border border-amber-200 bg-[radial-gradient(circle_at_left,rgba(34,197,94,0.12),transparent_35%),radial-gradient(circle_at_right,rgba(244,63,94,0.14),transparent_35%),linear-gradient(160deg,rgba(255,255,255,0.95),rgba(255,255,255,0.86))] p-3 shadow-sm transition duration-300 hover:-translate-y-0.5 hover:shadow-lg motion-reduce:transform-none dark:border-zinc-800 dark:bg-[radial-gradient(circle_at_left,rgba(34,197,94,0.18),transparent_35%),radial-gradient(circle_at_right,rgba(244,63,94,0.18),transparent_35%),linear-gradient(160deg,rgba(9,9,11,0.96),rgba(9,9,11,0.9))]">
              <div className="pointer-events-none absolute inset-0 opacity-100 motion-reduce:transition-none">
                <div className="absolute inset-y-0 left-[-35%] w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-white/12 to-transparent opacity-40 motion-safe:animate-[pulse_6s_ease-in-out_infinite] dark:via-white/8" />
              </div>
              <div className="pointer-events-none absolute inset-0 opacity-0 transition duration-300 group-hover:opacity-100 motion-reduce:transition-none">
                <div className="absolute inset-y-0 left-[-30%] w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-white/20 to-transparent motion-safe:animate-pulse dark:via-white/10" />
              </div>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-base font-black text-zinc-950 dark:text-white">{summary.constituencyName}</div>
                  <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
                    Closest contest right now
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    className="btn-press inline-flex h-7 w-7 items-center justify-center rounded-full border border-zinc-300/70 bg-white/80 text-zinc-700 hover:bg-white dark:border-zinc-700 dark:bg-zinc-950/80 dark:text-zinc-200 dark:hover:bg-zinc-950"
                    onClick={() => onShare(summary)}
                    type="button"
                    title="Share this race"
                    aria-label="Share this race"
                  >
                    <Share2 className="h-3.5 w-3.5" />
                  </button>
                  {leadChanged && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-black text-sky-900 motion-safe:animate-pulse dark:bg-sky-900/60 dark:text-sky-100">Lead changed</span>}
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${severity.tone}`}>
                    {severity.label}
                  </span>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="rounded-full motion-safe:animate-[pulse_4.8s_ease-in-out_infinite]">
                      <CandidatePhoto
                        candidateName={summary.leadingCandidate || "Leader"}
                        photoUrl={leaderPhoto}
                        size="mini"
                        tone="leading"
                        crowned={isDeclaredWinner(summary.statusText || summary.roundStatus)}
                      />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-xs font-black text-zinc-950 dark:text-white">{summary.leadingCandidate || "Leader"}</div>
                      <div className="truncate text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">{shortPartyName(summary.leadingParty || "Leader")}</div>
                    </div>
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">Margin</div>
                  <div className="relative">
                    <div className="pointer-events-none absolute inset-[-10px] rounded-full bg-amber-300/20 blur-md motion-safe:animate-[pulse_5.6s_ease-in-out_infinite]" />
                    <div className={`relative text-2xl font-black leading-none text-amber-500 dark:text-amber-300 ${summary.margin <= HIGH_TIGHT_MARGIN_LIMIT ? "motion-safe:animate-pulse" : ""}`}>{formatNumber(summary.margin)}</div>
                  </div>
                </div>
                <div className="min-w-0 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-black text-zinc-950 dark:text-white">{summary.trailingCandidate || "Runner-up"}</div>
                      <div className="truncate text-[10px] font-semibold text-rose-700 dark:text-rose-300">{shortPartyName(summary.trailingParty || "Runner-up")}</div>
                    </div>
                    <CandidatePhoto
                      candidateName={summary.trailingCandidate || "Runner-up"}
                      photoUrl={trailingPhoto}
                      size="mini"
                      tone="trailing"
                    />
                  </div>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between gap-2">
                <div className="text-[11px] font-semibold text-zinc-500 transition group-hover:text-zinc-700 dark:group-hover:text-zinc-300">
                  {isDeclaredWinner(summary.statusText || summary.roundStatus) ? "Declared result" : summary.roundStatus || summary.statusText || "Counting"}
                </div>
                {selected ? (
                  <span className="rounded-md bg-emerald-100 px-2 py-1 text-[10px] font-black uppercase text-emerald-900 dark:bg-emerald-900/60 dark:text-emerald-100">Tracking</span>
                ) : (
                  <button className="btn-press rounded-md bg-zinc-950 px-3 py-1.5 text-[10px] font-black uppercase text-white dark:bg-white dark:text-zinc-950" onClick={() => onAdd(summary)} type="button">
                    Add
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function BattlegroundModal({
  races,
  selectedIds,
  leaderChanges,
  candidatePhotoLookup,
  onAdd,
  onShareRace,
  onShare,
  onClose
}: {
  races: ConstituencySummary[];
  selectedIds: string[];
  leaderChanges: ConstituencyResult[];
  candidatePhotoLookup: Map<string, string>;
  onAdd: (summary: ConstituencySummary) => void;
  onShareRace: (summary: ConstituencySummary) => void;
  onShare: () => void;
  onClose: () => void;
}) {
  const changed = useMemo(() => new Set(leaderChanges.map((item) => item.constituencyId)), [leaderChanges]);
  return (
    <div className="fixed inset-0 z-[145] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-md border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div>
            <div className="text-[11px] font-black uppercase tracking-[0.22em] text-amber-700 dark:text-amber-300">Battleground Races</div>
            <h2 className="mt-1 text-xl font-black text-zinc-950 dark:text-white">Top 20 closest races right now</h2>
            <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Smallest margins, lead changes, and recount-risk seats in one place.</div>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn-press rounded-full border border-zinc-300 p-2 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300" onClick={onShare} type="button" aria-label="Share battleground card">
              <Share2 className="h-4 w-4" />
            </button>
            <button className="btn-press rounded-full border border-zinc-300 p-2 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300" onClick={onClose} type="button" aria-label="Close battleground seats">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="overflow-y-auto p-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {races.map((summary) => {
              const severity = battlegroundSeverity(summary);
              const selected = selectedIds.includes(summary.constituencyId);
              const leadChanged = changed.has(summary.constituencyId);
              const leaderPhoto = candidatePhotoLookup.get(`${summary.constituencyId}:${normalizeCandidateName(summary.leadingCandidate)}`);
              const trailingPhoto = candidatePhotoLookup.get(`${summary.constituencyId}:${normalizeCandidateName(summary.trailingCandidate)}`);
              return (
                <div key={summary.constituencyId} className="group relative overflow-hidden rounded-md border border-zinc-200 bg-[radial-gradient(circle_at_left,rgba(34,197,94,0.12),transparent_30%),radial-gradient(circle_at_right,rgba(244,63,94,0.14),transparent_30%),linear-gradient(160deg,rgba(255,255,255,0.96),rgba(255,255,255,0.92))] p-4 transition duration-300 hover:-translate-y-0.5 hover:shadow-lg motion-reduce:transform-none dark:border-zinc-800 dark:bg-[radial-gradient(circle_at_left,rgba(34,197,94,0.18),transparent_35%),radial-gradient(circle_at_right,rgba(244,63,94,0.18),transparent_35%),linear-gradient(160deg,rgba(9,9,11,0.96),rgba(9,9,11,0.92))]">
                  <div className="pointer-events-none absolute inset-0 opacity-100 motion-reduce:transition-none">
                    <div className="absolute inset-y-0 left-[-30%] w-1/4 -skew-x-12 bg-gradient-to-r from-transparent via-white/10 to-transparent opacity-40 motion-safe:animate-[pulse_6.5s_ease-in-out_infinite] dark:via-white/8" />
                  </div>
                  <div className="pointer-events-none absolute inset-0 opacity-0 transition duration-300 group-hover:opacity-100 motion-reduce:transition-none">
                    <div className="absolute inset-y-0 left-[-25%] w-1/4 -skew-x-12 bg-gradient-to-r from-transparent via-white/15 to-transparent motion-safe:animate-pulse dark:via-white/10" />
                  </div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-lg font-black text-zinc-950 dark:text-white">{summary.constituencyName}</div>
                      <div className="mt-1 text-xs font-semibold text-zinc-500">AC {summary.constituencyNumber}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        className="btn-press inline-flex h-8 w-8 items-center justify-center rounded-full border border-zinc-300/70 bg-white/80 text-zinc-700 hover:bg-white dark:border-zinc-700 dark:bg-zinc-950/80 dark:text-zinc-200 dark:hover:bg-zinc-950"
                        onClick={() => onShareRace(summary)}
                        type="button"
                        title="Share this race"
                        aria-label="Share this race"
                      >
                        <Share2 className="h-4 w-4" />
                      </button>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${severity.tone} ${summary.margin <= HIGH_TIGHT_MARGIN_LIMIT ? "motion-safe:animate-pulse" : ""}`}>{severity.label}</span>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-col items-start gap-2">
                        <div className="rounded-full motion-safe:animate-[pulse_4.8s_ease-in-out_infinite]">
                          <CandidatePhoto
                            candidateName={summary.leadingCandidate || "Leader"}
                            photoUrl={leaderPhoto}
                            size="small"
                            tone="leading"
                            crowned={isDeclaredWinner(summary.statusText || summary.roundStatus)}
                          />
                        </div>
                        <div className="min-w-0">
                          <div className="line-clamp-2 text-sm font-black leading-tight text-zinc-950 dark:text-white">{summary.leadingCandidate || "Leader"}</div>
                          <div className="mt-1 truncate text-xs font-semibold text-emerald-700 dark:text-emerald-300">{shortPartyName(summary.leadingParty || "Leader")}</div>
                        </div>
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">Margin</div>
                      <div className="relative mt-1">
                        <div className="pointer-events-none absolute inset-[-12px] rounded-full bg-amber-300/20 blur-lg motion-safe:animate-[pulse_5.6s_ease-in-out_infinite]" />
                        <div className={`relative text-4xl font-black leading-none text-amber-500 dark:text-amber-300 ${summary.margin <= HIGH_TIGHT_MARGIN_LIMIT ? "motion-safe:animate-pulse" : ""}`}>{formatNumber(summary.margin)}</div>
                      </div>
                    </div>
                    <div className="min-w-0 text-right">
                      <div className="flex flex-col items-end gap-2">
                        <CandidatePhoto
                          candidateName={summary.trailingCandidate || "Runner-up"}
                          photoUrl={trailingPhoto}
                          size="small"
                          tone="trailing"
                        />
                        <div className="min-w-0">
                          <div className="line-clamp-2 text-sm font-black leading-tight text-zinc-950 dark:text-white">{summary.trailingCandidate || "Runner-up"}</div>
                          <div className="mt-1 truncate text-xs font-semibold text-rose-700 dark:text-rose-300">{shortPartyName(summary.trailingParty || "Runner-up")}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 rounded-md border border-white/10 bg-black/10 px-3 py-2 text-center text-sm font-semibold text-zinc-700 dark:bg-white/5 dark:text-zinc-200">
                    {shortPartyName(summary.leadingParty || "Leader")} {isDeclaredWinner(summary.statusText || summary.roundStatus) ? "won by" : "leading by"} {formatNumber(summary.margin)} votes against {shortPartyName(summary.trailingParty || "Runner-up")}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {leadChanged && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-black text-sky-900 motion-safe:animate-pulse dark:bg-sky-900/60 dark:text-sky-100">Lead changed</span>}
                    {summary.margin <= HIGH_TIGHT_MARGIN_LIMIT && (
                      <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-black text-rose-900 dark:bg-rose-900/60 dark:text-rose-100">Recount risk</span>
                    )}
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-black text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                      {isDeclaredWinner(summary.statusText || summary.roundStatus) ? "Declared" : summary.roundStatus || summary.statusText || "Counting"}
                    </span>
                  </div>
                  <div className="mt-4 flex items-center justify-between gap-2">
                    <div className="text-[11px] font-semibold text-zinc-500">
                      {isDeclaredWinner(summary.statusText || summary.roundStatus) ? "Final head-to-head" : "Live head-to-head"}
                    </div>
                    {selected ? (
                      <span className="rounded-md bg-emerald-100 px-2 py-1 text-[10px] font-black uppercase text-emerald-900 dark:bg-emerald-900/60 dark:text-emerald-100">Already tracking</span>
                    ) : (
                      <button className="btn-press rounded-md bg-zinc-950 px-3 py-1.5 text-[10px] font-black uppercase text-white dark:bg-white dark:text-zinc-950" onClick={() => onAdd(summary)} type="button">
                        Add seat
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function ShareCardModal({ payload, onClose }: { payload: ShareCardPayload; onClose: () => void }) {
  const [format, setFormat] = useState<ShareCardFormat>("square");
  const [busy, setBusy] = useState<"" | "download" | "share">("");
  const exportCardRef = useRef<HTMLDivElement | null>(null);
  const constituencyPreview = payload.kind === "constituency"
    ? proxyBattleShareCardAssets(buildElectionBattleShareCardPropsFromResult(payload.result, payload.electionTitle, payload.checkedAt, {
      leftPartyColor: payload.leftPartyColor,
      rightPartyColor: payload.rightPartyColor
    }))
    : null;
  const premiumSquarePreview = payload.kind === "constituency" && format === "square" && constituencyPreview
    ? <ElectionBattleShareCard {...constituencyPreview} animated />
    : payload.kind === "party-summary" && format === "square"
      ? <PartySummaryShareCard electionTitle={payload.electionTitle} parties={payload.parties} />
      : payload.kind === "victory" && format === "square"
        ? <FinalVictoryShareCard outcome={payload.outcome} />
        : null;
  const title = payload.kind === "constituency"
    ? `${payload.result.constituencyName} result card`
    : payload.kind === "party-summary"
      ? "Party summary card"
      : payload.kind === "battleground"
        ? "Battleground card"
        : "Victory card";

  const run = async (mode: "download" | "share") => {
    try {
      setBusy(mode);
      const blob = await buildShareCardBlob(payload, format, exportCardRef.current);
      const fileName = shareCardFileName(payload, format);
      if (mode === "download") {
        downloadBlob(blob, fileName);
      } else {
        const file = new File([blob], fileName, { type: "image/png" });
        if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
          await navigator.share({
            files: [file],
            title: title,
            text: "Track live results on OneKerala Results.",
            url: "https://results.onekeralam.in/"
          });
        } else {
          downloadBlob(blob, fileName);
        }
      }
    } catch (error) {
      console.error("Share card export failed", error);
      window.alert("Could not generate the share image. Please try again.");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="fixed inset-0 z-[170] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        className="w-full max-w-md rounded-md border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div>
            <div className="text-[11px] font-black uppercase tracking-[0.22em] text-emerald-700 dark:text-emerald-400">Share Card</div>
            <h3 className="mt-1 text-lg font-black text-zinc-950 dark:text-white">{title}</h3>
            <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Generate a clean image for WhatsApp, Instagram, X, or Telegram.</div>
          </div>
          <button className="btn-press rounded-full border border-zinc-300 p-2 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300" onClick={onClose} type="button" aria-label="Close share card generator">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4">
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: "square" as const, label: "Square" },
              { id: "story" as const, label: "Story" },
              { id: "landscape" as const, label: "Wide" }
            ].map((option) => (
              <button
                key={option.id}
                className={`rounded-md border px-3 py-2 text-sm font-black ${format === option.id ? "border-emerald-600 bg-emerald-50 text-emerald-900 dark:border-emerald-500 dark:bg-emerald-950/40 dark:text-emerald-100" : "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"}`}
                onClick={() => setFormat(option.id)}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
          {premiumSquarePreview ? (
            <div className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/50">
              <div className="mb-3 text-[11px] font-black uppercase tracking-[0.24em] text-zinc-500 dark:text-zinc-400">Preview</div>
              {premiumSquarePreview}
            </div>
          ) : null}
          <div className="mt-4 flex items-center justify-end gap-2">
            <button className="btn-press rounded-md border border-zinc-300 px-3 py-2 text-sm font-semibold dark:border-zinc-700" onClick={() => void run("download")} disabled={Boolean(busy)} type="button">
              <Download className="mr-2 inline h-4 w-4" />
              {busy === "download" ? "Working..." : "Download"}
            </button>
            <button className="btn-press-dark rounded-md bg-zinc-950 px-3 py-2 text-sm font-semibold text-white dark:bg-white dark:text-zinc-950" onClick={() => void run("share")} disabled={Boolean(busy)} type="button">
              <Share2 className="mr-2 inline h-4 w-4" />
              {busy === "share" ? "Working..." : "Share"}
            </button>
          </div>
        </div>
        {premiumSquarePreview ? (
          <div aria-hidden="true" className="pointer-events-none fixed top-0" style={{ left: -2000 }}>
            <div ref={exportCardRef}>
              {payload.kind === "constituency" && constituencyPreview ? (
                <ElectionBattleShareCard {...constituencyPreview} animated={false} previewScale={1} />
              ) : payload.kind === "party-summary" ? (
                <PartySummaryShareCard electionTitle={payload.electionTitle} parties={payload.parties} previewScale={1} />
              ) : payload.kind === "victory" ? (
                <FinalVictoryShareCard outcome={payload.outcome} previewScale={1} />
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function HelpPage({
  activeProfileTitle,
  refreshSeconds,
  onBack,
  onNavigate
}: {
  activeProfileTitle: string;
  refreshSeconds: number;
  onBack: () => void;
  onNavigate: (path: string) => void;
}) {
  return (
    <main className="min-h-screen bg-white text-zinc-950 dark:bg-zinc-950 dark:text-white">
      <section className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-5 sm:px-6 lg:px-8">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[11px] font-black uppercase tracking-[0.24em] text-emerald-700 dark:text-emerald-400">Help & Manual</div>
              <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Election Tracker User Guide</h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-600 dark:text-zinc-300">
                Everything about the app in one place: what it does, how to use each feature, what to expect on counting day,
                and where the practical limits are.
              </p>
            </div>
            <button
              className="btn-press inline-flex shrink-0 items-center gap-2 rounded-md border border-zinc-300 px-3 py-2 text-sm font-semibold dark:border-zinc-700"
              onClick={onBack}
              type="button"
            >
              <ChevronLeft className="h-4 w-4" />
              Back
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <HelpStatCard label="Focused election" value={activeProfileTitle} />
            <HelpStatCard label="Refresh cadence" value={`${refreshSeconds}s`} />
            <HelpStatCard label="Source" value="Official ECI result pages via backend parser" />
          </div>
        </div>
      </section>

      <section className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-6 sm:px-6 lg:px-8">
        <HelpSection title="What this app is">
          <HelpParagraph>
            This application is a personalized election-tracking dashboard built around official Election Commission of India
            result pages. Instead of forcing users to watch every constituency, it lets them focus only on the seats, candidates,
            and race patterns they actually care about.
          </HelpParagraph>
          <HelpParagraph>
            It combines live result fetching, constituency and candidate watchlists, battleground intelligence, profile-based
            election switching, watch mode, prediction context, shareable result cards, alerting, summary intelligence, and
            community chat in one place.
          </HelpParagraph>
        </HelpSection>

        <HelpSection title="What users can do">
          <HelpList
            items={[
              "Select multiple constituencies from the searchable seat list.",
              "Search candidates directly and automatically add their constituency into the tracked list.",
              "Track leading candidate, trailing candidate, lead margin, total votes, and counting progress for each selected card.",
              "Pin important constituencies and sort cards in different ways.",
              "Filter the board by party or watch group.",
              "Switch between assembly result profiles from the clickable header when multiple elections are available.",
              "Use watch mode for large-screen passive viewing.",
              "Watch the Battleground Races strip for the closest contests across the wider election, not just your selected seats.",
              "See live winner, loss, leader-change, and tight-race notifications.",
              "Open timeline playback for a constituency and replay how its lead evolved.",
              "See a simple Prediction Meter in seat context based on margin, rounds counted, and previous result history.",
              "Generate premium share cards for constituencies, statewide tally, battlegrounds, and final results.",
              "Subscribe to Telegram alerts for important tracked-seat and statewide events.",
              "Join the profile-specific community chat and follow live discussion.",
              "Listen to live background audio from supported news channels.",
              "Open admin settings to manage URLs, discovery, countdowns, and source behavior if you have admin access."
            ]}
          />
        </HelpSection>

        <HelpSection title="Quick start">
          <HelpStepList
            steps={[
              "Open the app and confirm the election profile shown in the header. If multiple elections are available, click the header title and choose the one you want.",
              "Use the top Add seat/candidate search to quickly add a constituency or candidate, or use the Constituencies panel on the left.",
              "Select one or more constituencies. Their cards appear immediately in the main board.",
              "Optionally search candidates in Candidate Watch. When you watch a candidate, the app also selects that candidate's constituency for you.",
              "Use Sort cards and Watch group in the left controls to reorganize what you see.",
              "Turn Alerts On if you want winner toasts, tight-race signals, and chat notification sounds.",
              "Use the share icons whenever you want a polished image for WhatsApp, Instagram, Facebook, X, or Telegram.",
              "Use Watch mode when you want a distraction-free large-screen monitoring view.",
              "Refresh happens automatically every configured number of seconds, but you can still use Refresh anytime."
            ]}
          />
        </HelpSection>

        <HelpSection title="Main screen explained">
          <HelpFeatureGrid
            features={[
              {
                title: "Header and election switcher",
                body: "The large title at the top is clickable. It acts as a profile selector when more than one assembly result is available. The focused election changes the whole app: constituency list, candidates, chat, summaries, alerts, and caches."
              },
              {
                title: "Quick add search",
                body: "The top search box accepts constituencies and candidates. It is the fastest way to add a seat or candidate without opening the left panel."
              },
              {
                title: "Metrics strip",
                body: "Shows selected count, next refresh countdown, last successful sync time, and a live source-health label."
              },
              {
                title: "Constituency selector",
                body: "The left panel lists all constituencies from the active election profile. It supports search, multi-select, clear, and favorite-based shortcuts."
              },
              {
                title: "Candidate watch",
                body: "Lets users search candidates without browsing every constituency. Watching a candidate automatically watches that candidate's constituency too."
              },
              {
                title: "Selected constituency cards",
                body: "These are the core live cards. They show leader, runner-up, photos, lead margin, vote totals, result state, and other compact indicators. Some extra candidate information appears through hover or compact supporting cues."
              },
              {
                title: "Battleground strip",
                body: "Near the top of the dashboard, the Battleground Races strip highlights the closest or most dramatic contests across the active election profile. It is designed to surface fresh drama without forcing users to scan the entire state summary."
              },
              {
                title: "Summary dock",
                body: "The dock at the bottom shows total seats by party, using party-color cues inspired by the ECI layout. Each party tile can open its own constituency-level breakdown."
              },
              {
                title: "Share actions",
                body: "Several parts of the app now include compact share icons. These open premium export-ready cards for individual constituencies, statewide tally, battlegrounds, and final results."
              },
              {
                title: "Utility corner",
                body: "The small floating utility tile shows chat access, watching-now count, and total views without taking up a separate section."
              }
            ]}
          />
        </HelpSection>

        <HelpSection title="Detailed feature guide">
          <HelpSubSection title="1. Constituency selection">
            <HelpParagraph>
              The Constituencies panel loads all available seats for the active election profile. Users can search the list, tick multiple checkboxes,
              and their selections persist in browser storage. Clearing selections removes tracked cards. If a candidate is removed from Candidate Watch,
              the linked constituency is also removed from selection when appropriate.
            </HelpParagraph>
          </HelpSubSection>

          <HelpSubSection title="2. Candidate Watch">
            <HelpParagraph>
              Candidate Watch is designed for users who care more about a person than a seat. Search by candidate name, select them, and the app
              automatically pulls that candidate's constituency into the main tracked set. Candidate Watch is profile-specific, so a Bihar watchlist
              does not leak into Tamil Nadu or Kerala.
            </HelpParagraph>
          </HelpSubSection>

          <HelpSubSection title="3. Result cards">
            <HelpParagraph>
              Each selected constituency appears as a compact live card. The leader is visually stronger, the runner-up is smaller, and both carry
              party and vote context. Declared seats show a completion indicator, while active counting seats show a counting indicator and progress
              cues when available.
            </HelpParagraph>
          </HelpSubSection>

          <HelpSubSection title="4. Watch mode">
            <HelpParagraph>
              Watch mode is built for large-screen viewing. It strips away the side panels, keeps the screen active, and supports optional auto-scroll.
              This is useful when you want to leave the app open on a TV, monitor, or projector and just watch the selected cards update.
            </HelpParagraph>
          </HelpSubSection>

          <HelpSubSection title="5. Refresh behavior">
            <HelpParagraph>
              The app auto-refreshes on a configurable interval, and individual result cards update without a full-page reload. Manual refresh is
              available at any time. Backend caching and prewarming help keep refreshes responsive while reducing repeated pressure on the ECI source.
            </HelpParagraph>
          </HelpSubSection>

          <HelpSubSection title="6. Alerts and toasts">
            <HelpParagraph>
              Alerts can notify users about new winners, significant tight races, selected candidate events, and certain loss scenarios. Winner toasts
              and tight-race toasts are designed to stay informative without forcing the user to scan the whole page manually.
            </HelpParagraph>
          </HelpSubSection>

          <HelpSubSection title="7. Tight races intelligence">
            <HelpParagraph>
              The app continuously inspects broader constituency trends, not only the currently selected seats. It can surface constituencies where the
              margin is dangerously narrow or becoming interesting later in the count. These appear in the left pane and can also trigger toasts.
            </HelpParagraph>
          </HelpSubSection>

          <HelpSubSection title="8. Battleground mode">
            <HelpParagraph>
              Battleground mode brings the tightest and most dramatic races to the front. The homepage strip shows only a compact shortlist, while the
              full battleground view can show the broader list of close contests. Users can add any of these seats directly into their tracked board.
            </HelpParagraph>
          </HelpSubSection>

          <HelpSubSection title="9. Timeline playback and Prediction Meter">
            <HelpParagraph>
              Timeline playback lets a user open a constituency and replay how its lead changed over time. In the same seat-context view, the app also
              shows a simple Prediction Meter. This is not a guaranteed forecast. It is a confidence-style indicator based on current margin, counting
              progress, previous result history, and whether the lead recently changed.
            </HelpParagraph>
          </HelpSubSection>

          <HelpSubSection title="10. Summary dock and party modal">
            <HelpParagraph>
              The summary dock at the bottom shows seat totals by party. Clicking a party tile opens a detailed view of constituencies where that party
              is leading or has won, along with candidate context and margins.
            </HelpParagraph>
          </HelpSubSection>
          <HelpSubSection title="11. Share cards">
            <HelpParagraph>
              The app can generate polished square, wide, and story-style share cards from live results. Users can share a constituency battle,
              statewide tally, battleground view, or final result without manually taking screenshots. These cards are styled for social sharing and
              include branding, result context, and party colors.
            </HelpParagraph>
          </HelpSubSection>

          <HelpSubSection title="12. Community chat">
            <HelpParagraph>
              The chat is live and profile-specific. If a user is watching Bihar, they see Bihar chat. If they switch to another election, they enter
              that election's chat room instead. Anonymous users get stable visual identity cues, named users keep their names, and admin messages are
              clearly highlighted.
            </HelpParagraph>
          </HelpSubSection>

          <HelpSubSection title="13. Live audio and Telegram alerts">
            <HelpParagraph>
              Users can play supported live news audio streams alongside the tracker. The app also supports Telegram alert linking so important events
              like lead changes, winners, tight margins, and major statewide shifts can reach users outside the browser.
            </HelpParagraph>
          </HelpSubSection>

          <HelpSubSection title="14. Victory announcement">
            <HelpParagraph>
              Once an assembly is fully declared, the app can open a full-screen winner announcement showing the victorious party, seat total,
              majority context, and closing facts like closest result and biggest margin. This works per selected election profile.
            </HelpParagraph>
          </HelpSubSection>
        </HelpSection>

        <HelpSection title="Admin controls">
          <HelpParagraph>
            Admin features are hidden from normal users. After admin authentication, the admin can control result-source URLs, refresh timing,
            countdown/banner visibility, source discovery, source profile updates, and revert behavior.
          </HelpParagraph>
          <HelpList
            items={[
              "Change base URL, constituency list URL, and candidate detail URL template for the currently focused election profile.",
              "Set refresh interval seconds.",
              "Hide or show the pre-election scrolling banner.",
              "Hide or show the top countdown.",
              "Run auto-discovery to detect available election profiles and their URLs.",
              "Review discovery status, confidence, sample verification, and auto-apply details.",
              "Revert to previous source configuration when needed.",
              "Control discovery behavior while keeping per-profile source settings separate."
            ]}
          />
        </HelpSection>

        <HelpSection title="Highlights">
          <HelpList
            items={[
              "Focused tracking instead of information overload.",
              "Official-source-backed data through backend parsing.",
              "Profile-aware switching across multiple assembly elections.",
              "Candidate Watch that automatically syncs with tracked constituencies.",
              "Compact live cards tuned for both mobile and big-screen use.",
              "Watch mode for passive long-duration monitoring.",
              "Background intelligence for tight races and major changes.",
              "Battleground surfacing for the closest contests across the election.",
              "Prediction Meter for quick context inside seat replay.",
              "Premium share cards built for social sharing and messaging.",
              "Telegram alerts for off-site follow-up.",
              "Profile-specific live community chat.",
              "Admin-controlled source discovery for counting-day URL changes.",
              "Backend prewarming for faster first refresh."
            ]}
          />
        </HelpSection>

        <HelpSection title="Limitations and practical realities">
          <HelpList
            items={[
              "The app depends on the structure of official ECI result pages. If the HTML changes significantly, parser updates may be needed.",
              "The app cannot be fresher than the ECI source itself. If ECI lags, the app will lag by the same source delay.",
              "Heavy counting-day traffic, caching, or anti-bot measures on ECI infrastructure can affect response speed.",
              "Some browser behaviors, especially around audio autoplay, depend on user interaction and browser policy.",
              "Live features like leader changes and counting progress are most meaningful during active counting, not after full declaration.",
              "The Prediction Meter is an informed confidence indicator, not a statistical guarantee of the final outcome.",
              "Anonymous chat is convenient, but not a full identity system.",
              "The frontend bundle is fairly feature-rich and therefore heavier than a minimal single-purpose page."
            ]}
          />
        </HelpSection>

        <HelpSection title="FAQ">
          <HelpFaq
            items={[
              {
                q: "Is this app using official data?",
                a: "Yes. The app is designed to fetch and normalize data from official Election Commission of India result pages through the backend."
              },
              {
                q: "Does the browser scrape ECI directly?",
                a: "No. The backend handles HTML fetching and parsing. The frontend consumes backend APIs."
              },
              {
                q: "Will my selected constituencies stay saved?",
                a: "Yes. Seat selection, candidate watch choices, pins, and several other preferences are stored in browser storage and also tracked per election profile."
              },
              {
                q: "If multiple assembly elections are available, how do I switch?",
                a: "Click the main election title in the header. A selector opens and lets you switch the focused election profile."
              },
              {
                q: "Does the chat show all elections together?",
                a: "No. Chat is scoped to the currently selected election profile."
              },
              {
                q: "Is the Prediction Meter a guarantee?",
                a: "No. It is a lightweight confidence indicator based on current margin, counting progress, result history, and lead stability. It should be read as guidance, not certainty."
              },
              {
                q: "Can I share what I am seeing without taking screenshots manually?",
                a: "Yes. Use the share icons to generate premium cards for constituencies, statewide tally, battlegrounds, and final results."
              },
              {
                q: "Can I get updates outside the browser?",
                a: "Yes. The app supports Telegram alert linking for supported election events, in addition to in-browser toasts and sounds."
              },
              {
                q: "Why might refresh still feel slow sometimes?",
                a: "The app itself is optimized, but final freshness still depends on the response time and caching behavior of the official ECI pages."
              },
              {
                q: "Can the app survive election-day URL changes?",
                a: "Yes, that is one of the main design goals. Admin controls and auto-discovery exist specifically to manage changing ECI paths."
              },
              {
                q: "Will the app notify me if I did not manually select a constituency?",
                a: "Yes, for certain categories like global winners and tight-race intelligence. Some alerts intentionally look beyond your selected list."
              },
              {
                q: "What happens after counting is over?",
                a: "The app continues to show final results, party summary, and historical context. Certain live-counting behaviors naturally become less relevant once everything is declared."
              },
              {
                q: "Do I need admin access to use the app normally?",
                a: "No. Normal users can use all tracking, watch, chat, and viewing features without admin access. Admin is only for source and operational controls."
              }
            ]}
          />
        </HelpSection>
      </section>
      <Footer navigate={onNavigate} />
    </main>
  );
}

function HelpSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-md border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-xl font-black text-zinc-950 dark:text-white">{title}</h2>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

function HelpSubSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-black uppercase tracking-wide text-emerald-700 dark:text-emerald-400">{title}</h3>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function HelpParagraph({ children }: { children: ReactNode }) {
  return <p className="text-sm leading-6 text-zinc-700 dark:text-zinc-300">{children}</p>;
}

function HelpList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2 text-sm leading-6 text-zinc-700 dark:text-zinc-300">
      {items.map((item) => (
        <li key={item} className="flex gap-3">
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-600 dark:bg-emerald-400" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function HelpStepList({ steps }: { steps: string[] }) {
  return (
    <ol className="space-y-3 text-sm leading-6 text-zinc-700 dark:text-zinc-300">
      {steps.map((step, index) => (
        <li key={step} className="flex gap-3">
          <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-xs font-black text-white">
            {index + 1}
          </span>
          <span>{step}</span>
        </li>
      ))}
    </ol>
  );
}

function HelpFeatureGrid({ features }: { features: Array<{ title: string; body: string }> }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {features.map((feature) => (
        <div key={feature.title} className="rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="text-sm font-black text-zinc-950 dark:text-white">{feature.title}</div>
          <div className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-300">{feature.body}</div>
        </div>
      ))}
    </div>
  );
}

function HelpFaq({ items }: { items: Array<{ q: string; a: string }> }) {
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <details key={item.q} className="rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
          <summary className="cursor-pointer list-none text-sm font-black text-zinc-950 dark:text-white">{item.q}</summary>
          <p className="mt-3 text-sm leading-6 text-zinc-700 dark:text-zinc-300">{item.a}</p>
        </details>
      ))}
    </div>
  );
}

function HelpStatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="text-[10px] font-black uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-2 text-sm font-black text-zinc-950 dark:text-white">{value}</div>
    </div>
  );
}

function TelegramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M21.7 4.34a1.64 1.64 0 0 0-1.73-.22L3.18 11.35a1.48 1.48 0 0 0 .1 2.77l4.22 1.46 1.62 5.12a1.5 1.5 0 0 0 2.54.62l2.34-2.39 4.59 3.38a1.64 1.64 0 0 0 2.57-.96l2.72-15.33a1.64 1.64 0 0 0-.58-1.68ZM9.24 14.96l8.9-6.32-6.9 7.39a.75.75 0 0 0-.19.36l-.7 2.95-1.11-3.52a.75.75 0 0 0-.5-.49Z" />
    </svg>
  );
}

function ResultCard({
  result,
  previous,
  checkedAt,
  freshness,
  isPinned,
  onTogglePin,
  onRemove,
  changedAt,
  leaderChanged,
  integrityWarning,
  lowBandwidthMode,
  history,
  seatHistory,
  note,
  onNoteChange,
  onNavigate,
  onShare
}: {
  result: ConstituencyResult;
  previous?: ConstituencyResult;
  checkedAt?: number;
  freshness: "Fresh" | "Cached" | "Stale";
  isPinned: boolean;
  onTogglePin: () => void;
  onRemove: () => void;
  changedAt?: number;
  leaderChanged: boolean;
  integrityWarning?: string;
  lowBandwidthMode: boolean;
  history: LeaderHistoryEntry[];
  seatHistory?: ConstituencyElectionHistory;
  note: string;
  onNoteChange: (note: string) => void;
  onNavigate: () => void;
  onShare: () => void;
}) {
  const [notesOpen, setNotesOpen] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
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
  const sourceDelayMinutes = sourceDelayInMinutes(result.lastUpdated, checkedAt);
  const statusForDisplay = result.statusText || result.roundStatus;
  const declared = isDeclaredWinner(result.statusText || result.roundStatus);
  const closeFight = result.margin <= 5000;
  const veryCloseFight = result.margin <= 1000;
  const confidence = raceConfidenceLabel(result, countingPercent);
  const leaderVotesChanged = previous ? (leader?.totalVotes ?? 0) !== (previous.candidates[0]?.totalVotes ?? 0) : false;
  const marginChanged = previous ? result.margin !== previous.margin : false;

  return (
    <article
      key={`${result.constituencyId}-${checkedAt ?? 0}`}
      className={`panel animate-card-refresh animate-refresh-wave relative w-full min-w-0 max-w-full cursor-pointer overflow-visible rounded-md transition hover:shadow-xl hover:shadow-black/10 focus-within:ring-2 focus-within:ring-emerald-400 ${veryCloseFight ? "animate-close-fight ring-2 ring-rose-600" : closeFight ? "animate-close-watch ring-2 ring-amber-500" : ""}`}
      role="link"
      tabIndex={0}
      aria-label={`Open ${result.constituencyName} constituency detail page`}
      onClick={onNavigate}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onNavigate();
        }
      }}
    >
      <div className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-bold text-zinc-950 dark:text-white">{result.constituencyName}</h2>
            <StatusIcon status={statusForDisplay} />
            {!declared && <span className={`badge ${confidenceClass(confidence)}`}>{confidence}</span>}
            {leaderChanged && <span className="badge bg-rose-100 text-rose-900 dark:bg-rose-900 dark:text-rose-100">Changed</span>}
            {integrityWarning && (
              <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-amber-100 text-amber-800 ring-1 ring-amber-200 dark:bg-amber-900 dark:text-amber-100 dark:ring-amber-800" title={integrityWarning} aria-label="ECI source mismatch warning">
                <AlertTriangle className="h-3.5 w-3.5" />
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <div onClick={(event) => event.stopPropagation()}>
              <HistoryTooltip history={history} seatHistory={seatHistory} onOpen={() => setTimelineOpen(true)} />
            </div>
            <button
              className={`rounded-md p-1 ${note ? "text-emerald-700 dark:text-emerald-300" : "text-zinc-400 hover:text-emerald-700"}`}
              onClick={(event) => {
                event.stopPropagation();
                setNotesOpen(!notesOpen);
              }}
              title="Seat note"
              aria-label="Seat note"
            >
              <StickyNote className="h-4 w-4" />
            </button>
            <button
              className={`rounded-md p-1 ${isPinned ? "text-amber-500" : "text-zinc-400 hover:text-amber-500"}`}
              onClick={(event) => {
                event.stopPropagation();
                onTogglePin();
              }}
              title={isPinned ? "Unpin" : "Pin"}
              aria-label={isPinned ? "Unpin constituency" : "Pin constituency"}
            >
              <Star className={`h-4 w-4 ${isPinned ? "fill-current" : ""}`} />
            </button>
            <button
              className="rounded-md p-1 text-zinc-400 hover:text-emerald-700 dark:hover:text-emerald-300"
              onClick={(event) => {
                event.stopPropagation();
                onShare();
              }}
              title="Share result card"
              aria-label={`Share ${result.constituencyName} result card`}
            >
              <Share2 className="h-4 w-4" />
            </button>
            <button
              className="rounded-md p-1 text-zinc-400 hover:text-rose-600 dark:hover:text-rose-300"
              onClick={(event) => {
                event.stopPropagation();
                onRemove();
              }}
              title="Remove from selected"
              aria-label={`Remove ${result.constituencyName} from selected constituencies`}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        </div>
      </div>
      <div className="px-4 pb-4">
        {notesOpen && (
          <textarea
            className="mt-3 h-16 w-full resize-none rounded-md border border-zinc-300 bg-white px-3 py-2 text-base dark:border-zinc-700 dark:bg-zinc-900 sm:text-xs"
            value={note}
            onChange={(event) => onNoteChange(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            placeholder="Private note for this seat"
          />
        )}
        <div className="mt-4 grid min-w-0 grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[72px_minmax(0,1fr)_auto] sm:gap-3">
          <CandidatePhoto candidateName={leaderName} photoUrl={leader?.photoUrl} size="large" tone="leading" crowned={declared} suppressImage={lowBandwidthMode} />
          <div className="min-w-0 space-y-0.5">
            <div className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
              <ArrowUp className="h-3.5 w-3.5" />
              {declared ? "Won" : "Leading"}
            </div>
            <div className="truncate text-[15px] font-black leading-tight text-zinc-950 dark:text-white" title={leaderName}>{leaderName}{declared ? <span className="ml-1 text-amber-500"> ♛</span> : null}</div>
            <div className={`truncate text-sm font-bold leading-tight text-zinc-950 dark:text-white ${leaderVotesChanged ? "animate-value-change" : ""}`}>{formatNumber(leader?.totalVotes ?? 0)}</div>
            <div className="truncate text-sm font-semibold leading-tight text-zinc-600 dark:text-zinc-300" title={leaderParty}>{leaderParty}</div>
          </div>
          <div className="min-w-[72px] shrink-0 text-right">
            <div className={`text-xs font-semibold uppercase tracking-wide ${declared ? "text-emerald-700 dark:text-emerald-300" : closeFight ? "text-amber-700 dark:text-amber-300" : "text-zinc-500"}`}>{declared ? "Won margin" : veryCloseFight ? "Alert lead" : closeFight ? "Tight lead" : "Lead"}</div>
            <div className={`text-lg font-black text-emerald-700 dark:text-emerald-300 ${marginChanged ? "animate-value-change" : ""}`}>{formatNumber(result.margin)}</div>
            <div className="mt-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Total votes</div>
            <div className={`text-sm font-black text-zinc-950 dark:text-white ${leaderVotesChanged ? "animate-value-change" : ""}`}>{formatNumber(leader?.totalVotes ?? 0)}</div>
            {marginChange !== 0 && <div className="text-xs font-semibold text-zinc-500">{formatDelta(marginChange)}</div>}
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 rounded-md bg-zinc-100 px-2.5 py-2 dark:bg-zinc-900">
          <CandidatePhoto candidateName={runnerName} photoUrl={runnerUp?.photoUrl} size="tiny" tone="trailing" suppressImage={lowBandwidthMode} />
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-300">
              <ArrowDown className="h-3 w-3" />
              {declared ? "Runner-up" : "Trailing"}
            </div>
            <div className="truncate text-xs font-bold leading-tight text-zinc-950 dark:text-white" title={runnerName}>{runnerName}</div>
            <div className="truncate text-xs font-bold leading-tight text-zinc-950 dark:text-white">{formatNumber(runnerUp?.totalVotes ?? 0)}</div>
            <div className="truncate text-xs font-semibold leading-tight text-zinc-600 dark:text-zinc-300" title={runnerParty}>{runnerParty}</div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Total votes</div>
            <div className="text-xs font-black text-zinc-950 dark:text-white">{formatNumber(runnerUp?.totalVotes ?? 0)}</div>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            {moreCandidates.map((candidate, index) => (
              <CandidateMiniTooltip key={`${candidate.serialNo}-${candidate.candidateName}`} candidate={candidate} position={index + 3} suppressImage={lowBandwidthMode} />
            ))}
          </div>
          <div className="text-right text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
            <div>{freshness} - Last checked {checkedAt ? new Date(checkedAt).toLocaleTimeString() : "-"}</div>
            {sourceDelayMinutes >= 5 && <div className="text-amber-700 dark:text-amber-300">ECI data {sourceDelayMinutes}m old</div>}
            {changedAt && <div>Changed {new Date(changedAt).toLocaleTimeString()}</div>}
          </div>
        </div>
        <MarginSparkline history={history} currentMargin={result.margin} />
      </div>
      {roundProgress && !declared && (
        <div className="relative h-4 overflow-hidden rounded-b-md bg-zinc-200 dark:bg-zinc-800" title={`Round ${roundProgress.current} of ${roundProgress.total}`}>
          <div className="h-full bg-gradient-to-r from-emerald-700 via-teal-500 to-sky-500" style={{ width: `${countingPercent}%` }} />
          <div className="absolute inset-0 flex items-center justify-center text-[10px] font-normal text-white">
            Counting: {countingPercent}% · R{roundProgress.current}/{roundProgress.total}
          </div>
        </div>
      )}
      {timelineOpen && (
        <TimelinePlayback
          result={result}
          history={history}
          seatHistory={seatHistory}
          currentLeader={leaderName}
          currentParty={leaderParty}
          currentMargin={result.margin}
          onClose={() => setTimelineOpen(false)}
        />
      )}
    </article>
  );
}

function CandidateMiniTooltip({
  candidate,
  position,
  suppressImage = false
}: {
  candidate: { candidateName: string; party: string; totalVotes: number; photoUrl?: string };
  position: number;
  suppressImage?: boolean;
}) {
  return (
    <div className="group relative">
      <CandidatePhoto candidateName={candidate.candidateName} photoUrl={candidate.photoUrl} size="mini" suppressImage={suppressImage} />
      <div className="pointer-events-none absolute bottom-full left-0 z-30 mb-2 hidden w-48 rounded-md border border-zinc-200 bg-white p-2 text-left shadow-lg group-hover:block group-focus-within:block dark:border-zinc-800 dark:bg-zinc-950">
        <div className="text-[10px] font-black uppercase tracking-wide text-zinc-500">Position {position}</div>
        <div className="mt-1 text-xs font-black text-zinc-950 dark:text-white">{candidate.candidateName}</div>
        <div className="mt-0.5 text-[10px] font-semibold text-zinc-500">{shortPartyName(candidate.party)}</div>
        <div className="mt-1 text-xs font-black text-zinc-950 dark:text-white">{formatNumber(candidate.totalVotes)} votes</div>
      </div>
    </div>
  );
}

function MarginSparkline({ history, currentMargin }: { history: LeaderHistoryEntry[]; currentMargin: number }) {
  const values = [...history].reverse().map((entry) => entry.margin).concat(currentMargin).slice(-6);
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const points = values
    .map((value, index) => {
      const x = values.length === 1 ? 0 : (index / (values.length - 1)) * 100;
      const y = 18 - (value / max) * 16;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const rising = values[values.length - 1] >= values[0];

  return (
    <div className="mt-2 h-5" title="Margin trend">
      <svg viewBox="0 0 100 20" className="h-full w-full text-zinc-300 dark:text-zinc-800" preserveAspectRatio="none" aria-hidden="true">
        <polyline points={points} fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" opacity="0.45" />
        <polyline points={points} fill="none" stroke={rising ? "#047857" : "#be123c"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function HistoryTooltip({
  history,
  seatHistory,
  onOpen
}: {
  history: LeaderHistoryEntry[];
  seatHistory?: ConstituencyElectionHistory;
  onOpen: () => void;
}) {
  const hasContext = history.length > 0 || Boolean(seatHistory?.entries.length || seatHistory?.contextNote);
  const orderedHistory = useMemo(() => [...history].sort((left, right) => right.at - left.at), [history]);
  const latestEntry = orderedHistory[0];
  const uniqueLeaders = useMemo(() => {
    return new Set(
      orderedHistory.map((entry) => `${normalizeCandidateName(entry.leader)}|${entry.party}`)
    );
  }, [orderedHistory]);
  const compactHistory = useMemo(() => {
    const items: LeaderHistoryEntry[] = [];
    for (const entry of orderedHistory) {
      const previous = items[items.length - 1];
      if (
        previous &&
        normalizeCandidateName(previous.leader) === normalizeCandidateName(entry.leader) &&
        previous.party === entry.party
      ) {
        continue;
      }
      items.push(entry);
      if (items.length >= 3) break;
    }
    return items;
  }, [orderedHistory]);
  const hasLeadChangeHistory = uniqueLeaders.size > 1;

  return (
    <div className="group relative">
      <button
        className={`rounded-md p-1 ${hasContext ? "text-sky-700 dark:text-sky-300" : "text-zinc-400"}`}
        title="Live and election history"
        aria-label="Live and election history"
        type="button"
        onClick={onOpen}
      >
        <History className="h-4 w-4" />
      </button>
      <div className="pointer-events-none absolute right-0 top-full z-50 mt-2 hidden w-64 max-w-[calc(100vw-2rem)] rounded-md border border-zinc-200 bg-white p-3 text-left shadow-lg group-hover:block group-focus-within:block dark:border-zinc-800 dark:bg-zinc-950">
        <div className="text-[10px] font-black uppercase tracking-wide text-zinc-500">Live + seat context</div>
        {history.length ? (
          hasLeadChangeHistory ? (
            <div className="mt-2 space-y-2">
              {compactHistory.map((entry) => (
                <div key={`${entry.at}-${entry.leader}`} className="text-xs">
                  <div className="font-black text-zinc-950 dark:text-white">{entry.leader}</div>
                  <div className="text-zinc-500">
                    {shortPartyName(entry.party)} by {formatNumber(entry.margin)} at {new Date(entry.at).toLocaleTimeString()}
                  </div>
                </div>
              ))}
              {orderedHistory.length > compactHistory.length && (
                <div className="text-[11px] font-semibold text-zinc-500">
                  Open seat context for the full replay.
                </div>
              )}
            </div>
          ) : (
            <div className="mt-2 space-y-1.5 text-xs">
              <div className="font-black text-zinc-950 dark:text-white">
                {/\b(won|declared)\b/i.test(latestEntry?.status || "") ? "No lead changes recorded" : "No lead change yet"}
              </div>
              {latestEntry ? (
                <div className="text-zinc-500">
                  {latestEntry.leader} · {shortPartyName(latestEntry.party)} by {formatNumber(latestEntry.margin)}
                </div>
              ) : null}
            </div>
          )
        ) : (
          <div className="mt-2 text-xs text-zinc-500">No live movement recorded yet.</div>
        )}
        {seatHistory?.entries.length ? (
          <div className="mt-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
            <div className="text-[10px] font-black uppercase tracking-wide text-zinc-500">Election history</div>
            <div className="mt-1 text-xs font-semibold text-zinc-600 dark:text-zinc-300">
              {seatHistory.entries[0].year}: {shortPartyName(seatHistory.entries[0].party)} won by {formatNumber(seatHistory.entries[0].margin)}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TimelinePlayback({
  result,
  history,
  seatHistory,
  currentLeader,
  currentParty,
  currentMargin,
  onClose
}: {
  result: ConstituencyResult;
  history: LeaderHistoryEntry[];
  seatHistory?: ConstituencyElectionHistory;
  currentLeader: string;
  currentParty: string;
  currentMargin: number;
  onClose: () => void;
}) {
  const timeline = useMemo(() => {
    const entries = [...history].reverse();
    const latest: LeaderHistoryEntry = {
      at: Date.now(),
      leader: currentLeader,
      party: currentParty,
      margin: currentMargin,
      status: result.statusText || result.roundStatus || "Latest"
    };
    const combined = [...entries, latest];
    return combined.filter((entry, index) => {
      const previous = combined[index - 1];
      return !previous || previous.leader !== entry.leader || previous.margin !== entry.margin || previous.status !== entry.status;
    });
  }, [currentLeader, currentMargin, currentParty, history, result.roundStatus, result.statusText]);
  const [index, setIndex] = useState(() => Math.max(0, timeline.length - 1));
  const [playing, setPlaying] = useState(false);
  const [tab, setTab] = useState<"live" | "history">("live");
  const active = timeline[Math.min(index, Math.max(0, timeline.length - 1))];
  const roundProgress = parseRoundProgress(result.roundStatus || result.statusText || "");
  const prediction = useMemo(() => calculatePrediction({
    leadingParty: currentParty,
    margin: currentMargin,
    leaderVotes: result.candidates[0]?.totalVotes ?? 0,
    trailingVotes: result.candidates[1]?.totalVotes ?? 0,
    roundsCounted: roundProgress?.current,
    totalRounds: roundProgress?.total,
    resultDeclared: isDeclaredWinner(result.statusText || result.roundStatus),
    previousWinnerParty: seatHistory?.entries[0]?.party,
    previousMargin: seatHistory?.entries[0]?.margin,
    leadChangedRecently: hasRecentLeadChange(history, currentLeader)
  }), [currentLeader, currentMargin, currentParty, history, result.candidates, roundProgress?.current, roundProgress?.total, seatHistory]);

  useEffect(() => {
    setTab("live");
  }, [result.constituencyId]);

  useEffect(() => {
    setIndex(Math.max(0, timeline.length - 1));
  }, [timeline.length]);

  useEffect(() => {
    if (!playing) return;
    if (index >= timeline.length - 1) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => setIndex((current) => Math.min(timeline.length - 1, current + 1)), 1100);
    return () => window.clearTimeout(timer);
  }, [index, playing, timeline.length]);

  return (
    <div className="fixed inset-0 z-[120] bg-black/35 px-4 py-6 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={`${result.constituencyName} timeline playback`} onClick={onClose}>
      <div className="ml-auto flex h-full w-full max-w-lg flex-col rounded-md border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950" onClick={(event) => event.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="min-w-0">
            <div className="text-[10px] font-black uppercase tracking-wide text-sky-700 dark:text-sky-300">Seat context</div>
            <h3 className="mt-1 truncate text-xl font-black text-zinc-950 dark:text-white">{result.constituencyName}</h3>
          </div>
          <button className="btn-press shrink-0 rounded-md border border-zinc-300 bg-white p-2 text-zinc-700 shadow-sm dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200" onClick={onClose} type="button" aria-label="Close timeline" title="Close timeline">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <div className="mb-4 inline-flex rounded-md border border-zinc-200 bg-zinc-100 p-1 dark:border-zinc-800 dark:bg-zinc-900">
            <button
              className={`rounded-md px-3 py-1.5 text-xs font-black transition ${tab === "live" ? "bg-white text-zinc-950 shadow-sm dark:bg-zinc-950 dark:text-white" : "text-zinc-500"}`}
              onClick={() => setTab("live")}
              type="button"
            >
              Live replay
            </button>
            <button
              className={`rounded-md px-3 py-1.5 text-xs font-black transition ${tab === "history" ? "bg-white text-zinc-950 shadow-sm dark:bg-zinc-950 dark:text-white" : "text-zinc-500"}`}
              onClick={() => setTab("history")}
              type="button"
            >
              Election history
            </button>
          </div>
          {tab === "live" ? (
            <>
          {active ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/40">
              <div className="text-[10px] font-black uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Replay point</div>
              <div className="mt-2 text-2xl font-black text-zinc-950 dark:text-white">{active.leader}</div>
              <div className="mt-1 text-sm font-bold text-zinc-600 dark:text-zinc-300">{shortPartyName(active.party)} leads by {formatNumber(active.margin)}</div>
              <div className="mt-1 text-xs font-semibold text-zinc-500">{active.status} · {new Date(active.at).toLocaleTimeString()}</div>
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm font-semibold text-zinc-500 dark:border-zinc-700">
              No timeline movement has been recorded in this browser yet.
            </div>
          )}
          <PredictionMeter prediction={prediction} />
          {timeline.length > 0 && (
            <>
              <div className="mt-4">
                <input
                  className="w-full accent-emerald-700"
                  type="range"
                  min={0}
                  max={Math.max(0, timeline.length - 1)}
                  value={index}
                  onChange={(event) => {
                    setPlaying(false);
                    setIndex(Number(event.target.value));
                  }}
                  aria-label="Timeline playback position"
                />
                <div className="mt-1 flex justify-between text-[10px] font-semibold text-zinc-500">
                  <span>Start</span>
                  <span>Latest</span>
                </div>
              </div>
              <button className="btn-press-dark mt-3 w-full rounded-md bg-zinc-950 px-3 py-2 text-sm font-black text-white dark:border dark:border-zinc-700 dark:bg-zinc-900" onClick={() => setPlaying((current) => !current)} type="button">
                {playing ? "Pause replay" : "Play replay"}
              </button>
            </>
          )}
              <div className="mt-4 space-y-2">
            {timeline.map((entry, itemIndex) => (
              <button
                key={`${entry.at}-${entry.leader}-${itemIndex}`}
                className={`block w-full rounded-md border px-3 py-2 text-left ${itemIndex === index ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40" : "border-zinc-200 dark:border-zinc-800"}`}
                onClick={() => {
                  setPlaying(false);
                  setIndex(itemIndex);
                }}
                type="button"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-black text-zinc-950 dark:text-white">{entry.leader}</div>
                    <div className="mt-0.5 text-xs font-semibold text-zinc-500">{shortPartyName(entry.party)} by {formatNumber(entry.margin)}</div>
                  </div>
                  <div className="shrink-0 text-right text-[10px] font-semibold text-zinc-500">{new Date(entry.at).toLocaleTimeString()}</div>
                </div>
              </button>
            ))}
              </div>
            </>
          ) : (
            <ConstituencyHistoryPanel history={seatHistory} result={result} />
          )}
        </div>
      </div>
    </div>
  );
}

function ConstituencyHistoryPanel({
  history,
  result
}: {
  history?: ConstituencyElectionHistory;
  result: ConstituencyResult;
}) {
  if (!history?.entries.length) {
    return (
      <div className="rounded-md border border-dashed border-zinc-300 p-6 text-center dark:border-zinc-700">
        <div className="text-sm font-black text-zinc-950 dark:text-white">No archived election history yet</div>
        <div className="mt-2 text-xs font-semibold text-zinc-500">
          We will show previous winners, margins, swing context, and notable leaders here once the archive dataset is added for {result.constituencyName}.
        </div>
      </div>
    );
  }

  const entries = history.entries.slice(0, 3);

  return (
    <div>
      <div className="rounded-md border border-sky-200 bg-sky-50 p-3 dark:border-sky-900 dark:bg-sky-950/30">
        <div className="text-[10px] font-black uppercase tracking-wide text-sky-700 dark:text-sky-300">Historical read</div>
        <div className="mt-2 text-lg font-black text-zinc-950 dark:text-white">{history.trendLabel || "Past election context"}</div>
        {history.contextNote && <div className="mt-1 text-sm font-semibold text-zinc-600 dark:text-zinc-300">{history.contextNote}</div>}
        {history.notableLeaders?.length ? (
          <div className="mt-2 text-xs font-semibold text-zinc-500">
            Notable leaders: {history.notableLeaders.join(", ")}
          </div>
        ) : null}
      </div>
      <div className="mt-4 space-y-3">
        {entries.map((entry) => (
          <div key={`${history.constituencyId}-${entry.year}`} className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] font-black uppercase tracking-wide text-zinc-500">{entry.year}</div>
                <div className="mt-1 text-sm font-black text-zinc-950 dark:text-white">{entry.winnerName}</div>
                <div className="mt-0.5 text-xs font-semibold text-zinc-500">{shortPartyName(entry.party)} beat {entry.runnerUpName}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] font-black uppercase tracking-wide text-zinc-500">Margin</div>
                <div className="mt-1 text-lg font-black text-emerald-700 dark:text-emerald-300">{formatNumber(entry.margin)}</div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-semibold text-zinc-500 sm:grid-cols-4">
              <div>
                <div className="uppercase tracking-wide">Winner</div>
                <div className="mt-1 text-sm font-black text-zinc-950 dark:text-white">{shortPartyName(entry.party)}</div>
              </div>
              <div>
                <div className="uppercase tracking-wide">Runner-up</div>
                <div className="mt-1 text-sm font-black text-zinc-950 dark:text-white">{shortPartyName(entry.runnerUpParty)}</div>
              </div>
              {entry.voteSharePercent != null && (
                <div>
                  <div className="uppercase tracking-wide">Vote share</div>
                  <div className="mt-1 text-sm font-black text-zinc-950 dark:text-white">{entry.voteSharePercent.toFixed(1)}%</div>
                </div>
              )}
              {entry.turnoutPercent != null && (
                <div>
                  <div className="uppercase tracking-wide">Turnout</div>
                  <div className="mt-1 text-sm font-black text-zinc-950 dark:text-white">{entry.turnoutPercent.toFixed(1)}%</div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

type PredictionInput = {
  leadingParty: string;
  margin: number;
  leaderVotes: number;
  trailingVotes: number;
  roundsCounted?: number;
  totalRounds?: number;
  resultDeclared?: boolean;
  previousWinnerParty?: string;
  previousMargin?: number;
  leadChangedRecently?: boolean;
};

type PredictionResult = {
  confidence: number;
  label: string;
  explanation: string[];
  leadingParty: string;
};

function PredictionMeter({ prediction }: { prediction: PredictionResult }) {
  const tone = predictionTone(prediction.confidence);
  return (
    <div className="mt-4 rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-black uppercase tracking-wide text-zinc-500">Prediction meter</div>
          <div className="mt-1 text-sm font-black text-zinc-950 dark:text-white">
            {shortPartyName(prediction.leadingParty)} {prediction.label.toLowerCase()} · {prediction.confidence}%
          </div>
        </div>
        <div className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${tone.badge}`}>
          {prediction.confidence}% confidence
        </div>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
        <div className={`h-full rounded-full bg-gradient-to-r ${tone.bar}`} style={{ width: `${prediction.confidence}%` }} />
      </div>
      <div className="mt-2 text-xs font-semibold text-zinc-600 dark:text-zinc-300">
        Based on current margin, counting progress, and previous result.
      </div>
      <div className="mt-3 space-y-1.5">
        {prediction.explanation.map((item) => (
          <div key={item} className="text-xs text-zinc-500 dark:text-zinc-400">
            {item}
          </div>
        ))}
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
  crowned = false,
  suppressImage = false
}: {
  candidateName: string;
  photoUrl?: string;
  size: "large" | "small" | "tiny" | "mini";
  tone?: "leading" | "trailing" | "neutral";
  crowned?: boolean;
  suppressImage?: boolean;
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
        {photoUrl && !suppressImage ? (
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
      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-emerald-700 text-white shadow-sm ring-1 ring-emerald-800" title={title} aria-label={title}>
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

function EmptyState({ onActivate }: { onActivate: () => void }) {
  return (
    <button
      className="w-full rounded-md border border-dashed border-zinc-300 p-10 text-center transition hover:border-emerald-400 hover:bg-emerald-50/40 dark:border-zinc-700 dark:hover:border-emerald-700 dark:hover:bg-emerald-950/20"
      onClick={onActivate}
      type="button"
    >
      <h2 className="text-xl font-bold">Choose constituencies or candidates to start tracking.</h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">Your watched seats and candidates stay saved in this browser.</p>
    </button>
  );
}

function sortResults(results: ConstituencyResult[], selectedIds: string[], sortMode: SortMode, pinnedIds: string[], attentionIds: string[] = []) {
  const selectedOrder = new Map(selectedIds.map((id, index) => [id, index]));
  const pinned = new Set(pinnedIds);
  const attention = new Set(attentionIds);
  return [...results].sort((a, b) => {
    const pinnedDelta = Number(pinned.has(b.constituencyId)) - Number(pinned.has(a.constituencyId));
    if (pinnedDelta) return pinnedDelta;
    const attentionDelta = Number(attention.has(b.constituencyId)) - Number(attention.has(a.constituencyId));
    if (attentionDelta) return attentionDelta;
    if (sortMode === "marginAsc") return a.margin - b.margin;
    if (sortMode === "marginDesc") return b.margin - a.margin;
    if (sortMode === "leader") return a.leadingCandidate.localeCompare(b.leadingCandidate);
    return (selectedOrder.get(a.constituencyId) ?? 0) - (selectedOrder.get(b.constituencyId) ?? 0);
  });
}

function latestDataUpdatedAt(values: number[]) {
  return Math.max(0, ...values.filter(Boolean));
}

function areStringArraysEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function isOldPreviewSource(sourceConfig?: PublicSourceConfig, activeProfile?: ElectionSourceProfile) {
  const sourceText = [
    activeProfile?.constituencyListUrl,
    activeProfile?.candidateDetailUrlTemplate,
    sourceConfig?.constituencyListUrl,
    sourceConfig?.candidateDetailUrlTemplate
  ].filter(Boolean).join(" ").toLowerCase();
  if (!sourceText) return true;
  return sourceText.includes("resultacgennov2025") || sourceText.includes("acresultgenjune2024");
}

function sourceDelayInMinutes(lastUpdated: string, checkedAt?: number) {
  if (!lastUpdated || !checkedAt) return 0;
  const parsed = Date.parse(lastUpdated);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor((checkedAt - parsed) / 60000));
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-IN").format(value || 0);
}

function formatDelta(value: number) {
  if (!value) return "0";
  return `${value > 0 ? "+" : ""}${formatNumber(value)}`;
}

function formatDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes || 1}m`;
}

function formatCountdown(ms: number) {
  const { days, hours, minutes, seconds } = countdownParts(ms);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function countdownParts(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return { days, hours, minutes, seconds };
}

function chatIdentityLabel(message: ChatMessage) {
  const name = message.displayName.trim();
  if (name) return name;
  return `Anonymous #${chatIdentityNumber(message.viewerId)}`;
}

function chatIdentityNumber(viewerId: string) {
  const value = Math.abs(hashString(viewerId));
  return String((value % 90) + 10);
}

function chatIdentityColor(viewerId: string) {
  const palette = [
    "#0f766e",
    "#1d4ed8",
    "#7c3aed",
    "#be123c",
    "#b45309",
    "#15803d",
    "#c2410c",
    "#4338ca"
  ];
  return palette[Math.abs(hashString(viewerId)) % palette.length];
}

function hashString(input: string) {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) - hash) + input.charCodeAt(index);
    hash |= 0;
  }
  return hash;
}

function raceConfidenceLabel(result: ConstituencyResult, countingPercent?: number) {
  if (isDeclaredWinner(result.statusText || result.roundStatus)) return "Declared";
  if ((countingPercent ?? 0) < 25) return "Too early";
  if (result.margin <= HIGH_TIGHT_MARGIN_LIMIT) return "Tight";
  if (result.margin <= TIGHT_MARGIN_LIMIT) return "Competitive";
  if ((countingPercent ?? 0) >= 75 && result.margin >= 10000) return "Likely safe";
  return "Leaning";
}

function confidenceClass(label: string) {
  if (label === "Declared") return "bg-emerald-100 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100";
  if (label === "Tight") return "bg-rose-100 text-rose-900 dark:bg-rose-900 dark:text-rose-100";
  if (label === "Competitive") return "bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100";
  return "bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200";
}

function changeInsightIcon(kind: ChangeInsight["kind"]) {
  if (kind === "leader") return "!";
  if (kind === "margin") return "+";
  return "*";
}

function changeInsightClass(kind: ChangeInsight["kind"]) {
  if (kind === "leader") return "bg-rose-50 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200";
  if (kind === "margin") return "bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200";
  return "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200";
}

function parseRoundProgress(value: string) {
  const match = value.match(/(\d+)\s*(?:\/|of)\s*(\d+)/i);
  if (!match) return null;
  const current = Number(match[1]);
  const total = Number(match[2]);
  if (!current || !total || current > total) return null;
  return { current, total };
}

function tightRaceProgressPercent(summary: ConstituencySummary) {
  const progress = parseRoundProgress(summary.roundStatus || summary.statusText || "");
  if (!progress) return null;
  return Math.min(100, Math.round((progress.current / progress.total) * 100));
}

function isNotificationWorthyTightRace(summary: ConstituencySummary) {
  if (summary.margin <= 0 || summary.margin > TIGHT_MARGIN_LIMIT) return false;
  if (isDeclaredWinner(summary.statusText || summary.roundStatus)) return true;

  const percent = tightRaceProgressPercent(summary);
  if (percent === null) return true;
  return percent >= TIGHT_RACE_NOTIFY_MIN_PROGRESS;
}

function tightRaceNotificationKey(summary: ConstituencySummary, demo: boolean) {
  const declared = isDeclaredWinner(summary.statusText || summary.roundStatus);
  const percent = tightRaceProgressPercent(summary);
  const stage = declared ? "declared" : percent === null ? "unknown" : `p${Math.floor(percent / 25) * 25}`;
  const severity = summary.margin <= HIGH_TIGHT_MARGIN_LIMIT ? "high" : "tight";
  const leader = normalizeKeyPart(summary.leadingCandidate || "leader");
  return `${demo ? "demo" : "live"}:${summary.constituencyId}:${stage}:${severity}:${leader}`;
}

function battlegroundSeverity(summary: ConstituencySummary) {
  const declared = isDeclaredWinner(summary.statusText || summary.roundStatus);
  if (summary.margin <= HIGH_TIGHT_MARGIN_LIMIT) {
    return {
      label: declared ? "Recount risk" : "Very tight",
      tone: "bg-rose-100 text-rose-900 dark:bg-rose-900/60 dark:text-rose-100"
    };
  }
  if (summary.margin <= 2500) {
    return {
      label: declared ? "Narrow result" : "Tight",
      tone: "bg-amber-100 text-amber-900 dark:bg-amber-900/60 dark:text-amber-100"
    };
  }
  return {
    label: declared ? "Declared" : "Competitive",
    tone: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
  };
}

function calculatePrediction(input: PredictionInput): PredictionResult {
  const countingCompleted = Boolean(
    input.resultDeclared ||
    (
      input.roundsCounted != null &&
      input.totalRounds != null &&
      input.totalRounds > 0 &&
      input.roundsCounted >= input.totalRounds
    )
  );

  if (countingCompleted && input.margin > 0) {
    return {
      confidence: 100,
      label: "Declared",
      leadingParty: input.leadingParty,
      explanation: [
        `Final margin: ${formatNumber(input.margin)} votes`,
        "Counting completed",
        "Result declared from the official update",
        "No further overtake risk in this race"
      ]
    };
  }

  const totalVotes = input.leaderVotes + input.trailingVotes;
  if (!totalVotes || input.margin <= 0) {
    return {
      confidence: 50,
      label: "Too close",
      leadingParty: input.leadingParty,
      explanation: ["Not enough vote data yet", "Waiting for a stronger lead signal"]
    };
  }

  const marginPercent = input.margin / totalVotes;
  const progress = input.roundsCounted && input.totalRounds
    ? Math.min(1, input.roundsCounted / input.totalRounds)
    : 0.4;

  const marginScore = Math.min(marginPercent / 0.08, 1);
  const progressScore = Math.min(progress, 1);

  let historyScore = 0.5;
  if (input.previousWinnerParty && normalizeKeyPart(input.previousWinnerParty) === normalizeKeyPart(input.leadingParty)) {
    historyScore = 0.75;
  }
  if (
    input.previousWinnerParty &&
    normalizeKeyPart(input.previousWinnerParty) === normalizeKeyPart(input.leadingParty) &&
    (input.previousMargin ?? 0) > 10000
  ) {
    historyScore = 0.9;
  }

  let confidence = marginScore * 60 + progressScore * 30 + historyScore * 10;
  if (input.leadChangedRecently) confidence -= 10;
  confidence = Math.max(50, Math.min(98, Math.round(confidence)));

  let label = "Too close";
  if (confidence >= 90) label = "Very likely";
  else if (confidence >= 75) label = "Likely";
  else if (confidence >= 60) label = "Leaning";

  return {
    confidence,
    label,
    leadingParty: input.leadingParty,
    explanation: [
      `Current margin: ${formatNumber(input.margin)} votes`,
      `Counting progress: ${Math.round(progress * 100)}%`,
      input.previousWinnerParty && normalizeKeyPart(input.previousWinnerParty) === normalizeKeyPart(input.leadingParty)
        ? "Same party won previously"
        : "Different party won previously",
      input.leadChangedRecently ? "Recent lead change detected" : "Lead appears stable"
    ]
  };
}

function predictionTone(confidence: number) {
  if (confidence >= 90) {
    return {
      badge: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-100",
      bar: "from-emerald-500 to-teal-500"
    };
  }
  if (confidence >= 75) {
    return {
      badge: "bg-sky-100 text-sky-900 dark:bg-sky-900/50 dark:text-sky-100",
      bar: "from-sky-500 to-cyan-500"
    };
  }
  if (confidence >= 60) {
    return {
      badge: "bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100",
      bar: "from-amber-500 to-yellow-500"
    };
  }
  return {
    badge: "bg-rose-100 text-rose-900 dark:bg-rose-900/50 dark:text-rose-100",
    bar: "from-rose-500 to-orange-500"
  };
}

function hasRecentLeadChange(history: LeaderHistoryEntry[], currentLeader: string) {
  const recent = history
    .filter((entry) => Date.now() - entry.at <= 30 * 60 * 1000)
    .map((entry) => normalizeCandidateName(entry.leader))
    .filter(Boolean);
  if (!recent.length) return false;
  return recent.some((leader) => leader !== normalizeCandidateName(currentLeader));
}

async function buildShareCardBlob(
  payload: ShareCardPayload,
  format: ShareCardFormat,
  exportNode?: HTMLElement | null
): Promise<Blob> {
  if (format === "square" && exportNode) {
    await document.fonts?.ready;
    const blob = await toImageBlob(exportNode, {
      cacheBust: true,
      pixelRatio: 1,
      canvasWidth: 1080,
      canvasHeight: 1080,
      backgroundColor: "#040914"
    });
    if (!blob) throw new Error("Could not generate constituency share image.");
    return blob;
  }
  const { width, height } = shareCardDimensions(format);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available.");

  const theme = shareTheme(payload);
  drawShareBackground(ctx, width, height, theme.primary, theme.secondary);

  if (payload.kind === "constituency") {
    await drawConstituencyShareCard(ctx, width, height, payload.result, payload.checkedAt, theme);
  } else if (payload.kind === "party-summary") {
    drawPartySummaryShareCard(ctx, width, height, payload.parties, payload.electionTitle, theme);
  } else if (payload.kind === "battleground") {
    drawBattlegroundShareCard(ctx, width, height, payload.races, payload.electionTitle, theme);
  } else {
    drawVictoryShareCard(ctx, width, height, payload.outcome, theme);
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error("Could not generate image."));
      else resolve(blob);
    }, "image/png");
  });
}

function shareCardDimensions(format: ShareCardFormat) {
  if (format === "story") return { width: 1080, height: 1920 };
  if (format === "landscape") return { width: 1200, height: 675 };
  return { width: 1080, height: 1080 };
}

function shareTheme(payload: ShareCardPayload) {
  if (payload.kind === "victory") {
    return { primary: payload.outcome.winner.color ?? "#166534", secondary: "#f59e0b" };
  }
  if (payload.kind === "party-summary") {
    return { primary: payload.parties[0]?.color ?? "#166534", secondary: payload.parties[1]?.color ?? "#0f766e" };
  }
  if (payload.kind === "constituency") {
    return {
      primary: payload.leftPartyColor ?? "#166534",
      secondary: payload.rightPartyColor ?? (payload.result.margin <= HIGH_TIGHT_MARGIN_LIMIT ? "#be123c" : "#0f766e")
    };
  }
  return { primary: "#d97706", secondary: "#be123c" };
}

function drawShareBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  primary: string,
  secondary: string
) {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "#050c17");
  gradient.addColorStop(0.55, "#02060e");
  gradient.addColorStop(1, "#02040a");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const leftRadial = ctx.createRadialGradient(0, height * 0.35, 20, 0, height * 0.35, width * 0.45);
  leftRadial.addColorStop(0, hexToRgba(primary, 0.42));
  leftRadial.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = leftRadial;
  ctx.fillRect(0, 0, width, height);

  const rightRadial = ctx.createRadialGradient(width, height * 0.35, 20, width, height * 0.35, width * 0.42);
  rightRadial.addColorStop(0, hexToRgba(secondary, 0.34));
  rightRadial.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = rightRadial;
  ctx.fillRect(0, 0, width, height);

  const centerGlow = ctx.createRadialGradient(width * 0.5, height * 0.28, 10, width * 0.5, height * 0.28, width * 0.24);
  centerGlow.addColorStop(0, "rgba(56,189,248,0.18)");
  centerGlow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = centerGlow;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "rgba(255,255,255,0.04)";
  ctx.fillRect(0, 0, width, height);
}

async function drawConstituencyShareCard(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  result: ConstituencyResult,
  checkedAt: number | undefined,
  theme: { primary: string; secondary: string }
) {
  if (width > height) {
    await drawConstituencyLandscapeShareCard(ctx, width, height, result, checkedAt, theme);
    return;
  }

  const padding = Math.round(width * 0.075);
  const contentWidth = width - padding * 2;
  const leader = result.candidates[0];
  const runner = result.candidates[1];
  const declared = isDeclaredWinner(result.statusText || result.roundStatus);
  const roundProgress = parseRoundProgress(result.roundStatus || result.statusText || "");
  const countingCompleted = roundProgress ? roundProgress.current >= roundProgress.total : declared;
  const status = declared ? "Result Declared" : result.margin <= HIGH_TIGHT_MARGIN_LIMIT ? "Very Tight" : result.margin <= TIGHT_MARGIN_LIMIT ? "Tight Race" : "Live Update";

  drawBrandLine(ctx, padding, padding, contentWidth, theme.primary);
  drawTitle(ctx, "ELECTION LIVE", padding, padding + 8, Math.round(width * 0.038), "#f8fafc");
  drawHeadline(ctx, `${result.constituencyName} Constituency`, padding, padding + 56, Math.round(width * 0.056), "#ffffff", contentWidth);
  drawSubHeadline(
    ctx,
    `${shortPartyName(result.leadingParty || leader?.party || "Leader")} ${declared ? "wins" : "leading"} by ${formatNumber(result.margin)} votes`,
    padding,
    padding + 116,
    Math.round(width * 0.034),
    "#cbd5e1",
    contentWidth
  );

  const photoY = padding + 170;
  await drawAvatarBlock(ctx, leader?.photoUrl, result.leadingCandidate || leader?.candidateName || "Leader", padding, photoY, Math.round(width * 0.11), theme.primary);
  await drawAvatarBlock(ctx, runner?.photoUrl, result.trailingCandidate || runner?.candidateName || "Runner-up", width - padding - Math.round(width * 0.11), photoY, Math.round(width * 0.085), theme.secondary);

  const nameX = padding + Math.round(width * 0.14);
  const runnerPhotoWidth = Math.round(width * 0.1);
  const leadPanelWidth = Math.max(180, width - nameX - padding - runnerPhotoWidth - 20);
  drawHeadline(ctx, truncateText(result.leadingCandidate || leader?.candidateName || "-", width >= 1200 ? 34 : 24), nameX, photoY + 18, Math.round(width * 0.042), "#ffffff", leadPanelWidth);
  drawSubHeadline(ctx, shortPartyName(result.leadingParty || leader?.party || "-"), nameX, photoY + 56, Math.round(width * 0.027), "#cbd5e1", leadPanelWidth);
  drawPill(ctx, status, nameX, photoY + 86, theme.secondary, "#ffffff");

  const scoreCardTop = photoY + Math.round(width * 0.14);
  drawStatBox(ctx, padding, scoreCardTop, contentWidth, Math.round(height * 0.14), "rgba(8,18,31,0.88)", "rgba(255,255,255,0.16)");
  drawMetricPair(ctx, "Lead", formatNumber(result.margin), padding + 28, scoreCardTop + 26, width * 0.32, theme.primary);
  drawMetricPair(ctx, "Leader", formatNumber(leader?.totalVotes ?? 0), padding + width * 0.36, scoreCardTop + 26, width * 0.25, "#ffffff");
  drawMetricPair(ctx, "Runner", formatNumber(runner?.totalVotes ?? 0), padding + width * 0.63, scoreCardTop + 26, width * 0.22, "#ffffff");

  const tableTop = scoreCardTop + Math.round(height * 0.19);
  drawDataRow(ctx, padding, tableTop, contentWidth, "Leader", truncateText(result.leadingCandidate || leader?.candidateName || "-", width >= 1200 ? 40 : 28), shortPartyName(result.leadingParty || leader?.party || "-"), theme.primary);
  drawDataRow(ctx, padding, tableTop + 90, contentWidth, "Runner-up", truncateText(result.trailingCandidate || runner?.candidateName || "-", width >= 1200 ? 40 : 28), shortPartyName(result.trailingParty || runner?.party || "-"), theme.secondary);

  const footerTop = height - padding - 160;
  const rounds = roundProgress ? `${roundProgress.current}/${roundProgress.total}` : result.roundStatus || "Live";
  drawFooterInfo(ctx, [
    `${countingCompleted ? "Counting completed" : "Counting progress"}: ${rounds}`,
    `Updated: ${checkedAt ? new Date(checkedAt).toLocaleTimeString() : result.lastUpdated || "Live"}`,
    "Powered by Onekeralam.in"
  ], padding, footerTop, contentWidth);
  drawWatermark(ctx, width, height, padding);
}

async function drawConstituencyLandscapeShareCard(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  result: ConstituencyResult,
  checkedAt: number | undefined,
  theme: { primary: string; secondary: string }
) {
  const padding = Math.round(width * 0.075);
  const contentWidth = width - padding * 2;
  const leader = result.candidates[0];
  const runner = result.candidates[1];
  const declared = isDeclaredWinner(result.statusText || result.roundStatus);
  const roundProgress = parseRoundProgress(result.roundStatus || result.statusText || "");
  const countingCompleted = roundProgress ? roundProgress.current >= roundProgress.total : declared;
  const rounds = roundProgress ? `${roundProgress.current}/${roundProgress.total}` : result.roundStatus || "Live";
  const leaderPhotoSize = 108;
  const runnerPhotoSize = 88;
  const topY = padding + 8;
  const textColumnWidth = Math.round(contentWidth * 0.56);
  const heroTop = padding + 138;
  const scoreTop = padding + 338;
  const detailTop = scoreTop + 108;
  const footerY = height - padding - 78;

  drawBrandLine(ctx, padding, padding, contentWidth, theme.primary);
  drawTitle(ctx, "ELECTION LIVE", padding, topY, 52, "#f8fafc");
  drawHeadline(ctx, result.constituencyName, padding, padding + 54, 72, "#ffffff", textColumnWidth);
  drawSubHeadline(ctx, "Constituency", padding, padding + 122, 26, "#94a3b8", textColumnWidth);
  drawSubHeadline(
    ctx,
    `${shortPartyName(result.leadingParty || leader?.party || "Leader")} ${declared ? "wins" : "leading"} by ${formatNumber(result.margin)} votes`,
    padding,
    padding + 154,
    28,
    "#cbd5e1",
    textColumnWidth
  );

  await drawAvatarBlock(ctx, leader?.photoUrl, result.leadingCandidate || leader?.candidateName || "Leader", padding, heroTop, leaderPhotoSize, theme.primary);
  const leaderTextX = padding + leaderPhotoSize + 24;
  drawHeadline(
    ctx,
    truncateText(result.leadingCandidate || leader?.candidateName || "-", 26),
    leaderTextX,
    heroTop + 8,
    52,
    "#ffffff",
    Math.round(contentWidth * 0.43)
  );
  drawSubHeadline(
    ctx,
    shortPartyName(result.leadingParty || leader?.party || "-"),
    leaderTextX,
    heroTop + 66,
    24,
    "#cbd5e1",
    Math.round(contentWidth * 0.26)
  );
  drawPill(ctx, declared ? "Result Declared" : "Live Update", leaderTextX, heroTop + 90, declared ? "#e11d48" : theme.secondary, "#ffffff", 220);

  const runnerPhotoX = width - padding - runnerPhotoSize;
  const runnerPhotoY = heroTop + 12;
  await drawAvatarBlock(ctx, runner?.photoUrl, result.trailingCandidate || runner?.candidateName || "Runner-up", runnerPhotoX, runnerPhotoY, runnerPhotoSize, theme.secondary);
  ctx.fillStyle = "#cbd5e1";
  ctx.font = "800 18px Inter, Arial, sans-serif";
  const runnerParty = shortPartyName(result.trailingParty || runner?.party || "Runner-up");
  const runnerPartyWidth = ctx.measureText(runnerParty).width;
  ctx.fillText(runnerParty, runnerPhotoX + runnerPhotoSize / 2 - runnerPartyWidth / 2, runnerPhotoY + 112);

  drawStatBox(ctx, padding, scoreTop, contentWidth, 82, "rgba(8,18,31,0.88)", "rgba(255,255,255,0.16)");
  drawMetricPair(ctx, "Lead", formatNumber(result.margin), padding + 26, scoreTop + 22, 160, theme.primary);
  drawMetricPair(ctx, "Leader", formatNumber(leader?.totalVotes ?? 0), padding + Math.round(contentWidth * 0.42), scoreTop + 22, 170, "#ffffff");
  drawMetricPair(ctx, "Runner", formatNumber(runner?.totalVotes ?? 0), padding + Math.round(contentWidth * 0.73), scoreTop + 22, 150, "#ffffff");

  drawDataRow(
    ctx,
    padding,
    detailTop,
    contentWidth,
    "Leader",
    truncateText(result.leadingCandidate || leader?.candidateName || "-", 36),
    shortPartyName(result.leadingParty || leader?.party || "-"),
    theme.primary
  );
  drawDataRow(
    ctx,
    padding,
    detailTop + 82,
    contentWidth,
    "Runner-up",
    truncateText(result.trailingCandidate || runner?.candidateName || "-", 36),
    shortPartyName(result.trailingParty || runner?.party || "-"),
    theme.secondary
  );

  drawFooterInfo(
    ctx,
    [
      `${countingCompleted ? "Counting completed" : "Counting progress"}: ${rounds}`,
      `Updated: ${checkedAt ? new Date(checkedAt).toLocaleTimeString() : result.lastUpdated || "Live"}`,
      "Powered by Onekeralam.in"
    ],
    padding,
    footerY,
    Math.round(contentWidth * 0.48)
  );
  drawWatermark(ctx, width, height, padding);
}

function drawPartySummaryShareCard(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  parties: PartySeatSummary[],
  electionTitle: string,
  theme: { primary: string; secondary: string }
) {
  const padding = Math.round(width * 0.075);
  const contentWidth = width - padding * 2;
  drawBrandLine(ctx, padding, padding, contentWidth, theme.primary);
  drawTitle(ctx, "ELECTION LIVE", padding, padding + 8, Math.round(width * 0.038), "#f8fafc");
  drawHeadline(ctx, electionTitle, padding, padding + 56, Math.round(width * 0.05), "#ffffff", contentWidth);
  drawSubHeadline(ctx, "Statewide party tally", padding, padding + 108, Math.round(width * 0.03), "#cbd5e1", contentWidth);

  const top = parties.slice(0, 6);
  let y = padding + 170;
  for (const party of top) {
    drawStatBox(ctx, padding, y, contentWidth, 92, "rgba(8,18,31,0.88)", "rgba(255,255,255,0.14)");
    ctx.fillStyle = party.color ?? "#64748b";
    ctx.fillRect(padding + 16, y + 16, 12, 60);
    drawSubHeadline(ctx, shortPartyName(party.party), padding + 44, y + 28, Math.round(width * 0.03), "#ffffff");
    drawMetricPair(ctx, "Total", formatNumber(party.total), padding + width * 0.42, y + 20, width * 0.15, party.color ?? "#166534");
    drawMetricPair(ctx, "Won", formatNumber(party.won), padding + width * 0.60, y + 20, width * 0.12, "#ffffff");
    drawMetricPair(ctx, "Lead", formatNumber(party.leading), padding + width * 0.76, y + 20, width * 0.12, "#ffffff");
    y += 108;
  }
  drawFooterInfo(ctx, ["Powered by Onekeralam.in"], padding, height - padding - 90, contentWidth);
  drawWatermark(ctx, width, height, padding);
}

function drawBattlegroundShareCard(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  races: ConstituencySummary[],
  electionTitle: string,
  theme: { primary: string; secondary: string }
) {
  const padding = Math.round(width * 0.075);
  const contentWidth = width - padding * 2;
  drawBrandLine(ctx, padding, padding, contentWidth, theme.primary);
  drawTitle(ctx, "BATTLEGROUND", padding, padding + 8, Math.round(width * 0.038), "#facc15");
  drawHeadline(ctx, electionTitle, padding, padding + 56, Math.round(width * 0.05), "#ffffff", contentWidth);
  drawSubHeadline(ctx, "Top closest races right now", padding, padding + 108, Math.round(width * 0.03), "#cbd5e1", contentWidth);

  let y = padding + 170;
  for (const summary of races.slice(0, 5)) {
    const severity = battlegroundSeverity(summary);
    drawStatBox(ctx, padding, y, contentWidth, 96, "rgba(8,18,31,0.88)", "rgba(255,255,255,0.14)");
    const pillWidth = 132;
    const raceTextWidth = Math.max(200, contentWidth - 36 - pillWidth - 16);
    drawHeadline(ctx, summary.constituencyName, padding + 18, y + 28, Math.round(width * 0.032), "#ffffff", raceTextWidth);
    drawSubHeadline(ctx, `${shortPartyName(summary.leadingParty || "Leader")} +${formatNumber(summary.margin)} vs ${shortPartyName(summary.trailingParty || "Runner-up")}`, padding + 18, y + 60, Math.round(width * 0.024), "#cbd5e1", raceTextWidth);
    drawPill(ctx, severity.label, padding + contentWidth - pillWidth - 18, y + 24, severity.label === "Very tight" || severity.label === "Recount risk" ? "#be123c" : "#d97706", "#ffffff", pillWidth);
    y += 106;
  }

  drawFooterInfo(ctx, ["Powered by Onekeralam.in"], padding, height - padding - 90, contentWidth);
  drawWatermark(ctx, width, height, padding);
}

function drawVictoryShareCard(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  outcome: {
    winner: PartySeatSummary;
    runnerUp?: PartySeatSummary;
    totalSeats: number;
    majorityMark: number;
    seatLead: number;
    closest?: ConstituencySummary;
    biggest?: ConstituencySummary;
    electionTitle: string;
  },
  theme: { primary: string; secondary: string }
) {
  const padding = Math.round(width * 0.075);
  const contentWidth = width - padding * 2;
  const centerX = width / 2;
  drawBrandLine(ctx, padding, padding, contentWidth, theme.primary);
  drawTitle(ctx, "FINAL RESULT", padding, padding + 8, Math.round(width * 0.038), "#facc15");
  drawHeadline(ctx, outcome.electionTitle, padding, padding + 56, Math.round(width * 0.05), "#ffffff", contentWidth);
  drawSubHeadline(ctx, "All constituencies declared", padding, padding + 108, Math.round(width * 0.03), "#cbd5e1", contentWidth);
  ctx.fillStyle = hexToRgba(theme.primary, 0.12);
  ctx.font = `900 ${Math.round(width * 0.13)}px Inter, Arial, sans-serif`;
  const winnerShort = shortPartyName(outcome.winner.party);
  const winnerGhostWidth = ctx.measureText(winnerShort).width;
  ctx.fillText(winnerShort, centerX - winnerGhostWidth / 2, padding + 262);

  ctx.fillStyle = "#ffffff";
  ctx.font = "900 34px Inter, Arial, sans-serif";
  const winnerLine = truncateTextToWidth(ctx, `${outcome.winner.party} wins ${formatNumber(outcome.winner.total)} seats`, contentWidth);
  const winnerLineWidth = ctx.measureText(winnerLine).width;
  ctx.fillText(winnerLine, centerX - winnerLineWidth / 2, padding + 304);

  drawStatBox(ctx, padding, padding + 352, contentWidth, 138, "rgba(8,18,31,0.88)", "rgba(255,255,255,0.14)");
  drawMetricPair(ctx, "Majority", formatNumber(outcome.majorityMark), padding + 28, padding + 386, width * 0.18, "#ffffff");
  drawMetricPair(ctx, "Seat lead", formatNumber(outcome.seatLead), padding + width * 0.33, padding + 386, width * 0.16, "#d97706");
  drawMetricPair(ctx, "Runner-up", outcome.runnerUp ? shortPartyName(outcome.runnerUp.party) : "-", padding + width * 0.57, padding + 386, width * 0.2, "#ffffff");

  drawFooterInfo(
    ctx,
    [
      outcome.closest ? `Closest: ${outcome.closest.constituencyName} (${formatNumber(outcome.closest.margin)})` : "",
      outcome.biggest ? `Biggest: ${outcome.biggest.constituencyName} (${formatNumber(outcome.biggest.margin)})` : "",
      "Powered by Onekeralam.in"
    ].filter(Boolean),
    padding,
    height - padding - 148,
    contentWidth
  );
  drawWatermark(ctx, width, height, padding);
}

function drawBrandLine(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, Math.min(width, 180), 8);
}

function drawTitle(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string) {
  ctx.fillStyle = color;
  ctx.font = `900 ${size}px Inter, Arial, sans-serif`;
  ctx.fillText(text, x, y + size);
}

function drawHeadline(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color = "#0f172a", maxWidth = 760) {
  ctx.fillStyle = color;
  ctx.font = `900 ${size}px Inter, Arial, sans-serif`;
  wrapText(ctx, text, x, y + size, size * 1.15, maxWidth);
}

function drawSubHeadline(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string, maxWidth = 780) {
  ctx.fillStyle = color;
  ctx.font = `700 ${size}px Inter, Arial, sans-serif`;
  wrapText(ctx, text, x, y + size, size * 1.3, maxWidth);
}

function drawPill(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, background: string, color: string, width?: number) {
  ctx.font = "900 26px Inter, Arial, sans-serif";
  const pillWidth = width ?? Math.ceil(ctx.measureText(text).width + 34);
  roundRect(ctx, x, y, pillWidth, 42, 21, background, background);
  ctx.fillStyle = color;
  ctx.fillText(text, x + 17, y + 29);
}

function drawStatBox(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, fill: string, stroke: string) {
  roundRect(ctx, x, y, width, height, 22, fill, stroke);
}

function drawMetricPair(ctx: CanvasRenderingContext2D, label: string, value: string, x: number, y: number, maxWidth: number, valueColor: string) {
  ctx.fillStyle = "rgba(255,255,255,0.66)";
  ctx.font = "800 20px Inter, Arial, sans-serif";
  ctx.fillText(label.toUpperCase(), x, y);
  ctx.fillStyle = valueColor;
  ctx.font = "900 36px Inter, Arial, sans-serif";
  const shortened = truncateTextToWidth(ctx, value, maxWidth);
  ctx.fillText(shortened, x, y + 42);
}

function drawDataRow(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, label: string, candidate: string, party: string, accent: string) {
  drawStatBox(ctx, x, y, width, 74, "rgba(8,18,31,0.88)", hexToRgba(accent, 0.35));
  ctx.fillStyle = accent;
  ctx.font = "900 18px Inter, Arial, sans-serif";
  ctx.fillText(label.toUpperCase(), x + 18, y + 24);
  ctx.fillStyle = "#ffffff";
  ctx.font = "900 28px Inter, Arial, sans-serif";
  ctx.fillText(truncateText(candidate, 34), x + 18, y + 54);
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.font = "700 20px Inter, Arial, sans-serif";
  ctx.fillText(party, x + width - 18 - Math.min(ctx.measureText(party).width, width * 0.3), y + 54);
}

function drawFooterInfo(ctx: CanvasRenderingContext2D, lines: string[], x: number, y: number, width: number) {
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.font = "700 22px Inter, Arial, sans-serif";
  lines.forEach((line, index) => {
    ctx.fillText(truncateTextToWidth(ctx, line, width), x, y + index * 30);
  });
}

function drawWatermark(ctx: CanvasRenderingContext2D, width: number, height: number, padding: number) {
  ctx.fillStyle = "rgba(255,255,255,0.58)";
  ctx.font = "700 18px Inter, Arial, sans-serif";
  const text = "results.onekeralam.in";
  const metrics = ctx.measureText(text);
  ctx.fillText(text, width - padding - metrics.width, height - padding + 8);
}

async function drawAvatarBlock(
  ctx: CanvasRenderingContext2D,
  photoUrl: string | undefined,
  name: string,
  x: number,
  y: number,
  size: number,
  ring: string
) {
  const image = await loadShareImage(photoUrl);
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (image) {
    ctx.drawImage(image, x, y, size, size);
  } else {
    ctx.fillStyle = "#e2e8f0";
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = "#334155";
    ctx.font = `900 ${Math.round(size * 0.34)}px Inter, Arial, sans-serif`;
    const text = initials(name);
    const metrics = ctx.measureText(text);
    ctx.fillText(text, x + size / 2 - metrics.width / 2, y + size / 2 + size * 0.12);
  }
  ctx.restore();
  ctx.strokeStyle = ring;
  ctx.lineWidth = Math.max(4, Math.round(size * 0.04));
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2 - 2, 0, Math.PI * 2);
  ctx.stroke();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, lineHeight: number, maxWidth: number) {
  const words = text.split(/\s+/);
  let line = "";
  let lineIndex = 0;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, y + lineIndex * lineHeight);
      line = word;
      lineIndex += 1;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, y + lineIndex * lineHeight);
}

function truncateTextToWidth(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let value = text;
  while (value.length > 3 && ctx.measureText(`${value}...`).width > maxWidth) {
    value = value.slice(0, -1);
  }
  return `${value}...`;
}

function truncateText(value: string, limit: number) {
  return value.length > limit ? `${value.slice(0, limit - 3)}...` : value;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fill: string,
  stroke: string
) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.stroke();
}

async function loadShareImage(url?: string): Promise<HTMLImageElement | null> {
  if (!url) return null;
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = toShareImageUrl(url);
  });
}

function hexToRgba(hex: string, alpha: number) {
  const normalized = hex.replace("#", "");
  if (normalized.length !== 6) return `rgba(15,23,42,${alpha})`;
  const value = Number.parseInt(normalized, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function shareCardFileName(payload: ShareCardPayload, format: ShareCardFormat) {
  const prefix = payload.kind === "constituency"
    ? slugify(payload.result.constituencyName)
    : payload.kind === "party-summary"
      ? "party-summary"
      : payload.kind === "battleground"
        ? "battleground"
        : "final-result";
  return `${prefix}-${format}.png`;
}

function proxyBattleShareCardAssets(props: ReturnType<typeof buildElectionBattleShareCardPropsFromResult>) {
  return {
    ...props,
    leftCandidatePhoto: props.leftCandidatePhoto ? toShareImageUrl(props.leftCandidatePhoto) : undefined,
    rightCandidatePhoto: props.rightCandidatePhoto ? toShareImageUrl(props.rightCandidatePhoto) : undefined,
    logoUrl: props.logoUrl ? toShareImageUrl(props.logoUrl) : undefined
  };
}

function convertTimelineEventsToLeaderHistory(timeline: ElectionTimelineEvent[]): LeaderHistoryEntry[] {
  return timeline
    .filter((event) => event.scope === "constituency" && event.candidateName && typeof event.margin === "number")
    .map((event) => ({
      at: Date.parse(event.time) || Date.now(),
      leader: event.candidateName || "-",
      party: event.partyCode || "-",
      margin: event.margin ?? 0,
      status: event.statusText || event.title || "Counting"
    }));
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "share-card";
}

function parseAppRouteFromLocation(): AppRoute {
  if (typeof window === "undefined") return { kind: "dashboard" };
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (path === "/about-us") return { kind: "about" };
  if (path === "/contact-us") return { kind: "contact" };
  if (path === "/terms-and-conditions") return { kind: "terms" };
  const match = path.match(/^\/constituency\/([^/]+)\/([^/]+)$/i);
  if (match) {
    return {
      kind: "constituency",
      stateSlug: decodeURIComponent(match[1]),
      constituencySlug: decodeURIComponent(match[2])
    };
  }
  return new URLSearchParams(window.location.search).get("view") === "help" ? { kind: "help" } : { kind: "dashboard" };
}

function buildConstituencyPath(stateName: string | undefined, constituencyName: string) {
  const stateSlug = slugify(stateName || "assembly");
  const constituencySlug = slugify(constituencyName);
  return `/constituency/${stateSlug}/${constituencySlug}`;
}

function buildConstituencySharePayloadFromDetail(
  detail: ConstituencyDetailResponse,
  electionTitle: string,
  partyColorsByKey: Map<string, string>
): ShareCardPayload {
  const candidates = detail.candidates.map((candidate, index) => ({
    serialNo: index + 1,
    candidateName: candidate.name,
    party: `${candidate.partyName} - ${candidate.partyCode}`,
    photoUrl: candidate.photoUrl,
    evmVotes: candidate.votes,
    postalVotes: 0,
    totalVotes: candidate.votes,
    votePercent: candidate.voteShare
  }));
  const result: ConstituencyResult = {
    constituencyId: detail.constituency.id,
    constituencyName: detail.constituency.name,
    constituencyNumber: detail.constituency.assemblyNumber,
    statusText: detail.result.statusText,
    roundStatus: detail.constituency.totalRounds ? `${detail.constituency.roundsCounted ?? 0}/${detail.constituency.totalRounds}` : detail.result.statusText,
    leadingCandidate: detail.candidates[0]?.name ?? "",
    leadingParty: `${detail.candidates[0]?.partyName ?? ""} - ${detail.candidates[0]?.partyCode ?? ""}`.trim(),
    trailingCandidate: detail.candidates[1]?.name ?? "",
    trailingParty: `${detail.candidates[1]?.partyName ?? ""} - ${detail.candidates[1]?.partyCode ?? ""}`.trim(),
    margin: detail.result.margin,
    totalVotes: detail.result.totalVotes || detail.candidates.reduce((sum, candidate) => sum + candidate.votes, 0),
    lastUpdated: detail.election.lastUpdated || new Date().toISOString(),
    candidates,
    sourceUrl: detail.result.sourceUrl || ""
  };
  return {
    kind: "constituency",
    result,
    checkedAt: detail.election.lastUpdated ? new Date(detail.election.lastUpdated).getTime() : Date.now(),
    electionTitle,
    leftPartyColor: partyColorsByKey.get(partyLookupKey(result.leadingParty || result.candidates[0]?.party || "")),
    rightPartyColor: partyColorsByKey.get(partyLookupKey(result.trailingParty || result.candidates[1]?.party || ""))
  };
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

function partyLookupKey(value: string) {
  return normalizeKeyPart(shortPartyName(value || "").trim());
}

function normalizeKeyPart(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function normalizeCandidateName(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}



