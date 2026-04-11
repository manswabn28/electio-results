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

export type ResultsSummaryResponse = {
  generatedAt: string;
  sourceConfigured: boolean;
  sourceUrl?: string;
  results: ConstituencySummary[];
  errors: ApiError[];
};

export type ConstituenciesResponse = {
  generatedAt: string;
  sourceConfigured: boolean;
  sourceUrl?: string;
  constituencies: ConstituencyOption[];
  warning?: string;
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

export type SortMode = "selected" | "marginAsc" | "marginDesc" | "leader";

export type SourceConfig = {
  baseUrl: string;
  constituencyListUrl: string;
  candidateDetailUrlTemplate: string;
  refreshIntervalSeconds: number;
  updatedAt: string;
  updatedBy: string;
};

export type PublicSourceConfig = {
  baseUrl: string;
  constituencyListUrl: string;
  candidateDetailUrlTemplate: string;
  refreshIntervalSeconds: number;
  updatedAt: string;
  updatedBy: string;
  adminEnabled: boolean;
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
