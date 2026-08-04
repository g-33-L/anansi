/*
 * Typed client for the session-authenticated /console BFF. Cookies (httpOnly
 * session + readable CSRF) ride along via credentials:"include"; mutations echo the
 * anansi_csrf cookie back in the X-CSRF-Token header (double-submit).
 */

function readCookie(name: string): string | null {
  const escaped = name.replace(/[.$?*|{}()[\]\\/+^]/g, "\\$&");
  const m = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET" && method !== "HEAD") {
    const csrf = readCookie("anansi_csrf");
    if (csrf) headers["X-CSRF-Token"] = csrf;
  }
  const res = await fetch(path, {
    method,
    headers,
    credentials: "include",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = (text ? JSON.parse(text) : {}) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(res.status, (data.error as string) || res.statusText);
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
};

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  role: string;
}
export interface Me {
  user: { id: string; email: string; name: string | null; avatarUrl: string | null };
  activeOrganization: OrgSummary | null;
  organizations: OrgSummary[];
}
export interface MemberDto {
  membershipId: string;
  role: string;
  status: string;
  user: { id: string; email: string; name: string | null; avatarUrl: string | null; status: string };
}
export interface InviteDto {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
}
export interface TeamDto {
  id: string;
  name: string;
}
// Note: unlimited plan limits are Infinity server-side, which JSON serializes to null.
export interface UsageMetric {
  used: number;
  limit: number | null;
}
export interface UsageSummary {
  plan: string;
  month: string;
  queries: UsageMetric;
  messages: UsageMetric;
  channels: UsageMetric;
  apiIngest: UsageMetric;
  apiContext: UsageMetric;
}
export interface SearchHit {
  id: string;
  content: string;
  score: number;
  sourceType: string;
  createdAt: string;
}
export interface MemoryProfile {
  staticFacts: string[];
  dynamicContext: string[];
  temporalFacts: { fact: string; validFrom?: string | null; validUntil?: string | null }[];
  version: number;
  chunksSynthesized: number;
  lastSynthesizedAt: string | null;
}
export interface ApiKeyDto {
  id: string;
  name: string;
  lastUsedAt: string | null;
  createdAt: string;
  scopes: string[];
}

export type GroundedEvidence = SearchHit;
export interface ChatReply {
  answer: string;
  evidence: GroundedEvidence[];
}
export interface GraphNodeDto {
  id: string;
  name: string;
  entityType: string;
  firstSeenAt: string;
  lastSeenAt: string;
}
export interface GraphEdgeDto {
  id: string;
  fromEntityId: string;
  toEntityId: string;
  relationship: string;
  validFrom: string;
  validUntil: string | null;
  confidence: number;
}
export interface LedgerClaimDto {
  claim: string;
  claimKey: string | null;
  claimType: string;
  status: string;
  disputed: boolean;
  confidence: number;
  validFrom: string | null;
  recordedAt: string;
  evidence: { chunkId: string; quote: string; source?: string; sourceType?: string }[];
}
export interface TimelineEntryDto {
  at: string;
  claimKey: string | null;
  claim: string;
  fingerprint: string;
  kind: "adopted" | "superseded";
}
export interface DivergenceDto {
  claimKey: string;
  documented: { claim: string; validFrom: string | null };
  observed: { claim: string; validFrom: string | null };
  changedAt: string | null;
}
export interface ProcedureDto {
  id: string;
  title: string;
  description: string;
  domain: string;
  status: string;
  currentVersion: string | null;
  updatedAt: string;
  publishedAt: string | null;
  confidenceScore: number | null;
  steps: { id?: string; description?: string }[] | null;
}
export interface SourceSummaryDto {
  sourceType: string;
  count: number;
  latestAt: string | null;
}
export interface SourceChunkDto {
  id: string;
  sourceType: string;
  sourceId: string;
  content: string;
  createdAt: string;
}
export interface ConnectorDto {
  provider: "notion" | "google_docs" | "linear" | "transcript_webhook";
  expiresAt: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
}
export interface BillingSummary {
  plan: string;
  displayName: string;
  status: string;
  currentPeriodEnd: string | null;
  monthlyPriceUsd: number;
  supportTier: string;
}

