import { useState, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import { api, type AnalyzeResponse, type HistoryItem } from "./api";

type Kind = "Pod" | "Deployment" | "StatefulSet" | "Node";

function App() {
  const [contexts, setContexts] = useState<
    { name: string; current: boolean }[]
  >([]);
  const [selectedContext, setSelectedContext] = useState<string>("");
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [selectedNamespace, setSelectedNamespace] = useState<string>("");
  const [kind, setKind] = useState<Kind>("Pod");
  const [resourceNames, setResourceNames] = useState<
    { name: string; namespace: string | null; kind: string }[]
  >([]);
  const [selectedName, setSelectedName] = useState<string>("");
  const [includePreviousLogs, setIncludePreviousLogs] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [viewHistoryId, setViewHistoryId] = useState<string | null>(null);
  const [historyDetail, setHistoryDetail] = useState<
    | (HistoryItem & { analysis_markdown?: string; analysis_json?: unknown })
    | null
  >(null);

  const loadContexts = useCallback(async () => {
    try {
      const list = await api.contexts();
      setContexts(list);
      const current = list.find((c) => c.current);
      setSelectedContext(current ? current.name : (list[0]?.name ?? ""));
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const loadNamespaces = useCallback(async () => {
    if (!selectedContext && contexts.length > 0) return;
    try {
      const list = await api.namespaces(
        selectedContext ? selectedContext : undefined,
      );
      setNamespaces(list);
      if (list.length && !list.includes(selectedNamespace))
        setSelectedNamespace(list[0]);
    } catch (e) {
      setNamespaces([]);
    }
  }, [selectedContext, contexts.length, selectedNamespace]);

  const loadResources = useCallback(async () => {
    const ns = kind === "Node" ? undefined : selectedNamespace;
    if (kind !== "Node" && !ns) {
      setResourceNames([]);
      return;
    }
    try {
      const list = await api.resources({
        namespace: ns || "",
        kind,
        context: selectedContext ? selectedContext : undefined,
      });
      setResourceNames(list);
      if (!list.some((r) => r.name === selectedName))
        setSelectedName(list[0]?.name ?? "");
    } catch (e) {
      setResourceNames([]);
    }
  }, [kind, selectedNamespace, selectedContext, selectedName]);

  useEffect(() => {
    loadContexts();
  }, [loadContexts]);
  useEffect(() => {
    loadNamespaces();
  }, [loadNamespaces]);
  useEffect(() => {
    loadResources();
  }, [loadResources]);

  const handleAnalyze = async () => {
    if (!selectedName.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.analyze({
        context: selectedContext || undefined,
        namespace: kind === "Node" ? undefined : selectedNamespace || undefined,
        kind,
        name: selectedName.trim(),
        include_previous_logs: includePreviousLogs,
      });
      setResult(res);
      setEvidenceOpen(false);
      loadHistory();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = useCallback(async () => {
    try {
      const list = await api.history(30);
      setHistory(list);
    } catch {
      setHistory([]);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const openHistoryDetail = async (id: string) => {
    setViewHistoryId(id);
    try {
      const detail = await api.historyGet(id);
      setHistoryDetail(detail);
    } catch {
      setHistoryDetail(null);
    }
  };

  const showContextSelect = contexts.length > 1;

  return (
    <>
      <header style={{ marginBottom: 24 }}>
        <h1>KubeBeaver</h1>
        <p style={{ color: "#666", margin: 0 }}>
          Kubernetes troubleshooting assistant
        </p>
      </header>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Analyze</h2>
        {error && (
          <div className="error-box" role="alert">
            {error}
          </div>
        )}
        <div className="form-row">
          {showContextSelect && (
            <>
              <label>Context</label>
              <select
                value={selectedContext}
                onChange={(e) => setSelectedContext(e.target.value)}
              >
                {contexts.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                    {c.current ? " (current)" : ""}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
        <div className="form-row">
          <label>Namespace</label>
          <select
            value={selectedNamespace}
            onChange={(e) => setSelectedNamespace(e.target.value)}
            disabled={kind === "Node"}
          >
            <option value="">--</option>
            {namespaces.map((ns) => (
              <option key={ns} value={ns}>
                {ns}
              </option>
            ))}
          </select>
        </div>
        <div className="form-row">
          <label>Target</label>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as Kind)}
          >
            <option value="Pod">Pod</option>
            <option value="Deployment">Deployment</option>
            <option value="StatefulSet">StatefulSet</option>
            <option value="Node">Node</option>
          </select>
        </div>
        <div className="form-row">
          <label>Resource</label>
          <select
            value={selectedName}
            onChange={(e) => setSelectedName(e.target.value)}
            disabled={resourceNames.length === 0}
          >
            <option value="">Select...</option>
            {resourceNames.map((r) => (
              <option key={r.name} value={r.name}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
        <div className="form-row">
          <label>
            <input
              type="checkbox"
              checked={includePreviousLogs}
              onChange={(e) => setIncludePreviousLogs(e.target.checked)}
            />
            Include previous logs (e.g. crash)
          </label>
        </div>
        <div className="form-row">
          <button
            onClick={handleAnalyze}
            disabled={loading || !selectedName.trim()}
          >
            {loading ? "Analyzing…" : "Analyze"}
          </button>
        </div>
      </div>

      {result && (
        <div className="card">
          <h2>
            Result
            {result.tokens_used > 0 &&
              ` - ${result.tokens_used.toLocaleString()} tokens`}
            {result.response_time_ms > 0 &&
              (result.response_time_ms >= 1000
                ? ` - ${(result.response_time_ms / 1000).toFixed(1)}s`
                : ` - ${result.response_time_ms}ms`)}
          </h2>
          {result.error && <div className="error-box">{result.error}</div>}
          {result.analysis_markdown && (
            <div className="markdown-body">
              <ReactMarkdown>{result.analysis_markdown}</ReactMarkdown>
            </div>
          )}
          {result.truncation_report?.truncated && (
            <p style={{ fontSize: 12, color: "#666" }}>
              Evidence was truncated (
              {result.truncation_report.total_chars_after} /{" "}
              {result.truncation_report.total_chars_before} chars).
            </p>
          )}
          <div style={{ marginTop: 16 }}>
            <button
              type="button"
              className="toggle-header"
              onClick={() => setEvidenceOpen(!evidenceOpen)}
            >
              {evidenceOpen ? "▼" : "▶"} Raw evidence (sanitized)
            </button>
            {evidenceOpen && (
              <div className="evidence-block">
                {JSON.stringify(result.evidence, null, 2)}
              </div>
            )}
          </div>
        </div>
      )}

      {viewHistoryId && (
        <div className="card">
          <h2>History – {viewHistoryId.slice(0, 8)}</h2>
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setViewHistoryId(null);
              setHistoryDetail(null);
            }}
          >
            ← Back
          </button>
          {historyDetail && (
            <>
              <p>
                <strong>{historyDetail.kind}</strong> {historyDetail.name}{" "}
                {historyDetail.namespace && `(${historyDetail.namespace})`}
              </p>
              {historyDetail.analysis_markdown && (
                <div className="markdown-body">
                  <ReactMarkdown>
                    {historyDetail.analysis_markdown}
                  </ReactMarkdown>
                </div>
              )}
              {historyDetail.error && (
                <div className="error-box">{historyDetail.error}</div>
              )}
            </>
          )}
        </div>
      )}

      <div className="card">
        <h2>History</h2>
        <ul style={{ listStyle: "none", padding: 0 }}>
          {history.slice(0, 15).map((h) => (
            <li key={h.id} style={{ marginBottom: 8 }}>
              <button
                type="button"
                className="link-button"
                onClick={() => openHistoryDetail(h.id)}
              >
                {h.kind} {h.name} {h.namespace && `(${h.namespace})`} –{" "}
                {new Date(h.created_at).toLocaleString()}
              </button>
              {h.error && (
                <span style={{ color: "#c62828", marginLeft: 8 }}>Error</span>
              )}
            </li>
          ))}
        </ul>
        {history.length === 0 && (
          <p style={{ color: "#666" }}>No analyses yet.</p>
        )}
      </div>
    </>
  );
}

export default App;
