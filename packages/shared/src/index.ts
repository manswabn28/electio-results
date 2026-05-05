export type CandidateResult = {
  serialNo: number;
  candidateName: string;
  party: string;
  photoUrl?: string;
  evmVotes: number;
  postalVotes: number;
  totalVotes: number;
  votePercent: number;
};

export type ConstituencyResult = {
  constituencyId: string;
  constituencyName: string;
  constituencyNumber: string;
  statusText: string;
  roundStatus: string;
  leadingCandidate: string;
  leadingParty: string;
  trailingCandidate: string;
  trailingParty: string;
  margin: number;
  totalVotes: number;
  lastUpdated: string;
  candidates: CandidateResult[];
  sourceUrl: string;
};

export type ConstituencySummary = {
  constituencyId: string;
  constituencyName: string;
  constituencyNumber: string;
  statusText: string;
  roundStatus: string;
  leadingCandidate: string;
  leadingParty: string;
  trailingCandidate: string;
  trailingParty: string;
  margin: number;
  sourceUrl?: string;
};

export type ConstituencyOption = {
  constituencyId: string;
  constituencyName: string;
  constituencyNumber: string;
  sourceUrl?: string;
  isFavoriteDefault?: boolean;
};

export type CandidateOption = {
  candidateId: string;
  candidateName: string;
  party: string;
  photoUrl?: string;
  constituencyId: string;
  constituencyName: string;
  constituencyNumber: string;
};

export type ResultsSummaryResponse = {
  generatedAt: string;
  sourceConfigured: boolean;
  sourceUrl?: string;
  results: ConstituencySummary[];
  errors: ApiError[];
};

export type ResultsDetailsResponse = {
  generatedAt: string;
  sourceConfigured: boolean;
  results: ConstituencyResult[];
  errors: ApiError[];
};

export type ConstituenciesResponse = {
  generatedAt: string;
  sourceConfigured: boolean;
  sourceUrl?: string;
  constituencies: ConstituencyOption[];
  warning?: string;
};

export type CandidatesResponse = {
  generatedAt: string;
  sourceConfigured: boolean;
  sourceUrl?: string;
  candidates: CandidateOption[];
  errors: ApiError[];
};

export type ApiError = {
  constituencyId?: string;
  message: string;
  code?: string;
};

export type ResultEnvelope<T> = {
  generatedAt: string;
  sourceConfigured: boolean;
  data: T;
  error?: ApiError;
};

export type HealthResponse = {
  ok: boolean;
  service: string;
  timestamp: string;
  sourceConfigured: boolean;
};

export type SourceDiagnosticsResponse = {
  generatedAt: string;
  sourceConfigured: boolean;
  uptimeSeconds: number;
  cacheTtlSeconds: number;
  sourceUrl?: string;
  constituencyCount: number;
  sampleDetailCount: number;
  sampleCandidateCount: number;
  partySummaryCount: number;
  errors: ApiError[];
};

export type SortMode = "selected" | "marginAsc" | "marginDesc" | "leader";

export type SourceConfig = {
  baseUrl: string;
  constituencyListUrl: string;
  candidateDetailUrlTemplate: string;
  partySummaryUrl?: string;
  refreshIntervalSeconds: number;
  hidePreviewBanner: boolean;
  hideCountdown: boolean;
  updatedAt: string;
  updatedBy: string;
  activeProfileId?: string;
  profiles?: ElectionSourceProfile[];
};

export type PublicSourceConfig = {
  baseUrl: string;
  constituencyListUrl: string;
  candidateDetailUrlTemplate: string;
  partySummaryUrl?: string;
  refreshIntervalSeconds: number;
  hidePreviewBanner: boolean;
  hideCountdown: boolean;
  updatedAt: string;
  updatedBy: string;
  adminEnabled: boolean;
  activeProfileId?: string;
  activeTitle?: string;
  profiles?: ElectionSourceProfile[];
};

export type DiscoveredSource = {
  confidence: number;
  status: "idle" | "running" | "found" | "applied" | "skipped" | "failed";
  checkedAt?: string;
  appliedAt?: string;
  eventFolderUrl?: string;
  constituencyListUrl?: string;
  candidateDetailUrlTemplate?: string;
  partySummaryUrl?: string;
  stateName?: string;
  constituencyCount?: number;
  sampleVerified?: boolean;
  alreadyCurrent?: boolean;
  autoApplied?: boolean;
  previousAvailable?: boolean;
  profiles?: ElectionSourceProfile[];
  trail?: DiscoveryTrailItem[];
  warnings: string[];
  message: string;
  schedule: {
    enabled: boolean;
    timezone: string;
    startAt: string;
    intenseStartAt: string;
    endAt: string;
    normalIntervalSeconds: number;
    intenseIntervalSeconds: number;
    nextRunAt?: string;
    activeNow: boolean;
  };
};

export type DiscoveryTrailItem = {
  time: string;
  status: "running" | "success" | "warning" | "error";
  message: string;
  details?: string[];
};

