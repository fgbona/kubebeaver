import { useState, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import {
  api,
  type AnalyzeResponse,
  type HistoryItem,
  type ScanResponse,
  type ScanListItem,
  type ScanFindingItem,
  type CompareResponse,
} from "./api";

type Kind = "Pod" | "Deployment" | "StatefulSet" | "Node";
type Tab = "analyze" | "scan";

const SEVERITY_ORDER: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

/** Tokenize JSON string for jq-style syntax highlighting (preserves formatting) */
function tokenizeJson(text: string): { type: string; value: string }[] {
  const tokens: { type: string; value: string }[] = [];
  let i = 0;
  const emitWs = () => {
    let val = "";
    while (i < text.length && /[\s\n\r\t]/.test(text[i])) {
      val += text[i];
      i++;
    }
    if (val.length > 0) tokens.push({ type: "ws", value: val });
  };
  while (i < text.length) {
    emitWs();
    if (i >= text.length) break;
    if (text[i] === '"') {
      let val = '"';
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === "\\") {
          val += text[i] + (text[i + 1] ?? "");
          i += 2;
        } else {
          val += text[i];
          i++;
        }
      }
      if (text[i] === '"') val += '"';
      i++;
      emitWs();
      const isKey = i < text.length && text[i] === ":";
      tokens.push({ type: isKey ? "key" : "string", value: val });
      continue;
    }
    if (/[-0-9]/.test(text[i])) {
      let val = "";
      while (i < text.length && /[-+eE.0-9]/.test(text[i])) {
        val += text[i];
        i++;
      }
      tokens.push({ type: "number", value: val });
      continue;
    }
    if (text.slice(i, i + 4) === "true") {
      tokens.push({ type: "bool", value: "true" });
      i += 4;
      continue;
    }
    if (text.slice(i, i + 5) === "false") {
      tokens.push({ type: "bool", value: "false" });
      i += 5;
      continue;
    }
    if (text.slice(i, i + 4) === "null") {
      tokens.push({ type: "null", value: "null" });
      i += 4;
      continue;
    }
    if (/[{}[\]:,]/.test(text[i])) {
      tokens.push({ type: "punct", value: text[i] });
      i++;
      continue;
    }
    tokens.push({ type: "raw", value: text[i] });
    i++;
  }
  return tokens;
}

