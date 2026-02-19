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
  type IncidentListItem,
  type IncidentDetail,
  type ScheduleListItem,
} from "./api";

type Kind = "Pod" | "Deployment" | "StatefulSet" | "Node";
type Tab = "analyze" | "scan" | "incidents" | "schedules";

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
  const [explainOpen, setExplainOpen] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [viewHistoryId, setViewHistoryId] = useState<string | null>(null);
  const [historyDetail, setHistoryDetail] = useState<
    | (HistoryItem & {
        analysis_markdown?: string;
        analysis_json?: import("./api").AnalysisJson;
      })
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

  // Incidents
  const [incidentList, setIncidentList] = useState<IncidentListItem[]>([]);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(
    null,
  );
  const [incidentDetail, setIncidentDetail] = useState<IncidentDetail | null>(
    null,
  );
  const [incidentCreateTitle, setIncidentCreateTitle] = useState("");
  const [incidentCreateDesc, setIncidentCreateDesc] = useState("");
  const [incidentCreateSeverity, setIncidentCreateSeverity] = useState("");
  const [incidentError, setIncidentError] = useState<string | null>(null);
  const [incidentLoading, setIncidentLoading] = useState(false);
  const [addItemType, setAddItemType] = useState<"analysis" | "scan">(
    "analysis",
  );
  const [addItemRefId, setAddItemRefId] = useState("");
  const [addNoteContent, setAddNoteContent] = useState("");
  const [exportLoading, setExportLoading] = useState(false);

  // Schedules
  const [scheduleList, setScheduleList] = useState<ScheduleListItem[]>([]);
  const [scheduleCreateContext, setScheduleCreateContext] = useState("");
  const [scheduleCreateScope, setScheduleCreateScope] = useState<
    "namespace" | "cluster"
  >("namespace");
  const [scheduleCreateNamespace, setScheduleCreateNamespace] = useState("");
  const [scheduleCreateCron, setScheduleCreateCron] = useState("0 * * * *");
  const [scheduleCreateEnabled, setScheduleCreateEnabled] = useState(true);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(
    null,
  );
  const [editScheduleCron, setEditScheduleCron] = useState("");
  const [editScheduleEnabled, setEditScheduleEnabled] = useState(true);

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
  const loadIncidentList = useCallback(async () => {
    try {
      const list = await api.incidents(50);
      setIncidentList(list);
    } catch {
      setIncidentList([]);
    }
  }, []);

  const loadScheduleList = useCallback(async () => {
    try {
      const list = await api.schedules(100);
      setScheduleList(list);
    } catch {
      setScheduleList([]);
    }
  }, []);

  useEffect(() => {
    if (tab === "scan") loadScanList();
    if (tab === "incidents") {
      loadIncidentList();
      loadHistory();
      loadScanList();
    }
    if (tab === "schedules") {
      loadScheduleList();
      loadContexts();
      loadNamespaces();
    }
  }, [
    tab,
    loadScanList,
    loadIncidentList,
    loadHistory,
    loadScheduleList,
    loadContexts,
    loadNamespaces,
  ]);

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

  const handleCreateIncident = async () => {
    if (!incidentCreateTitle.trim()) return;
    setIncidentLoading(true);
    setIncidentError(null);
    try {
      const { id } = await api.incidentCreate({
        title: incidentCreateTitle.trim(),
        description: incidentCreateDesc.trim() || undefined,
        severity: incidentCreateSeverity || undefined,
      });
      setIncidentCreateTitle("");
      setIncidentCreateDesc("");
      setIncidentCreateSeverity("");
      loadIncidentList();
      setSelectedIncidentId(id);
      const detail = await api.incidentGet(id);
      setIncidentDetail(detail);
    } catch (e) {
      setIncidentError(String(e));
    } finally {
      setIncidentLoading(false);
    }
  };

  const openIncidentDetail = async (id: string) => {
    setSelectedIncidentId(id);
    setIncidentError(null);
    try {
      const detail = await api.incidentGet(id);
      setIncidentDetail(detail);
    } catch (e) {
      setIncidentError(String(e));
      setIncidentDetail(null);
    }
  };

  const handleAddItemToIncident = async () => {
    if (!selectedIncidentId || !addItemRefId.trim()) return;
    setIncidentLoading(true);
    setIncidentError(null);
    try {
      await api.incidentAddItem(selectedIncidentId, {
        type: addItemType,
        ref_id: addItemRefId.trim(),
      });
      setAddItemRefId("");
      const detail = await api.incidentGet(selectedIncidentId);
      setIncidentDetail(detail);
    } catch (e) {
      setIncidentError(String(e));
    } finally {
      setIncidentLoading(false);
    }
  };

  const handleAddNoteToIncident = async () => {
    if (!selectedIncidentId || !addNoteContent.trim()) return;
    setIncidentLoading(true);
    setIncidentError(null);
    try {
      await api.incidentAddNote(selectedIncidentId, addNoteContent.trim());
      setAddNoteContent("");
      const detail = await api.incidentGet(selectedIncidentId);
      setIncidentDetail(detail);
    } catch (e) {
      setIncidentError(String(e));
    } finally {
      setIncidentLoading(false);
    }
  };

  const handleExportIncident = async (format: "markdown" | "json") => {
    if (!selectedIncidentId) return;
    setExportLoading(true);
    setIncidentError(null);
    try {
      const content = await api.incidentExport(selectedIncidentId, format);
      const blob = new Blob([content], {
        type: format === "json" ? "application/json" : "text/markdown",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `incident-${selectedIncidentId.slice(0, 8)}.${format === "json" ? "json" : "md"}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setIncidentError(String(e));
    } finally {
      setExportLoading(false);
    }
  };

  const handleScheduleCreate = async () => {
    if (scheduleCreateScope === "namespace" && !scheduleCreateNamespace.trim())
      return;
    if (!scheduleCreateCron.trim()) return;
    setScheduleLoading(true);
    setScheduleError(null);
    try {
      await api.scheduleCreate({
        context: scheduleCreateContext.trim() || undefined,
        scope: scheduleCreateScope,
        namespace:
          scheduleCreateScope === "namespace"
            ? scheduleCreateNamespace.trim()
            : undefined,
        cron: scheduleCreateCron.trim(),
        enabled: scheduleCreateEnabled,
      });
      setScheduleCreateContext("");
      setScheduleCreateNamespace("");
      setScheduleCreateCron("0 * * * *");
      setScheduleCreateEnabled(true);
      await loadScheduleList();
    } catch (e) {
      setScheduleError(String(e));
    } finally {
      setScheduleLoading(false);
    }
  };

  const startEditSchedule = (s: ScheduleListItem) => {
    setEditingScheduleId(s.id);
    setEditScheduleCron(s.cron);
    setEditScheduleEnabled(s.enabled);
  };

  const handleScheduleUpdate = async () => {
    if (!editingScheduleId) return;
    setScheduleLoading(true);
    setScheduleError(null);
    try {
      await api.scheduleUpdate(editingScheduleId, {
        cron: editScheduleCron.trim(),
        enabled: editScheduleEnabled,
      });
      setEditingScheduleId(null);
      await loadScheduleList();
    } catch (e) {
      setScheduleError(String(e));
    } finally {
      setScheduleLoading(false);
    }
  };

  const handleScheduleDelete = async (id: string) => {
    if (!confirm("Delete this schedule?")) return;
    setScheduleLoading(true);
    setScheduleError(null);
    try {
      await api.scheduleDelete(id);
      if (editingScheduleId === id) setEditingScheduleId(null);
      await loadScheduleList();
    } catch (e) {
      setScheduleError(String(e));
    } finally {
      setScheduleLoading(false);
    }
  };

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

  const navItems: { id: Tab; label: string }[] = [
    { id: "analyze", label: "Analyze" },
    { id: "scan", label: "Scan" },
    { id: "incidents", label: "Incidents" },
    { id: "schedules", label: "Schedules" },
  ];

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="sidebar-logo">KubeBeaver</span>
          <span className="sidebar-tagline">
            Kubernetes troubleshooting assistant
          </span>
        </div>
        <nav className="sidebar-nav">
          {navItems.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className={`sidebar-item ${tab === id ? "active" : ""}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
      </aside>
      <main className="main-content">
        {tab === "incidents" && (
          <>
            <div className="card">
              <h2 style={{ marginTop: 0 }}>Incidents</h2>
              <p style={{ color: "#666", marginBottom: 12 }}>
                Group analyses and scans into incidents; add notes and export
                timeline.
              </p>
              {incidentError && (
                <div className="error-box" role="alert">
                  {incidentError}
                </div>
              )}
              <div className="form-row">
                <label>Title</label>
                <input
                  type="text"
                  value={incidentCreateTitle}
                  onChange={(e) => setIncidentCreateTitle(e.target.value)}
                  placeholder="Incident title"
                  style={{ maxWidth: 400 }}
                />
              </div>
              <div className="form-row">
                <label>Description</label>
                <textarea
                  value={incidentCreateDesc}
                  onChange={(e) => setIncidentCreateDesc(e.target.value)}
                  placeholder="Optional description"
                  rows={2}
                  style={{ maxWidth: 400 }}
                />
              </div>
              <div className="form-row">
                <label>Severity</label>
                <select
                  value={incidentCreateSeverity}
                  onChange={(e) => setIncidentCreateSeverity(e.target.value)}
                >
                  <option value="">—</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
              <div className="form-row">
                <button
                  onClick={handleCreateIncident}
                  disabled={incidentLoading || !incidentCreateTitle.trim()}
                >
                  {incidentLoading ? "Creating…" : "Create incident"}
                </button>
              </div>
            </div>
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Incident list</h3>
              <ul style={{ listStyle: "none", padding: 0 }}>
                {incidentList.map((inc) => (
                  <li key={inc.id} style={{ marginBottom: 8 }}>
                    <button
                      type="button"
                      className="link-button"
                      style={{
                        textAlign: "left",
                        border:
                          selectedIncidentId === inc.id
                            ? "2px solid #1976d2"
                            : "1px solid #eee",
                        padding: 8,
                        borderRadius: 4,
                        width: "100%",
                      }}
                      onClick={() => openIncidentDetail(inc.id)}
                    >
                      {inc.title}
                      {inc.severity && (
                        <span
                          style={{
                            marginLeft: 8,
                            fontSize: 11,
                            textTransform: "uppercase",
                          }}
                        >
                          {inc.severity}
                        </span>
                      )}{" "}
                      – {new Date(inc.created_at).toLocaleString()}
                    </button>
                  </li>
                ))}
              </ul>
              {incidentList.length === 0 && (
                <p style={{ color: "#666" }}>No incidents yet.</p>
              )}
            </div>
            {incidentDetail && (
              <div className="card">
                <h3 style={{ marginTop: 0 }}>
                  {incidentDetail.title}
                  {incidentDetail.severity && (
                    <span style={{ marginLeft: 8, fontSize: 14 }}>
                      [{incidentDetail.severity}]
                    </span>
                  )}
                </h3>
                {incidentDetail.description && (
                  <p style={{ color: "#555", marginBottom: 12 }}>
                    {incidentDetail.description}
                  </p>
                )}
                <p style={{ fontSize: 12, color: "#666" }}>
                  Created {new Date(incidentDetail.created_at).toLocaleString()}{" "}
                  • Status: {incidentDetail.status}
                </p>
                <h4 style={{ marginTop: 16 }}>Timeline</h4>
                <ul style={{ listStyle: "none", padding: 0 }}>
                  {(incidentDetail.timeline || []).map((entry, idx) => (
                    <li
                      key={idx}
                      style={{
                        marginBottom: 8,
                        paddingLeft: 12,
                        borderLeft: "2px solid #ddd",
                      }}
                    >
                      {entry.type === "incident_created" && (
                        <>Incident created at {entry.created_at}</>
                      )}
                      {entry.type === "item" && (
                        <>
                          {entry.item_type} <code>{entry.ref_id}</code> at{" "}
                          {entry.created_at}
                        </>
                      )}
                      {entry.type === "note" && (
                        <>
                          Note at {entry.created_at}: {entry.content}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
                <h4 style={{ marginTop: 16 }}>Add from history</h4>
                <div className="form-row" style={{ flexWrap: "wrap", gap: 8 }}>
                  <select
                    value={addItemType}
                    onChange={(e) =>
                      setAddItemType(e.target.value as "analysis" | "scan")
                    }
                  >
                    <option value="analysis">Analysis</option>
                    <option value="scan">Scan</option>
                  </select>
                  <select
                    value={addItemRefId}
                    onChange={(e) => setAddItemRefId(e.target.value)}
                    style={{ minWidth: 200 }}
                  >
                    <option value="">Select…</option>
                    {addItemType === "analysis" &&
                      history.map((h) => (
                        <option key={h.id} value={h.id}>
                          {h.kind} {h.name} – {h.created_at}
                        </option>
                      ))}
                    {addItemType === "scan" &&
                      scanList.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.scope} {s.namespace || ""} – {s.created_at}
                        </option>
                      ))}
                  </select>
                  <button
                    onClick={handleAddItemToIncident}
                    disabled={incidentLoading || !addItemRefId.trim()}
                  >
                    Add
                  </button>
                </div>
                <h4 style={{ marginTop: 16 }}>Add note</h4>
                <div className="form-row" style={{ flexWrap: "wrap", gap: 8 }}>
                  <input
                    type="text"
                    value={addNoteContent}
                    onChange={(e) => setAddNoteContent(e.target.value)}
                    placeholder="Note content"
                    style={{ flex: 1, minWidth: 200 }}
                  />
                  <button
                    onClick={handleAddNoteToIncident}
                    disabled={incidentLoading || !addNoteContent.trim()}
                  >
                    Add note
                  </button>
                </div>
                <h4 style={{ marginTop: 16 }}>Export</h4>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => handleExportIncident("markdown")}
                    disabled={exportLoading}
                  >
                    {exportLoading ? "Exporting…" : "Export Markdown"}
                  </button>
                  <button
                    onClick={() => handleExportIncident("json")}
                    disabled={exportLoading}
                  >
                    Export JSON
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {tab === "schedules" && (
          <>
            <div className="card">
              <h2 style={{ marginTop: 0 }}>Scheduled scans</h2>
              <p style={{ color: "var(--muted)", marginTop: 0 }}>
                Run cluster or namespace scans on a cron schedule. Results are
                stored like manual scans. Optional: set WEBHOOK_URL or
                SLACK_WEBHOOK_URL for critical/high findings.
              </p>
              {scheduleError && (
                <div className="error-box" role="alert">
                  {scheduleError}
                </div>
              )}
              <h3 style={{ marginTop: 16 }}>Create schedule</h3>
              <div className="form-row">
                {contexts.length > 0 && (
                  <>
                    <label>Context</label>
                    <select
                      value={scheduleCreateContext}
                      onChange={(e) => {
                        const v = e.target.value;
                        setScheduleCreateContext(v);
                        if (v) setSelectedContext(v);
                      }}
                    >
                      <option value="">(default)</option>
                      {contexts.map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </>
                )}
                <label>Scope</label>
                <select
                  value={scheduleCreateScope}
                  onChange={(e) =>
                    setScheduleCreateScope(
                      e.target.value as "namespace" | "cluster",
                    )
                  }
                >
                  <option value="namespace">Namespace</option>
                  <option value="cluster">Cluster</option>
                </select>
                {scheduleCreateScope === "namespace" && (
                  <>
                    <label>Namespace</label>
                    <select
                      value={scheduleCreateNamespace}
                      onChange={(e) =>
                        setScheduleCreateNamespace(e.target.value)
                      }
                    >
                      <option value="">Select…</option>
                      {namespaces.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </>
                )}
                <label>Cron (5 parts)</label>
                <input
                  type="text"
                  value={scheduleCreateCron}
                  onChange={(e) => setScheduleCreateCron(e.target.value)}
                  placeholder="0 * * * *"
                  style={{ fontFamily: "monospace" }}
                />
                <label>
                  <input
                    type="checkbox"
                    checked={scheduleCreateEnabled}
                    onChange={(e) => setScheduleCreateEnabled(e.target.checked)}
                  />{" "}
                  Enabled
                </label>
                <span />
                <button
                  onClick={handleScheduleCreate}
                  disabled={scheduleLoading}
                >
                  {scheduleLoading ? "Creating…" : "Create schedule"}
                </button>
              </div>
              <h3 style={{ marginTop: 24 }}>Schedules</h3>
              {scheduleList.length === 0 ? (
                <p style={{ color: "var(--muted)" }}>
                  No schedules yet. Create one above.
                </p>
              ) : (
                <ul style={{ listStyle: "none", padding: 0 }}>
                  {scheduleList.map((s) => (
                    <li
                      key={s.id}
                      style={{
                        padding: "10px 12px",
                        marginBottom: 8,
                        background: "var(--bg-secondary)",
                        borderRadius: 8,
                        display: "flex",
                        flexWrap: "wrap",
                        alignItems: "center",
                        gap: 12,
                      }}
                    >
                      {editingScheduleId === s.id ? (
                        <>
                          <input
                            type="text"
                            value={editScheduleCron}
                            onChange={(e) =>
                              setEditScheduleCron(e.target.value)
                            }
                            placeholder="0 * * * *"
                            style={{ fontFamily: "monospace", width: 120 }}
                          />
                          <label
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={editScheduleEnabled}
                              onChange={(e) =>
                                setEditScheduleEnabled(e.target.checked)
                              }
                            />
                            Enabled
                          </label>
                          <button
                            onClick={handleScheduleUpdate}
                            disabled={scheduleLoading}
                          >
                            Save
                          </button>
                          <button onClick={() => setEditingScheduleId(null)}>
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <code
                            style={{
                              background: "var(--bg)",
                              padding: "2px 6px",
                              borderRadius: 4,
                            }}
                          >
                            {s.cron}
                          </code>
                          <span>
                            {s.scope === "cluster"
                              ? "cluster"
                              : s.namespace || "—"}
                          </span>
                          {s.context && (
                            <span title="context">{s.context}</span>
                          )}
                          <span
                            style={{
                              color: s.enabled
                                ? "var(--success)"
                                : "var(--muted)",
                            }}
                          >
                            {s.enabled ? "On" : "Off"}
                          </span>
                          <button onClick={() => startEditSchedule(s)}>
                            Edit
                          </button>
                          <button
                            onClick={() => handleScheduleDelete(s.id)}
                            disabled={scheduleLoading}
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}

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
                                {i > 0 && (
                                  <span className="severity-sep">|</span>
                                )}
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
                            {selectedFinding.suggested_commands.map(
                              (cmd, i) => (
                                <li key={i}>
                                  <code style={{ fontSize: 12 }}>{cmd}</code>
                                </li>
                              ),
                            )}
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
                {result.error && (
                  <div className="error-box">{result.error}</div>
                )}
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
                {(result.analysis_json?.heuristics?.length ||
                  result.analysis_json?.why?.length ||
                  result.analysis_json?.uncertain?.length ||
                  (result.analysis_json?.follow_up_questions?.length ?? 0) >
                    0) && (
                  <div style={{ marginTop: 12 }}>
                    <button
                      type="button"
                      className="toggle-header"
                      onClick={() => setExplainOpen(!explainOpen)}
                    >
                      {explainOpen ? "▼" : "▶"} Explain reasoning
                    </button>
                    {explainOpen && (
                      <div className="evidence-block" style={{ padding: 12 }}>
                        {result.analysis_json.heuristics?.length ? (
                          <section style={{ marginBottom: 16 }}>
                            <h4 style={{ margin: "0 0 8px", fontSize: 14 }}>
                              Heuristic signals
                            </h4>
                            <ul style={{ margin: 0, paddingLeft: 20 }}>
                              {result.analysis_json.heuristics.map((h, i) => (
                                <li key={i}>
                                  <strong>{h.condition}</strong>{" "}
                                  {h.evidence_refs?.length
                                    ? `(${h.evidence_refs.join(", ")})`
                                    : ""}
                                  <ul
                                    style={{
                                      margin: "4px 0 0",
                                      paddingLeft: 16,
                                    }}
                                  >
                                    {h.candidates?.map((c, j) => (
                                      <li key={j}>
                                        {c.cause} ({c.confidence})
                                      </li>
                                    ))}
                                  </ul>
                                </li>
                              ))}
                            </ul>
                          </section>
                        ) : null}
                        {result.analysis_json.why?.length ? (
                          <section style={{ marginBottom: 16 }}>
                            <h4 style={{ margin: "0 0 8px", fontSize: 14 }}>
                              Evidence mapping
                            </h4>
                            <ul style={{ margin: 0, paddingLeft: 20 }}>
                              {result.analysis_json.why.map((w, i) => (
                                <li key={i}>
                                  <code style={{ fontSize: 12 }}>{w.ref}</code>:{" "}
                                  {w.explanation}
                                </li>
                              ))}
                            </ul>
                          </section>
                        ) : null}
                        {(result.analysis_json.uncertain?.length ||
                          (result.analysis_json.follow_up_questions?.length ??
                            0) > 0) && (
                          <section>
                            <h4 style={{ margin: "0 0 8px", fontSize: 14 }}>
                              Uncertain / follow-up questions
                            </h4>
                            <ul style={{ margin: 0, paddingLeft: 20 }}>
                              {(result.analysis_json.uncertain ?? []).map(
                                (u, i) => (
                                  <li key={`u-${i}`}>{u}</li>
                                ),
                              )}
                              {(
                                result.analysis_json.follow_up_questions ?? []
                              ).map((q, i) => (
                                <li key={`q-${i}`}>{q}</li>
                              ))}
                            </ul>
                          </section>
                        )}
                      </div>
                    )}
                  </div>
                )}
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
                    <p
                      style={{ margin: "4px 0 0", color: "#666", fontSize: 12 }}
                    >
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
                    <p
                      style={{ margin: "4px 0 0", color: "#666", fontSize: 12 }}
                    >
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
                      <ReactMarkdown>
                        {compareResult.diff_summary}
                      </ReactMarkdown>
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
                        From A (
                        {compareResult.analysis_a.created_at.slice(0, 10)})
                      </p>
                      {(compareResult.analysis_a.kubectl_commands ?? [])
                        .length > 0 ? (
                        <button
                          type="button"
                          className="primary"
                          onClick={() =>
                            copyKubectlCommands(
                              compareResult.analysis_a.kubectl_commands ?? [],
                            )
                          }
                        >
                          Copy{" "}
                          {compareResult.analysis_a.kubectl_commands?.length}{" "}
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
                        From B (
                        {compareResult.analysis_b.created_at.slice(0, 10)})
                      </p>
                      {(compareResult.analysis_b.kubectl_commands ?? [])
                        .length > 0 ? (
                        <button
                          type="button"
                          className="primary"
                          onClick={() =>
                            copyKubectlCommands(
                              compareResult.analysis_b.kubectl_commands ?? [],
                            )
                          }
                        >
                          Copy{" "}
                          {compareResult.analysis_b.kubectl_commands?.length}{" "}
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
                      {historyDetail.namespace &&
                        `(${historyDetail.namespace})`}
                    </p>
                    {historyDetail.analysis_markdown && (
                      <div className="markdown-body">
                        <ReactMarkdown>
                          {historyDetail.analysis_markdown}
                        </ReactMarkdown>
                      </div>
                    )}
                    {historyDetail.analysis_json &&
                      (historyDetail.analysis_json.heuristics?.length ||
                        historyDetail.analysis_json.why?.length ||
                        historyDetail.analysis_json.uncertain?.length ||
                        (historyDetail.analysis_json.follow_up_questions
                          ?.length ?? 0) > 0) && (
                        <div style={{ marginTop: 12 }}>
                          <button
                            type="button"
                            className="toggle-header"
                            onClick={() => setExplainOpen(!explainOpen)}
                          >
                            {explainOpen ? "▼" : "▶"} Explain reasoning
                          </button>
                          {explainOpen && (
                            <div
                              className="evidence-block"
                              style={{ padding: 12 }}
                            >
                              {historyDetail.analysis_json.heuristics
                                ?.length ? (
                                <section style={{ marginBottom: 16 }}>
                                  <h4
                                    style={{ margin: "0 0 8px", fontSize: 14 }}
                                  >
                                    Heuristic signals
                                  </h4>
                                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                                    {historyDetail.analysis_json.heuristics.map(
                                      (h, i) => (
                                        <li key={i}>
                                          <strong>{h.condition}</strong>{" "}
                                          {h.evidence_refs?.length
                                            ? `(${h.evidence_refs.join(", ")})`
                                            : ""}
                                          <ul
                                            style={{
                                              margin: "4px 0 0",
                                              paddingLeft: 16,
                                            }}
                                          >
                                            {h.candidates?.map((c, j) => (
                                              <li key={j}>
                                                {c.cause} ({c.confidence})
                                              </li>
                                            ))}
                                          </ul>
                                        </li>
                                      ),
                                    )}
                                  </ul>
                                </section>
                              ) : null}
                              {historyDetail.analysis_json.why?.length ? (
                                <section style={{ marginBottom: 16 }}>
                                  <h4
                                    style={{ margin: "0 0 8px", fontSize: 14 }}
                                  >
                                    Evidence mapping
                                  </h4>
                                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                                    {historyDetail.analysis_json.why.map(
                                      (w, i) => (
                                        <li key={i}>
                                          <code style={{ fontSize: 12 }}>
                                            {w.ref}
                                          </code>
                                          : {w.explanation}
                                        </li>
                                      ),
                                    )}
                                  </ul>
                                </section>
                              ) : null}
                              {(historyDetail.analysis_json.uncertain?.length ||
                                (historyDetail.analysis_json.follow_up_questions
                                  ?.length ?? 0) > 0) && (
                                <section>
                                  <h4
                                    style={{ margin: "0 0 8px", fontSize: 14 }}
                                  >
                                    Uncertain / follow-up questions
                                  </h4>
                                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                                    {(
                                      historyDetail.analysis_json.uncertain ??
                                      []
                                    ).map((u, i) => (
                                      <li key={`u-${i}`}>{u}</li>
                                    ))}
                                    {(
                                      historyDetail.analysis_json
                                        .follow_up_questions ?? []
                                    ).map((q, i) => (
                                      <li key={`q-${i}`}>{q}</li>
                                    ))}
                                  </ul>
                                </section>
                              )}
                            </div>
                          )}
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
      </main>
    </div>
  );
}

export default App;
