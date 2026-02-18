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
};

export type RootCauseItem = {
  cause: string;
  confidence: string;
  evidence_refs: string[];
};
export type AnalysisJson = {
  summary: string;
  likely_root_causes: RootCauseItem[];
  recommended_actions: string[];
  kubectl_commands: string[];
  follow_up_questions: string[];
  risk_notes: string[];
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
  return r.json() as Promise<T>;
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

export const api = {
  health: () => get<HealthResponse>("/health"),
  contexts: () => get<ContextInfo[]>("/contexts"),
  namespaces: (context?: string) =>
    get<string[]>("/namespaces", context ? { context } : undefined),
  resources: (params: { namespace?: string; kind: string; context?: string }) =>
    get<ResourceItem[]>("/resources", params as Record<string, string>),
  analyze: (body: {
    context?: string;
    namespace?: string;
    kind: string;
    name: string;
    include_previous_logs?: boolean;
  }) => post<AnalyzeResponse>("/analyze", body),
  history: (limit?: number) =>
    get<HistoryItem[]>(
      "/history",
      limit != null ? { limit: String(limit) } : undefined,
    ),
  historyGet: (id: string) =>
    get<
      HistoryItem & {
        analysis_markdown?: string;
        analysis_json?: AnalysisJson;
        evidence_summary?: string;
      }
    >(`/history/${id}`),
};
