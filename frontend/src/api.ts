const API_BASE = "/api";

export type ContextInfo = { name: string; current: boolean };
export type ResourceItem = {
  name: string;
  namespace: string | null;
  kind: string;
};
export type HealthResponse = {
  status: string;
  kube_connected: boolean;
  llm_configured: boolean;
  llm_provider: string; // "groq" | "openai_compatible" for display as Groq / Local
};

export type RootCauseItem = {
  cause: string;
  confidence: string;
  evidence_refs: string[];
};
export type HeuristicCandidateItem = {
  cause: string;
  confidence: string;
  evidence_refs: string[];
};
export type HeuristicConditionItem = {
  condition: string;
  evidence_refs: string[];
  candidates: HeuristicCandidateItem[];
};
export type WhyItem = { ref: string; explanation: string };
export type AnalysisJson = {
  summary: string;
  likely_root_causes: RootCauseItem[];
  recommended_actions: string[];
  kubectl_commands: string[];
  follow_up_questions: string[];
  risk_notes: string[];
  heuristics?: HeuristicConditionItem[];
  why?: WhyItem[];
  uncertain?: string[];
};
export type TruncationReport = {
  truncated: boolean;
  sections_truncated: string[];
  total_chars_before: number;
  total_chars_after: number;
};
export type AnalyzeResponse = {
  analysis_json: AnalysisJson;
  analysis_markdown: string;
  evidence: Record<string, unknown>;
  truncation_report: TruncationReport;
  tokens_used: number;
  response_time_ms: number;
  error: string | null;
};
export type HistoryItem = {
  id: string;
  created_at: string;
  context: string | null;
  namespace: string | null;
  kind: string;
  name: string;
  error: string | null;
};

// Scan
export type ScanRequest = {
  context?: string;
  scope: "namespace" | "cluster";
  namespace?: string;
  include_logs?: boolean;
};
export type ScanFindingItem = {
  id: string;
  severity: string;
  category: string;
  title: string;
  description: string | null;
  affected_refs: { kind?: string; namespace?: string; name?: string }[];
  evidence_refs: string[];
  suggested_commands: string[];
  evidence_snippet: string | null;
  occurred_at?: string | null;
};
export type ScanResponse = {
  id: string;
  created_at?: string | null;
  summary_markdown: string | null;
  error: string | null;
  findings: ScanFindingItem[];
  counts: Record<string, number>;
  duration_ms?: number | null;
};
export type ScanListItem = {
  id: string;
  created_at: string;
  context: string | null;
  scope: string;
  namespace: string | null;
  findings_count: number;
  error: string | null;
};
export type ScanDetail = ScanListItem & {
  summary_markdown: string | null;
  findings: ScanFindingItem[];
};

// Compare
export type CompareChangeItem = {
  type: string;
  path: string;
  before: unknown;
  after: unknown;
  impact: string;
};
export type CompareResponse = {
  diff_summary: string;
  changes: CompareChangeItem[];
  likely_reasoning: string;
  analysis_a: {
    id: string;
    created_at: string;
    kind: string;
    name: string;
    namespace: string | null;
    kubectl_commands?: string[];
  };
  analysis_b: {
    id: string;
    created_at: string;
    kind: string;
    name: string;
    namespace: string | null;
    kubectl_commands?: string[];
  };
  error: string | null;
};

async function get<T>(
  path: string,
  params?: Record<string, string>,
): Promise<T> {
  const url = new URL(API_BASE + path, window.location.origin);
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      // Only add non-empty values to avoid sending "undefined" or empty strings
      if (v && v !== "undefined" && v !== "") {
        url.searchParams.set(k, v);
      }
    });
  }
  const r = await fetch(url.toString());
  if (!r.ok) {
    const t = await r.text();
    throw new Error(t || r.statusText);
  }
  const json = await r.json();
  // Debug logging for namespaces endpoint
  if (path === "/namespaces") {
    console.log("[api.get] Received response for /namespaces:", {
      url: url.toString(),
      responseType: Array.isArray(json) ? "array" : typeof json,
      length: Array.isArray(json) ? json.length : "N/A",
      data: json,
    });
  }
  return json as T;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(API_BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(t || r.statusText);
  }
  return r.json() as Promise<T>;
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(API_BASE + path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(t || r.statusText);
  }
  return r.json() as Promise<T>;
}

async function del<T>(path: string): Promise<T> {
  const url = new URL(API_BASE + path, window.location.origin);
  const r = await fetch(url.toString(), { method: "DELETE" });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(t || r.statusText);
  }
  // Handle empty response (204 No Content) or JSON response
  const text = await r.text();
  if (!text) {
    return {} as T;
  }
  return JSON.parse(text) as T;
}

