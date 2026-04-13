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
  refreshIntervalSeconds: number;
  updatedAt: string;
  updatedBy: string;
  activeProfileId?: string;
  profiles?: ElectionSourceProfile[];
};

export type PublicSourceConfig = {
  baseUrl: string;
  constituencyListUrl: string;
  candidateDetailUrlTemplate: string;
  refreshIntervalSeconds: number;
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