export type ElectionSourceProfile = {
  profileId: string;
  stateName: string;
  electionTitle: string;
  eventFolderUrl: string;
  constituencyListUrl: string;
  candidateDetailUrlTemplate: string;
  partySummaryUrl?: string;
  constituencyCount: number;
  confidence: number;
  sampleVerified: boolean;
  enabled: boolean;
  updatedAt: string;
};

export type PartySeatSummary = {
  party: string;
  won: number;
  leading: number;
  total: number;
  color?: string;
};

export type PartySummaryResponse = {
  generatedAt: string;
  sourceUrl: string;
  parties: PartySeatSummary[];
};

export type TrafficResponse = {
  generatedAt: string;
  watchingNow: number;
  totalViews: number;
};

export type ConstituencyElectionHistoryEntry = {
  year: number;
  winnerName: string;
  party: string;
  alliance?: string;
  votes?: number;
  voteSharePercent?: number;
  runnerUpName: string;
  runnerUpParty: string;
  runnerUpVotes?: number;
  margin: number;
  turnoutPercent?: number;
};

export type ConstituencyElectionHistory = {
  constituencyId: string;
  constituencyNumber: string;
  constituencyName: string;
  trendLabel?: string;
  contextNote?: string;
  notableLeaders?: string[];
  entries: ConstituencyElectionHistoryEntry[];
};

export type ConstituencyHistoryResponse = {
  generatedAt: string;
  profileId?: string;
  histories: ConstituencyElectionHistory[];
};

export type ChatMessage = {
  id: string;
  profileId: string;
  viewerId: string;
  displayName: string;
  isAdmin?: boolean;
  message: string;
  createdAt: string;
  deleted?: boolean;
};

export type ChatMessagesResponse = {
  generatedAt: string;
  messages: ChatMessage[];
};

export type TelegramAlertRules = {
  leadChange: boolean;
  winnerDeclared: boolean;
  marginBelow500: boolean;
  majorityCrossed: boolean;
};

export type TelegramSubscriptionLinkResponse = {
  generatedAt: string;
  enabled: boolean;
  botUsername?: string;
  botUrl?: string;
  linked: boolean;
  pendingCode?: string;
};

export type TelegramSubscriptionStatusResponse = {
  generatedAt: string;
  enabled: boolean;
  botUsername?: string;
  linked: boolean;
  viewerId: string;
  profileId: string;
  chatId?: string;
  chatLabel?: string;
  rules?: TelegramAlertRules;
  selectedCount?: number;
};

export type ConstituencyDetailCandidate = {
  id: string;
  name: string;
  partyCode: string;
  partyName: string;
  votes: number;
  voteShare: number;
  rank: number;
  photoUrl?: string;
  status: "won" | "leading" | "runner-up" | "trailing" | "lost";
  marginFromLeader?: number;
};

export type ConstituencyDetailTimelineItem = {
  id: string;
  time: string;
  type: "counting-started" | "update" | "lead-change" | "tight-race" | "milestone" | "winner";
  title: string;
  description: string;
  candidateId?: string;
  partyCode?: string;
};

export type ElectionTimelineEvent = ConstituencyDetailTimelineItem & {
  profileId: string;
  constituencyId?: string;
  constituencyName?: string;
  candidateName?: string;
  margin?: number;
  declared?: boolean;
  roundsCounted?: number;
  totalRounds?: number;
  statusText?: string;
  scope: "constituency" | "profile";
};

export type ConstituencyTimelineResponse = {
  generatedAt: string;
  profileId?: string;
  constituencyId: string;
  timeline: ElectionTimelineEvent[];
};

export type ConstituencyTimelineBatchResponse = {
  generatedAt: string;
  profileId?: string;
  timelines: Record<string, ElectionTimelineEvent[]>;
};

export type ProfileTimelineResponse = {
  generatedAt: string;
  profileId?: string;
  timeline: ElectionTimelineEvent[];
};

export type ConstituencyDetailInsights = {
  seatType?: string;
  historicalLean?: string;
  closestPastMargin?: number;
  biggestPastMargin?: number;
  previousWinnerParty?: string;
  previousWinnerName?: string;
  volatilityScore?: "low" | "medium" | "high";
  turnout?: number;
  totalCandidates: number;
  leadStability?: "stable" | "swinging";
};

export type ConstituencyDetailResponse = {
  generatedAt: string;
  profileId?: string;
  election: {
    id: string;
    name: string;
    year?: number;
    stateName: string;
    stateSlug: string;
    status: "live" | "final" | "awaiting";
    lastUpdated?: string;
  };
  constituency: {
    id: string;
    name: string;
    slug: string;
    district?: string;
    assemblyNumber: string;
    totalRounds?: number;
    roundsCounted?: number;
    status: "live" | "final" | "awaiting";
  };
  result: {
    leadingCandidateId?: string;
    runnerUpCandidateId?: string;
    winnerCandidateId?: string;
    margin: number;
    marginStatus: string;
    declared: boolean;
    leadChangedRecently: boolean;
    previousLeaderCandidateId?: string;
    totalVotes: number;
    statusText: string;
    sourceUrl?: string;
  };
  candidates: ConstituencyDetailCandidate[];
  history: ConstituencyElectionHistoryEntry[];
  timeline: ConstituencyDetailTimelineItem[];
  insights: ConstituencyDetailInsights;
};