// ── Ops plane (Phase 8, staff-only) ───────────────────────────────────────────
export interface QueueHealth {
  name: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  oldestWaitingAgeMs: number | null;
}
export interface OpsHealth {
  status: "ok" | "degraded" | "down";
  version: string;
  deployment: { mode: string; release: string; environment: string };
  dependencies: { name: string; status: "ok" | "down"; latencyMs: number | null }[];
  queues: QueueHealth[];
  generatedAt: string;
}

// ── /console endpoints ────────────────────────────────────────────────────────

export const consoleApi = {
  me: () => api.get<Me>("/console/me"),
  updateProfile: (b: { name?: string; avatarUrl?: string }) =>
    api.patch<{ user: Me["user"] }>("/console/me", b),

  requestMagicLink: (email: string) =>
    api.post<{ ok: true; devUrl?: string }>("/console/auth/magic-link", { email }),
  logout: () => api.post<{ ok: true }>("/console/auth/logout"),

  listOrganizations: () => api.get<{ organizations: OrgSummary[] }>("/console/organizations"),
  createOrganization: (name: string) =>
    api.post<{ organization: OrgSummary }>("/console/organizations", { name }),
  switchOrganization: (organizationId: string) =>
    api.post<{ organization: OrgSummary | null }>("/console/organizations/switch", { organizationId }),
  updateOrganization: (name: string) =>
    api.patch<{ organization: OrgSummary }>("/console/organizations/current", { name }),

  listMembers: () => api.get<{ members: MemberDto[] }>("/console/organizations/members"),
  updateMemberRole: (membershipId: string, role: string) =>
    api.patch(`/console/organizations/members/${membershipId}`, { role }),
  removeMember: (membershipId: string) =>
    api.del(`/console/organizations/members/${membershipId}`),

  listInvitations: () => api.get<{ invitations: InviteDto[] }>("/console/organizations/invitations"),
  invite: (email: string, role: string) =>
    api.post<{ invitation: InviteDto; acceptUrl?: string }>("/console/organizations/invitations", { email, role }),
  revokeInvitation: (id: string) => api.del(`/console/organizations/invitations/${id}`),

  listTeams: () => api.get<{ teams: TeamDto[] }>("/console/teams"),
  createTeam: (name: string) => api.post<{ team: TeamDto }>("/console/teams", { name }),
  deleteTeam: (id: string) => api.del(`/console/teams/${id}`),

  usage: () => api.get<{ usage: UsageSummary }>("/console/usage"),
  search: (q: string) => api.post<{ results: SearchHit[] }>("/console/search", { q }),
  memory: () => api.get<{ profile: MemoryProfile | null }>("/console/memory"),
  chat: (message: string) => api.post<ChatReply>("/console/chat", { message }),
  graph: () => api.get<{ nodes: GraphNodeDto[]; edges: GraphEdgeDto[] }>("/console/graph"),
  ledger: () =>
    api.get<{ ledger: { claims: LedgerClaimDto[] }; timeline: TimelineEntryDto[]; divergences: DivergenceDto[] }>("/console/ledger"),
  procedures: () => api.get<{ procedures: ProcedureDto[] }>("/console/procedures"),
  people: () => api.get<{ users: { id: string; externalId: string; optedOut: boolean; createdAt: string }[]; entities: Pick<GraphNodeDto, "id" | "name" | "firstSeenAt" | "lastSeenAt">[] }>("/console/people"),
  sources: () => api.get<{ sourceTypes: SourceSummaryDto[]; recent: SourceChunkDto[] }>("/console/sources"),
  connectors: () => api.get<{ connectors: ConnectorDto[] }>("/console/connectors"),
  billing: () => api.get<{ subscription: BillingSummary }>("/console/billing"),

  listApiKeys: () => api.get<{ keys: ApiKeyDto[] }>("/console/api-keys"),
  createApiKey: (name: string, scopes: string[]) =>
    api.post<{ key: ApiKeyDto; secret: string }>("/console/api-keys", { name, scopes }),
  revokeApiKey: (id: string) => api.del(`/console/api-keys/${id}`),

};