/** Pretty-print JSON string for display; returns original if not valid JSON. */
function prettyJson(text: string): string {
  const trimmed = text.trim();
  if (!/^[{\[]/.test(trimmed)) return text;
  try {
    const parsed = JSON.parse(text);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return text;
  }
}

function JsonHighlight({ text }: { text: string }) {
  const tokens = tokenizeJson(text);
  return (
    <code
      className="json-highlight"
      style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}
    >
      {tokens.map((t, i) => (
        <span key={i} className={t.type === "ws" ? "" : `jq-${t.type}`}>
          {t.type === "ws"
            ? t.value
            : t.value.replace(/</g, "&lt;").replace(/&/g, "&amp;")}
        </span>
      ))}
    </code>
  );
}

function App() {
  const [tab, setTab] = useState<Tab>("analyze");
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
  const [compareSelectedIds, setCompareSelectedIds] = useState<string[]>([]);
  const [compareResult, setCompareResult] = useState<CompareResponse | null>(
    null,
  );
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);

  // Scan state
  const [scanScope, setScanScope] = useState<"namespace" | "cluster">(
    "namespace",
  );
  const [scanNamespace, setScanNamespace] = useState<string>("");
  const [scanIncludeLogs, setScanIncludeLogs] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResponse | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanList, setScanList] = useState<ScanListItem[]>([]);
  const [scanFilterSeverity, setScanFilterSeverity] = useState<string>("");
  const [scanFilterCategory, setScanFilterCategory] = useState<string>("");
  const [selectedFinding, setSelectedFinding] =
    useState<ScanFindingItem | null>(null);
  const [llmProviderLabel, setLlmProviderLabel] = useState<string>("");

  const loadHealth = useCallback(async () => {
    try {
      const h = await api.health();
      setLlmProviderLabel(
        h.llm_provider === "groq" ? "Groq" : h.llm_provider ? "Local" : "",
      );
    } catch {
      setLlmProviderLabel("");
    }
  }, []);

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
    loadHealth();
  }, [loadHealth]);
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

  const toggleCompareSelection = (id: string) => {
    setCompareSelectedIds((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length >= 2
          ? [...prev.slice(1), id]
          : [...prev, id],
    );
  };

  const runCompare = async () => {
    if (compareSelectedIds.length !== 2) return;
    setCompareLoading(true);
    setCompareError(null);
    setCompareResult(null);
    try {
      const res = await api.compare({
        analysis_id_a: compareSelectedIds[0],
        analysis_id_b: compareSelectedIds[1],
      });
      setCompareResult(res);
    } catch (e) {
      setCompareError(String(e));
    } finally {
      setCompareLoading(false);
    }
  };

  const copyKubectlCommands = (commands: string[]) => {
    const text = commands.join("\n");
    navigator.clipboard.writeText(text);
  };

  const loadScanList = useCallback(async () => {
    try {
      const list = await api.scans(30);
      setScanList(list);
    } catch {
      setScanList([]);
    }
  }, []);
  useEffect(() => {
    if (tab === "scan") loadScanList();
  }, [tab, loadScanList]);

  const handleScan = async () => {
    if (scanScope === "namespace" && !scanNamespace.trim()) return;
    setScanLoading(true);
    setScanError(null);
    setScanResult(null);
    setSelectedFinding(null);
    try {
      const res = await api.scan({
        context: selectedContext || undefined,
        scope: scanScope,
        namespace: scanScope === "namespace" ? scanNamespace.trim() : undefined,
        include_logs: scanIncludeLogs,
      });
      setScanResult(res);
      loadScanList();
    } catch (e) {
      setScanError(String(e));
    } finally {
      setScanLoading(false);
    }
  };

  const showContextSelect = contexts.length > 1;

  const filteredFindings = (scanResult?.findings ?? []).filter((f) => {
    if (scanFilterSeverity && f.severity !== scanFilterSeverity) return false;
    if (scanFilterCategory && f.category !== scanFilterCategory) return false;
    return true;
  });
  const sortedFindings = [...filteredFindings].sort(
    (a, b) =>
      (SEVERITY_ORDER[b.severity] ?? 0) - (SEVERITY_ORDER[a.severity] ?? 0),
  );
  const severities = Array.from(
    new Set(scanResult?.findings.map((f) => f.severity) ?? []),
  ).sort((a, b) => (SEVERITY_ORDER[b] ?? 0) - (SEVERITY_ORDER[a] ?? 0));
  const categories = Array.from(
    new Set(scanResult?.findings.map((f) => f.category) ?? []),
  ).sort();

  return (
    <>
      <header style={{ marginBottom: 24 }}>
        <h1>KubeBeaver</h1>
        <p style={{ color: "#666", margin: 0 }}>
          Kubernetes troubleshooting assistant
        </p>
        <div
          className="tab-bar"
          style={{ marginTop: 12, display: "flex", gap: 12 }}
        >
          <button
            type="button"
            className={tab === "analyze" ? "primary" : ""}
            onClick={() => setTab("analyze")}
          >
            Analyze
          </button>
          <button
            type="button"
            className={tab === "scan" ? "primary" : ""}
            onClick={() => setTab("scan")}
          >
            Scan
          </button>
        </div>
      </header>

      {tab === "scan" && (
        <>
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Cluster health scan</h2>
            {scanError && (
              <div className="error-box" role="alert">
                {scanError}
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
              <label>Scope</label>
              <select
                value={scanScope}
                onChange={(e) =>
                  setScanScope(e.target.value as "namespace" | "cluster")
                }
              >
                <option value="namespace">Namespace</option>
                <option value="cluster">Cluster</option>
              </select>
            </div>
            {scanScope === "namespace" && (
              <div className="form-row">
                <label>Namespace</label>
                <select
                  value={scanNamespace}
                  onChange={(e) => setScanNamespace(e.target.value)}
                >
                  <option value="">Select...</option>
                  {namespaces.map((ns) => (
                    <option key={ns} value={ns}>
                      {ns}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="form-row">
              <label>
                <input
                  type="checkbox"
                  checked={scanIncludeLogs}
                  onChange={(e) => setScanIncludeLogs(e.target.checked)}
                />
                Include logs in evidence
              </label>
            </div>
            <div className="form-row">
              <button
                onClick={handleScan}
                disabled={
                  scanLoading ||
                  (scanScope === "namespace" && !scanNamespace.trim())
                }
              >
                {scanLoading ? "Scanning…" : "Scan"}
              </button>
            </div>
          </div>

          {scanResult && (
            <div className="card">
              <h2>
                {llmProviderLabel ? `${llmProviderLabel} – ` : ""}
                Scan results
                {scanResult.duration_ms != null &&
                  scanResult.duration_ms >= 0 && (
                    <>
                      {" – "}
                      {scanResult.duration_ms >= 1000
                        ? `${(scanResult.duration_ms / 1000).toFixed(1)}s`
                        : `${scanResult.duration_ms}ms`}
                    </>
                  )}
              </h2>
              {scanResult.error && (
                <div className="error-box" style={{ marginBottom: 12 }}>
                  {scanResult.error}
                </div>
              )}
              {scanResult.summary_markdown && (
                <div className="markdown-body" style={{ marginBottom: 16 }}>
                  {(() => {
                    const summary = scanResult.summary_markdown!;
                    const headingMatch = summary.match(
                      /^##\s*Scan summary\s*(\((.*?)\))?/m,
                    );
                    const heading = headingMatch
                      ? `Scan summary${headingMatch[1] ?? ""}`
                      : "Scan summary";
                    const counts = scanResult.counts ?? {};
                    const severities = [
                      { key: "critical", label: "Critical" },
                      { key: "high", label: "High" },
                      { key: "medium", label: "Medium" },
                      { key: "low", label: "Low" },
                      { key: "info", label: "Info" },
                    ] as const;
                    const total = scanResult.findings?.length ?? 0;
                    return (
                      <>
                        <h2 style={{ fontSize: "1.1em", marginBottom: 4 }}>
                          {heading}
                        </h2>
                        <div className="scan-summary-counts">
                          {severities.map((s, i) => (
                            <span key={s.key}>
                              {i > 0 && <span className="severity-sep">|</span>}
                              <span className={`severity-${s.key}`}>
                                {s.label}: {counts[s.key] ?? 0}
                              </span>
                            </span>
                          ))}
                        </div>
                        <div className="scan-summary-total">
                          • Total findings: {total}
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}
              <div
                style={{
                  display: "flex",
                  gap: 16,
                  marginBottom: 12,
                  flexWrap: "wrap",
                }}
              >
                <label>
                  Severity{" "}
                  <select
                    value={scanFilterSeverity}
                    onChange={(e) => setScanFilterSeverity(e.target.value)}
                  >
                    <option value="">All</option>
                    {severities.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Category{" "}
                  <select
                    value={scanFilterCategory}
                    onChange={(e) => setScanFilterCategory(e.target.value)}
                  >
                    <option value="">All</option>
                    {categories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div
                style={{ display: "flex", gap: 24, alignItems: "flex-start" }}
              >
                <ul
                  style={{
                    listStyle: "none",
                    padding: 0,
                    flex: 1,
                    minWidth: 0,
                  }}
                >
                  {sortedFindings.map((f) => (
                    <li key={f.id} style={{ marginBottom: 8 }}>
                      <button
                        type="button"
                        className="link-button"
                        style={{
                          textAlign: "left",
                          padding: 8,
                          border:
                            selectedFinding?.id === f.id
                              ? "2px solid #1976d2"
                              : "1px solid #eee",
                          borderRadius: 4,
                          width: "100%",
                        }}
                        onClick={() => setSelectedFinding(f)}
                      >
                        {(f.occurred_at ?? scanResult.created_at) && (
                          <span
                            style={{
                              marginRight: 8,
                              fontSize: 11,
                              color: "#666",
                              flexShrink: 0,
                            }}
                          >
                            {new Date(
                              f.occurred_at ?? scanResult.created_at!,
                            ).toLocaleString(undefined, {
                              month: "2-digit",
                              day: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        )}
                        <span
                          style={{
                            marginRight: 8,
                            fontWeight: 600,
                            textTransform: "uppercase",
                            fontSize: 11,
                          }}
                        >
                          {f.severity}
                        </span>
                        [{f.category}] {f.title}
                      </button>
                    </li>
                  ))}
                </ul>
                {selectedFinding && (
                  <div
                    className="card"
                    style={{
                      flex: "1 1 400px",
                      maxWidth: 500,
                      margin: 0,
                      position: "sticky",
                      top: 16,
                    }}
                  >
                    <h3 style={{ marginTop: 0 }}>
                      [{selectedFinding.severity}] {selectedFinding.title}
                    </h3>
                    <p style={{ color: "#666", fontSize: 14 }}>
                      {selectedFinding.description}
                    </p>
                    {selectedFinding.affected_refs?.length > 0 && (
                      <p style={{ fontSize: 13 }}>
                        <strong>Affected:</strong>{" "}
                        {selectedFinding.affected_refs
                          .map(
                            (r) =>
                              `${r.kind || "?"}/${r.namespace ? r.namespace + "/" : ""}${r.name || "?"}`,
                          )
                          .join(", ")}
                      </p>
                    )}
                    {selectedFinding.evidence_snippet && (
                      <div style={{ marginTop: 12 }}>
                        <strong>Evidence</strong>
                        <pre
                          className="evidence-block"
                          style={{
                            marginTop: 4,
                            padding: 12,
                            maxHeight: 300,
                            fontSize: 12,
                          }}
                        >
                          {/^\s*[{\[]/.test(
                            selectedFinding.evidence_snippet,
                          ) ? (
                            <JsonHighlight
                              text={prettyJson(
                                selectedFinding.evidence_snippet,
                              )}
                            />
                          ) : (
                            selectedFinding.evidence_snippet
                          )}
                        </pre>
                      </div>
                    )}
                    {selectedFinding.suggested_commands?.length > 0 && (
                      <div style={{ marginTop: 12 }}>
                        <strong>Suggested commands</strong>
                        <ul style={{ margin: 4, paddingLeft: 20 }}>
                          {selectedFinding.suggested_commands.map((cmd, i) => (
                            <li key={i}>
                              <code style={{ fontSize: 12 }}>{cmd}</code>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="card">
            <h2>Recent scans</h2>
            <ul style={{ listStyle: "none", padding: 0 }}>
              {scanList.slice(0, 15).map((s) => (
                <li key={s.id} style={{ marginBottom: 8 }}>
                  <button
                    type="button"
                    className="link-button"
                    onClick={async () => {
                      try {
                        const detail = await api.scanGet(s.id);
                        const findings = detail.findings ?? [];
                        const counts: Record<string, number> = {};
                        findings.forEach((f) => {
                          counts[f.severity] = (counts[f.severity] ?? 0) + 1;
                        });
                        setScanResult({
                          id: detail.id,
                          created_at: detail.created_at ?? undefined,
                          summary_markdown: detail.summary_markdown ?? null,
                          error: detail.error ?? null,
                          findings,
                          counts,
                        });
                        setSelectedFinding(null);
                      } catch {
                        setScanResult(null);
                      }
                    }}
                  >
                    {s.scope} {s.namespace ? `· ${s.namespace}` : ""} –{" "}
                    {s.findings_count} findings –{" "}
                    {new Date(s.created_at).toLocaleString()}
                  </button>
                  {s.error && (
                    <span style={{ color: "#c62828", marginLeft: 8 }}>
                      Partial
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {scanList.length === 0 && (
              <p style={{ color: "#666" }}>No scans yet.</p>
            )}
          </div>
        </>
      )}

      {tab === "analyze" && (
        <>
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
                {llmProviderLabel ? `${llmProviderLabel} – ` : ""}
                Result
                {result.tokens_used > 0 &&
                  ` – ${result.tokens_used.toLocaleString()} tokens`}
                {result.response_time_ms > 0 &&
                  (result.response_time_ms >= 1000
                    ? ` – ${(result.response_time_ms / 1000).toFixed(1)}s`
                    : ` – ${result.response_time_ms}ms`)}
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
                    <JsonHighlight
                      text={JSON.stringify(result.evidence, null, 2)}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {compareResult && (
            <div className="card">
              <h2>Compare analyses</h2>
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  setCompareResult(null);
                  setCompareError(null);
                }}
              >
                ← Back
              </button>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 16,
                  marginTop: 12,
                }}
              >
                <div>
                  <h3 style={{ marginTop: 0 }}>Analysis A</h3>
                  <p style={{ margin: 0, fontSize: 14 }}>
                    {compareResult.analysis_a.kind}{" "}
                    {compareResult.analysis_a.name}{" "}
                    {compareResult.analysis_a.namespace &&
                      `(${compareResult.analysis_a.namespace})`}
                  </p>
                  <p style={{ margin: "4px 0 0", color: "#666", fontSize: 12 }}>
                    {new Date(
                      compareResult.analysis_a.created_at,
                    ).toLocaleString()}
                  </p>
                </div>
                <div>
                  <h3 style={{ marginTop: 0 }}>Analysis B</h3>
                  <p style={{ margin: 0, fontSize: 14 }}>
                    {compareResult.analysis_b.kind}{" "}
                    {compareResult.analysis_b.name}{" "}
                    {compareResult.analysis_b.namespace &&
                      `(${compareResult.analysis_b.namespace})`}
                  </p>
                  <p style={{ margin: "4px 0 0", color: "#666", fontSize: 12 }}>
                    {new Date(
                      compareResult.analysis_b.created_at,
                    ).toLocaleString()}
                  </p>
                </div>
              </div>
              {compareResult.likely_reasoning && (
                <div style={{ marginTop: 16 }}>
                  <h3 style={{ marginTop: 0 }}>Likely reasoning</h3>
                  <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>
                    {compareResult.likely_reasoning}
                  </p>
                </div>
              )}
              {compareResult.diff_summary && (
                <div style={{ marginTop: 16 }}>
                  <h3 style={{ marginTop: 0 }}>Diff summary</h3>
                  <div className="markdown-body">
                    <ReactMarkdown>{compareResult.diff_summary}</ReactMarkdown>
                  </div>
                </div>
              )}
              <div style={{ marginTop: 16 }}>
                <h3 style={{ marginTop: 0 }}>Copy kubectl commands</h3>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 12,
                  }}
                >
                  <div>
                    <p style={{ margin: "0 0 8px", fontSize: 13 }}>
                      From A ({compareResult.analysis_a.created_at.slice(0, 10)}
                      )
                    </p>
                    {(compareResult.analysis_a.kubectl_commands ?? []).length >
                    0 ? (
                      <button
                        type="button"
                        className="primary"
                        onClick={() =>
                          copyKubectlCommands(
                            compareResult.analysis_a.kubectl_commands ?? [],
                          )
                        }
                      >
                        Copy {compareResult.analysis_a.kubectl_commands?.length}{" "}
                        commands
                      </button>
                    ) : (
                      <span style={{ color: "#666", fontSize: 13 }}>
                        No commands
                      </span>
                    )}
                  </div>
                  <div>
                    <p style={{ margin: "0 0 8px", fontSize: 13 }}>
                      From B ({compareResult.analysis_b.created_at.slice(0, 10)}
                      )
                    </p>
                    {(compareResult.analysis_b.kubectl_commands ?? []).length >
                    0 ? (
                      <button
                        type="button"
                        className="primary"
                        onClick={() =>
                          copyKubectlCommands(
                            compareResult.analysis_b.kubectl_commands ?? [],
                          )
                        }
                      >
                        Copy {compareResult.analysis_b.kubectl_commands?.length}{" "}
                        commands
                      </button>
                    ) : (
                      <span style={{ color: "#666", fontSize: 13 }}>
                        No commands
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {viewHistoryId && !compareResult && (
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
            {compareError && (
              <div
                className="error-box"
                role="alert"
                style={{ marginBottom: 12 }}
              >
                {compareError}
              </div>
            )}
            <p style={{ fontSize: 13, color: "#666", marginBottom: 8 }}>
              Select two analyses and click Compare.
            </p>
            <ul style={{ listStyle: "none", padding: 0 }}>
              {history.slice(0, 15).map((h) => (
                <li
                  key={h.id}
                  style={{
                    marginBottom: 8,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={compareSelectedIds.includes(h.id)}
                    onChange={() => toggleCompareSelection(h.id)}
                    aria-label={`Select ${h.kind} ${h.name} for compare`}
                  />
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => openHistoryDetail(h.id)}
                    style={{ flex: 1, textAlign: "left" }}
                  >
                    {h.kind} {h.name} {h.namespace && `(${h.namespace})`} –{" "}
                    {new Date(h.created_at).toLocaleString()}
                  </button>
                  {h.error && <span style={{ color: "#c62828" }}>Error</span>}
                </li>
              ))}
            </ul>
            {compareSelectedIds.length === 2 && (
              <button
                type="button"
                className="primary"
                disabled={compareLoading}
                onClick={runCompare}
                style={{ marginTop: 8 }}
              >
                {compareLoading ? "Comparing…" : "Compare selected"}
              </button>
            )}
            {history.length === 0 && (
              <p style={{ color: "#666" }}>No analyses yet.</p>
            )}
          </div>
        </>
      )}
    </>
  );
}

export default App;