export const api = {
  health: () => get<HealthResponse>("/health"),
  contexts: () => get<ContextInfo[]>("/contexts"),
  namespaces: (context?: string, noCache?: boolean) =>
    get<string[]>("/namespaces", {
      ...(context ? { context } : {}),
      ...(noCache ? { no_cache: "true" } : {}),
    }),
  resources: (params: { namespace?: string; kind: string; context?: string }) =>
    get<ResourceItem[]>("/resources", params as Record<string, string>),
  analyze: (body: {
    context?: string;
    namespace?: string;
    kind: string;
    name: string;
    include_previous_logs?: boolean;
  }) => post<AnalyzeResponse>("/analyze", body),
  history: (limit?: number, context?: string) =>
    get<HistoryItem[]>("/history", {
      ...(limit != null ? { limit: String(limit) } : {}),
      ...(context ? { context } : {}),
    }),
  historyGet: (id: string) =>
    get<
      HistoryItem & {
        analysis_markdown?: string;
        analysis_json?: AnalysisJson;
        evidence_summary?: string;
      }
    >(`/history/${id}`),
  historyDelete: (id: string) => del<{ message: string }>(`/history/${id}`),
  analysisExplain: (analysisId: string) =>
    get<{
      analysis_id: string;
      heuristics: HeuristicConditionItem[];
      why: WhyItem[];
      uncertain: string[];
    }>(`/analysis/${analysisId}/explain`),
  compare: (body: { analysis_id_a: string; analysis_id_b: string }) =>
    post<CompareResponse>("/compare", body),
  scan: (body: ScanRequest) => post<ScanResponse>("/scan", body),
  scans: (limit?: number) =>
    get<ScanListItem[]>(
      "/scans",
      limit != null ? { limit: String(limit) } : undefined,
    ),
  scanGet: (id: string) => get<ScanDetail>(`/scans/${id}`),

  // Incidents
  incidents: (limit?: number) =>
    get<IncidentListItem[]>(
      "/incidents",
      limit != null ? { limit: String(limit) } : undefined,
    ),
  incidentGet: (id: string) => get<IncidentDetail>(`/incidents/${id}`),
  incidentDelete: (id: string) => del<{ message: string }>(`/incidents/${id}`),
  incidentCreate: (body: CreateIncidentRequest) =>
    post<{ id: string }>("/incidents", body),
  incidentAddItem: (incidentId: string, body: AddIncidentItemRequest) =>
    post<{ id: string }>(`/incidents/${incidentId}/add`, body),
  incidentAddNote: (incidentId: string, content: string) =>
    post<{ id: string }>(`/incidents/${incidentId}/notes`, { content }),
  incidentExport: async (
    incidentId: string,
    format: "markdown" | "json",
  ): Promise<string> => {
    const r = await fetch(API_BASE + `/incidents/${incidentId}/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format }),
    });
    if (!r.ok) {
      const t = await r.text();
      throw new Error(t || r.statusText);
    }
    return r.text();
  },

  schedules: (limit?: number) =>
    get<ScheduleListItem[]>(
      "/schedules",
      limit != null ? { limit: String(limit) } : undefined,
    ),
  scheduleGet: (id: string) => get<ScheduleListItem>(`/schedules/${id}`),
  scheduleCreate: (body: CreateScheduleRequest) =>
    post<{ id: string }>("/schedules", body),
  scheduleUpdate: (id: string, body: UpdateScheduleRequest) =>
    put<ScheduleListItem>(`/schedules/${id}`, body),
  scheduleDelete: (id: string) => del(`/schedules/${id}`),
};

export type CreateScheduleRequest = {
  context?: string;
  scope: "namespace" | "cluster";
  namespace?: string;
  cron: string;
  enabled?: boolean;
};
export type UpdateScheduleRequest = {
  context?: string;
  scope?: "namespace" | "cluster";
  namespace?: string;
  cron?: string;
  enabled?: boolean;
};
export type ScheduleListItem = {
  id: string;
  created_at: string;
  context: string | null;
  scope: string;
  namespace: string | null;
  cron: string;
  enabled: boolean;
};

export type CreateIncidentRequest = {
  title: string;
  description?: string;
  severity?: string;
  tags?: string[];
};
export type AddIncidentItemRequest = {
  type: "analysis" | "scan";
  ref_id: string;
};
export type IncidentListItem = {
  id: string;
  created_at: string;
  title: string;
  description: string | null;
  severity: string | null;
  tags: string[];
  status: string;
};
export type IncidentDetail = IncidentListItem & {
  items: {
    id: string;
    item_type: string;
    ref_id: string;
    created_at: string;
  }[];
  notes: { id: string; content: string; created_at: string }[];
  timeline: {
    type: string;
    created_at?: string;
    item_type?: string;
    ref_id?: string;
    content?: string;
  }[];
};
