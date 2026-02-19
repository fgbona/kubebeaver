import { useState, useEffect, useCallback, useRef } from "react";
import ReactMarkdown from "react-markdown";
import { Layout } from "@/components/Layout";
import { PageHeader } from "@/components/PageHeader";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { SeverityBadge } from "@/components/SeverityBadge";
import { CategoryBadge } from "@/components/CategoryBadge";
import { StatPills } from "@/components/StatPills";
import { EmptyState } from "@/components/EmptyState";
import { ErrorAlert } from "@/components/ErrorAlert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Copy } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
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
type Tab =
  | "analyze"
  | "scan"
  | "history"
  | "compare"
  | "incidents"
  | "schedules";

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
  const contextRef = useRef<string>("");
  const namespaceKeyRef = useRef<number>(0);
  const isLoadingNamespacesRef = useRef<boolean>(false);
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
  const [showAddToIncident, setShowAddToIncident] = useState(false);
  const [addToIncidentSearch, setAddToIncidentSearch] = useState("");
  const [creatingIncidentFromScan, setCreatingIncidentFromScan] =
    useState(false);
  const [creatingIncidentFromAnalysis, setCreatingIncidentFromAnalysis] =
    useState(false);

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
  const [scheduleCreateDialogOpen, setScheduleCreateDialogOpen] =
    useState(false);
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

  const loadContexts = useCallback(
    async (preserveCurrent: boolean = false) => {
      try {
        const list = await api.contexts();
        const currentSelectedContext = selectedContext; // Capture current value
        console.log(
          "[loadContexts] Called with preserveCurrent=",
          preserveCurrent,
          "current context=",
          currentSelectedContext,
        );

        setContexts(list);

        // If preserveCurrent is true and we already have a selected context, keep it
        if (preserveCurrent && currentSelectedContext) {
          // Verify the selected context still exists in the list
          const contextExists = list.some(
            (c) => c.name === currentSelectedContext,
          );
          if (contextExists) {
            // Context is still valid, keep it
            console.log(
              "[loadContexts] Preserving context:",
              currentSelectedContext,
            );
            return;
          }
          // Context no longer exists, fall through to set a new one
          console.log(
            "[loadContexts] Context",
            currentSelectedContext,
            "no longer exists, will set new one",
          );
        }

        // Set initial context (either first time or when preserveCurrent is false)
        const current = list.find((c) => c.current);
        const initialContext = current ? current.name : (list[0]?.name ?? "");
        if (initialContext) {
          // Only update if we don't have a selected context or if preserveCurrent is false
          if (!currentSelectedContext || !preserveCurrent) {
            if (initialContext !== currentSelectedContext) {
              console.log(
                "[loadContexts] Setting context from",
                currentSelectedContext,
                "to",
                initialContext,
              );
              contextRef.current = initialContext;
              setSelectedContext(initialContext);
            }
          } else {
            console.log(
              "[loadContexts] Skipping context change - preserveCurrent=true and context exists",
            );
          }
        }
      } catch (e) {
        setError(String(e));
      }
    },
    [selectedContext],
  );

  const loadNamespaces = useCallback(
    async (forContext?: string) => {
      const contextToUse = forContext ?? selectedContext;
      if (!contextToUse && contexts.length > 0) return;

      console.log(
        "[loadNamespaces] Loading namespaces for context:",
        contextToUse,
      );

      try {
        const list = await api.namespaces(
          contextToUse ? contextToUse : undefined,
        );
        console.log(
          "[loadNamespaces] Received namespaces:",
          list.length,
          "for context:",
          contextToUse,
        );
        // Always update - we're loading for the current context
        setNamespaces(list);
        // Always reset to first namespace when loading
        if (list.length > 0) {
          setSelectedNamespace(list[0]);
        } else {
          setSelectedNamespace("");
        }
      } catch (e) {
        console.error("[loadNamespaces] Error loading namespaces:", e);
        setNamespaces([]);
        setSelectedNamespace("");
      }
    },
    [selectedContext, contexts.length],
  );

  // Handler to change context and clear related state
  const handleContextChange = useCallback(
    async (newContext: string) => {
      console.log(
        "[handleContextChange] Changing context from",
        selectedContext,
        "to",
        newContext,
      );
      // Mark that we're loading namespaces to prevent useEffect from interfering
      isLoadingNamespacesRef.current = true;
      // Increment key to force React to recreate namespace selects
      namespaceKeyRef.current += 1;
      // Update ref immediately
      contextRef.current = newContext;
      // Clear namespaces and related state immediately
      setNamespaces([]);
      setSelectedNamespace("");
      setScanNamespace("");
      setScheduleCreateNamespace("");
      // Update context
      setSelectedContext(newContext);
      // Load namespaces for new context immediately - call API directly with no_cache to bypass cache
      try {
        const list = await api.namespaces(newContext, true);
        console.log(
          "[handleContextChange] Loaded",
          list.length,
          "namespaces for context:",
          newContext,
          "full list:",
          list,
        );
        // Verify context hasn't changed during async call
        if (contextRef.current === newContext) {
          console.log(
            "[handleContextChange] Setting namespaces state with",
            list.length,
            "items",
          );
          setNamespaces(list);
          if (list.length > 0) {
            setSelectedNamespace(list[0]);
            console.log(
              "[handleContextChange] Set selectedNamespace to:",
              list[0],
            );
          } else {
            setSelectedNamespace("");
          }
        } else {
          console.log(
            "[handleContextChange] Context changed during async call, ignoring result",
          );
        }
      } catch (e) {
        console.error("[handleContextChange] Error loading namespaces:", e);
        if (contextRef.current === newContext) {
          setNamespaces([]);
          setSelectedNamespace("");
        }
      } finally {
        // Allow useEffect to run again after a short delay
        setTimeout(() => {
          isLoadingNamespacesRef.current = false;
        }, 100);
      }
    },
    [selectedContext],
  );

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
    // Only set initial context on mount, preserve user selection afterwards
    loadContexts(false);
  }, []); // Empty deps - only run on mount
  // Load namespaces when context changes (only for initial load, manual changes use handleContextChange)
  useEffect(() => {
    // Skip if handleContextChange is currently loading namespaces
    if (isLoadingNamespacesRef.current) {
      console.log(
        "[useEffect] Skipping - handleContextChange is loading namespaces",
      );
      return;
    }

    if (selectedContext && contexts.length > 0) {
      // Check if this is the initial load (ref is empty) or if context changed externally
      const isInitialLoad = !contextRef.current;
      const contextChanged =
        contextRef.current && contextRef.current !== selectedContext;

      if (isInitialLoad || contextChanged) {
        console.log(
          "[useEffect] Loading namespaces for context:",
          selectedContext,
          "isInitial:",
          isInitialLoad,
        );
        contextRef.current = selectedContext;
        loadNamespaces();
      }
    }
  }, [selectedContext, loadNamespaces, contexts.length]);
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
      // Filter history by selected context
      const list = await api.history(30, selectedContext || undefined);
      setHistory(list);
    } catch {
      setHistory([]);
    }
  }, [selectedContext]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory, selectedContext]); // Reload when context changes

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
    console.log(
      "[useEffect tab] Tab changed to:",
      tab,
      "selectedContext:",
      selectedContext,
    );

    if (tab === "scan") {
      loadScanList();
      // Preserve current context when switching tabs - use current selectedContext value
      if (selectedContext) {
        loadContexts(true);
        loadNamespaces();
      } else {
        // No context selected yet, load initial one
        loadContexts(false);
      }
    }
    if (tab === "incidents") {
      loadIncidentList();
      loadHistory();
      loadScanList();
      // Preserve current context when switching tabs
      if (selectedContext) {
        loadContexts(true);
        loadNamespaces();
      } else {
        loadContexts(false);
      }
    }
    if (tab === "schedules") {
      loadScheduleList();
      // Preserve current context when switching tabs
      if (selectedContext) {
        loadContexts(true);
        loadNamespaces();
      } else {
        loadContexts(false);
      }
    }
    if (tab === "analyze") {
      // Preserve current context when switching tabs
      if (selectedContext) {
        loadContexts(true);
        loadNamespaces();
      } else {
        loadContexts(false);
      }
    }
  }, [
    tab,
    selectedContext,
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

  const handleCreateIncidentFromScan = async () => {
    if (!scanResult?.id) return;
    setCreatingIncidentFromScan(true);
    setIncidentError(null);
    try {
      const incident = await api.incidentFromScan({ scan_id: scanResult.id });
      await loadIncidentList();
      setSelectedIncidentId(incident.id);
      setIncidentDetail(incident);
      // Switch to incidents tab
      setTab("incidents");
    } catch (e) {
      setIncidentError(String(e));
    } finally {
      setCreatingIncidentFromScan(false);
    }
  };

  const handleCreateIncidentFromAnalysis = async (analysisId: string) => {
    setCreatingIncidentFromAnalysis(true);
    setIncidentError(null);
    try {
      const incident = await api.incidentFromAnalysis({
        analysis_id: analysisId,
      });
      await loadIncidentList();
      setSelectedIncidentId(incident.id);
      setIncidentDetail(incident);
      // Switch to incidents tab
      setTab("incidents");
    } catch (e) {
      setIncidentError(String(e));
    } finally {
      setCreatingIncidentFromAnalysis(false);
    }
  };

  const handleAddToExistingIncident = async (
    incidentId: string,
    itemType: "scan" | "analysis",
    refId: string,
  ) => {
    setIncidentLoading(true);
    setIncidentError(null);
    try {
      await api.incidentAddItem(incidentId, { type: itemType, ref_id: refId });
      setShowAddToIncident(false);
      setAddToIncidentSearch("");
      if (selectedIncidentId === incidentId) {
        const detail = await api.incidentGet(incidentId);
        setIncidentDetail(detail);
      }
    } catch (e) {
      setIncidentError(String(e));
    } finally {
      setIncidentLoading(false);
    }
  };

  const handleUpdateIncident = async (
    incidentId: string,
    updates: {
      title?: string;
      description?: string;
      status?: "open" | "mitigating" | "resolved";
      severity?: "info" | "low" | "medium" | "high" | "critical";
      tags?: string[];
    },
  ) => {
    setIncidentLoading(true);
    setIncidentError(null);
    try {
      const updated = await api.incidentUpdate(incidentId, updates);
      setIncidentDetail(updated);
      await loadIncidentList();
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

  return (
    <Layout currentTab={tab} onTabChange={setTab}>
      <div className="space-y-6">
        {tab === "incidents" && (
          <>
            <PageHeader
              title="Incidents"
              subtitle="Group analyses and scans into incidents; add notes and export timeline"
            />
            {incidentError && (
              <ErrorAlert
                message={incidentError}
                onDismiss={() => setIncidentError(null)}
              />
            )}
            <Card>
              <CardHeader>
                <CardTitle>Create New Incident</CardTitle>
                <CardDescription>
                  Create a new incident to track and manage related analyses and
                  scans
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="incident-title">Title</Label>
                  <Input
                    id="incident-title"
                    type="text"
                    value={incidentCreateTitle}
                    onChange={(e) => setIncidentCreateTitle(e.target.value)}
                    placeholder="Incident title"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="incident-description">Description</Label>
                  <Textarea
                    id="incident-description"
                    value={incidentCreateDesc}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                      setIncidentCreateDesc(e.target.value)
                    }
                    placeholder="Optional description"
                    rows={3}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="incident-severity">Severity</Label>
                  <Select
                    value={incidentCreateSeverity}
                    onValueChange={setIncidentCreateSeverity}
                  >
                    <SelectTrigger id="incident-severity">
                      <SelectValue placeholder="Select severity (optional)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">—</SelectItem>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="critical">Critical</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  onClick={handleCreateIncident}
                  disabled={incidentLoading || !incidentCreateTitle.trim()}
                  className="w-full md:w-auto"
                >
                  {incidentLoading ? "Creating…" : "Create incident"}
                </Button>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Incident List</CardTitle>
                <CardDescription>
                  {incidentList.length > 0
                    ? `${incidentList.length} incident${incidentList.length !== 1 ? "s" : ""}`
                    : "No incidents yet"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {incidentList.length > 0 ? (
                  <div className="space-y-2">
                    {incidentList.map((inc) => (
                      <div
                        key={inc.id}
                        className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                          selectedIncidentId === inc.id
                            ? "border-primary bg-primary/5"
                            : "hover:bg-muted/50"
                        }`}
                        onClick={() => openIncidentDetail(inc.id)}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="font-semibold truncate">
                              {inc.title}
                            </h4>
                            {inc.severity && (
                              <SeverityBadge severity={inc.severity as any} />
                            )}
                            <Badge
                              variant={
                                inc.status === "open"
                                  ? "default"
                                  : inc.status === "mitigating"
                                    ? "secondary"
                                    : "outline"
                              }
                            >
                              {inc.status}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {new Date(inc.created_at).toLocaleString()}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (confirm(`Delete incident "${inc.title}"?`)) {
                              try {
                                await api.incidentDelete(inc.id);
                                setIncidentList((prev) =>
                                  prev.filter((item) => item.id !== inc.id),
                                );
                                if (selectedIncidentId === inc.id) {
                                  setSelectedIncidentId(null);
                                  setIncidentDetail(null);
                                }
                              } catch (e) {
                                setIncidentError(`Failed to delete: ${e}`);
                              }
                            }
                          }}
                          className="text-destructive hover:text-destructive"
                        >
                          Delete
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    title="No incidents yet"
                    description="Create an incident from a scan or analysis, or create one manually above"
                  />
                )}
              </CardContent>
            </Card>
            {incidentDetail && (
              <Card>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <CardTitle>{incidentDetail.title}</CardTitle>
                        <Select
                          value={incidentDetail.status}
                          onValueChange={(v) =>
                            handleUpdateIncident(incidentDetail.id, {
                              status: v as "open" | "mitigating" | "resolved",
                            })
                          }
                          disabled={incidentLoading}
                        >
                          <SelectTrigger className="w-[140px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="open">Open</SelectItem>
                            <SelectItem value="mitigating">
                              Mitigating
                            </SelectItem>
                            <SelectItem value="resolved">Resolved</SelectItem>
                          </SelectContent>
                        </Select>
                        {incidentDetail.severity && (
                          <SeverityBadge
                            severity={incidentDetail.severity as any}
                          />
                        )}
                      </div>
                      {incidentDetail.description && (
                        <CardDescription className="mt-1">
                          {incidentDetail.description}
                        </CardDescription>
                      )}
                      <div className="flex flex-wrap gap-4 mt-3 text-sm text-muted-foreground">
                        <span>
                          Created{" "}
                          {new Date(incidentDetail.created_at).toLocaleString()}
                        </span>
                        {incidentDetail.updated_at &&
                          incidentDetail.updated_at !==
                            incidentDetail.created_at && (
                            <span>
                              Updated{" "}
                              {new Date(
                                incidentDetail.updated_at,
                              ).toLocaleString()}
                            </span>
                          )}
                        <span>• {incidentDetail.items_count} items</span>
                        <span>• {incidentDetail.notes_count} notes</span>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSelectedIncidentId(null);
                        setIncidentDetail(null);
                      }}
                    >
                      ← Back
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-2">
                    <Label htmlFor="incident-tags">
                      Tags (comma-separated)
                    </Label>
                    <Input
                      id="incident-tags"
                      type="text"
                      value={incidentDetail.tags.join(", ")}
                      onChange={(e) => {
                        const tags = e.target.value
                          .split(",")
                          .map((t) => t.trim())
                          .filter((t) => t);
                        handleUpdateIncident(incidentDetail.id, { tags });
                      }}
                      disabled={incidentLoading}
                      placeholder="tag1, tag2, tag3"
                    />
                    {incidentDetail.tags.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {incidentDetail.tags.map((tag, i) => (
                          <Badge key={i} variant="secondary">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div>
                      <h3 className="text-lg font-semibold mb-4">Timeline</h3>
                      {incidentDetail.timeline &&
                      incidentDetail.timeline.length > 0 ? (
                        <div className="space-y-4">
                          {incidentDetail.timeline.map((entry, idx) => (
                            <div
                              key={idx}
                              className="relative pl-6 border-l-2 border-muted"
                            >
                              <div className="absolute -left-2 top-0 w-4 h-4 rounded-full bg-background border-2 border-muted" />
                              <div className="text-xs text-muted-foreground mb-2">
                                {new Date(
                                  entry.created_at || "",
                                ).toLocaleString()}
                              </div>
                              {entry.type === "incident_created" && (
                                <div className="flex items-center gap-2">
                                  <Badge variant="outline">CREATED</Badge>
                                  <span className="text-sm">
                                    Incident created
                                  </span>
                                </div>
                              )}
                              {entry.type === "item" && (
                                <div className="flex items-center gap-2 flex-wrap">
                                  <Badge
                                    variant={
                                      entry.item_type === "analysis"
                                        ? "secondary"
                                        : "outline"
                                    }
                                  >
                                    {entry.item_type?.toUpperCase() ||
                                      "UNKNOWN"}
                                  </Badge>
                                  <code className="text-xs bg-muted px-1 rounded">
                                    {entry.ref_id}
                                  </code>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={async () => {
                                      if (!entry.ref_id) return;
                                      if (entry.item_type === "analysis") {
                                        setTab("history");
                                        setViewHistoryId(entry.ref_id);
                                        const detail = await api.historyGet(
                                          entry.ref_id,
                                        );
                                        setHistoryDetail(detail);
                                      } else if (entry.item_type === "scan") {
                                        const detail = await api.scanGet(
                                          entry.ref_id,
                                        );
                                        const findings = detail.findings ?? [];
                                        const counts: Record<string, number> =
                                          {};
                                        findings.forEach((f) => {
                                          counts[f.severity] =
                                            (counts[f.severity] ?? 0) + 1;
                                        });
                                        setScanResult({
                                          id: detail.id,
                                          created_at:
                                            detail.created_at ?? undefined,
                                          summary_markdown:
                                            detail.summary_markdown ?? null,
                                          error: detail.error ?? null,
                                          findings,
                                          counts,
                                        });
                                        setTab("scan");
                                      }
                                    }}
                                  >
                                    Open {entry.item_type || "item"}
                                  </Button>
                                </div>
                              )}
                              {entry.type === "note" && (
                                <div>
                                  <Badge variant="outline" className="mb-2">
                                    NOTE
                                  </Badge>
                                  <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                                    {entry.content}
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <EmptyState
                          title="No timeline entries"
                          description="Add items or notes to see them here"
                        />
                      )}
                    </div>

                    <div className="space-y-6">
                      <div>
                        <h3 className="text-lg font-semibold mb-4">Add Item</h3>
                        <Card>
                          <CardContent className="space-y-3 pt-6">
                            <div className="space-y-2">
                              <Label htmlFor="add-item-type">Type</Label>
                              <Select
                                value={addItemType}
                                onValueChange={(v) =>
                                  setAddItemType(v as "analysis" | "scan")
                                }
                              >
                                <SelectTrigger id="add-item-type">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="analysis">
                                    Analysis
                                  </SelectItem>
                                  <SelectItem value="scan">Scan</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="add-item-ref">Select Item</Label>
                              <Select
                                value={addItemRefId}
                                onValueChange={setAddItemRefId}
                              >
                                <SelectTrigger id="add-item-ref">
                                  <SelectValue placeholder="Select an item" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="">Select…</SelectItem>
                                  {addItemType === "analysis" &&
                                    history.map((h) => (
                                      <SelectItem key={h.id} value={h.id}>
                                        {h.kind} {h.name} –{" "}
                                        {new Date(
                                          h.created_at,
                                        ).toLocaleDateString()}
                                      </SelectItem>
                                    ))}
                                  {addItemType === "scan" &&
                                    scanList.map((s) => (
                                      <SelectItem key={s.id} value={s.id}>
                                        {s.scope} {s.namespace || ""} –{" "}
                                        {new Date(
                                          s.created_at,
                                        ).toLocaleDateString()}
                                      </SelectItem>
                                    ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <Button
                              onClick={handleAddItemToIncident}
                              disabled={incidentLoading || !addItemRefId.trim()}
                              className="w-full"
                            >
                              Add Item
                            </Button>
                          </CardContent>
                        </Card>
                      </div>

                      <div>
                        <h3 className="text-lg font-semibold mb-4">Add Note</h3>
                        <Card>
                          <CardContent className="space-y-3 pt-6">
                            <div className="space-y-2">
                              <Label htmlFor="add-note-content">
                                Note Content
                              </Label>
                              <Textarea
                                id="add-note-content"
                                value={addNoteContent}
                                onChange={(
                                  e: React.ChangeEvent<HTMLTextAreaElement>,
                                ) => setAddNoteContent(e.target.value)}
                                placeholder="Enter note content..."
                                rows={4}
                              />
                            </div>
                            <Button
                              onClick={handleAddNoteToIncident}
                              disabled={
                                incidentLoading || !addNoteContent.trim()
                              }
                              className="w-full"
                            >
                              {incidentLoading ? "Adding…" : "Add Note"}
                            </Button>
                          </CardContent>
                        </Card>
                      </div>

                      <div>
                        <h3 className="text-lg font-semibold mb-4">Export</h3>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            onClick={() => handleExportIncident("markdown")}
                            disabled={exportLoading}
                            className="flex-1"
                          >
                            {exportLoading ? "Exporting…" : "Export Markdown"}
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => handleExportIncident("json")}
                            disabled={exportLoading}
                            className="flex-1"
                          >
                            Export JSON
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}

        {tab === "schedules" && (
          <>
            <PageHeader
              title="Scheduled Scans"
              subtitle="Run cluster or namespace scans on a cron schedule. Results are stored like manual scans."
              actions={
                <Button onClick={() => setScheduleCreateDialogOpen(true)}>
                  Create Schedule
                </Button>
              }
            />
            {scheduleError && (
              <ErrorAlert
                message={scheduleError}
                onDismiss={() => setScheduleError(null)}
              />
            )}
            <Card>
              <CardHeader>
                <CardTitle>Schedules</CardTitle>
                <CardDescription>
                  {scheduleList.length > 0
                    ? `${scheduleList.length} schedule${scheduleList.length !== 1 ? "s" : ""} configured`
                    : "No schedules configured yet"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {scheduleList.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Cron Expression</TableHead>
                        <TableHead>Scope</TableHead>
                        <TableHead>Namespace</TableHead>
                        <TableHead>Context</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {scheduleList.map((s) => (
                        <TableRow key={s.id}>
                          <TableCell>
                            <code className="text-sm bg-muted px-2 py-1 rounded">
                              {s.cron}
                            </code>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {s.scope === "cluster" ? "Cluster" : "Namespace"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {s.scope === "namespace" ? (
                              <Badge variant="secondary">
                                {s.namespace || "—"}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {s.context ? (
                              <Badge variant="outline">{s.context}</Badge>
                            ) : (
                              <span className="text-muted-foreground">
                                default
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={s.enabled ? "default" : "secondary"}
                            >
                              {s.enabled ? "Enabled" : "Disabled"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => startEditSchedule(s)}
                              >
                                Edit
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleScheduleDelete(s.id)}
                                disabled={scheduleLoading}
                                className="text-destructive hover:text-destructive"
                              >
                                Delete
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <EmptyState
                    title="No schedules yet"
                    description="Create a schedule to automatically run scans on a cron schedule"
                    action={{
                      label: "Create Schedule",
                      onClick: () => setScheduleCreateDialogOpen(true),
                    }}
                  />
                )}
              </CardContent>
            </Card>

            <Dialog
              open={scheduleCreateDialogOpen}
              onOpenChange={setScheduleCreateDialogOpen}
            >
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Create Schedule</DialogTitle>
                  <DialogDescription>
                    Configure a scheduled scan to run automatically on a cron
                    schedule
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  {contexts.length > 0 && (
                    <div className="space-y-2">
                      <Label htmlFor="schedule-context">Context</Label>
                      <Select
                        value={scheduleCreateContext}
                        onValueChange={(v) => {
                          setScheduleCreateContext(v);
                          if (v) handleContextChange(v);
                        }}
                      >
                        <SelectTrigger id="schedule-context">
                          <SelectValue placeholder="(default)" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">(default)</SelectItem>
                          {contexts.map((c) => (
                            <SelectItem key={c.name} value={c.name}>
                              {c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="schedule-scope">Scope</Label>
                    <Select
                      value={scheduleCreateScope}
                      onValueChange={(v) =>
                        setScheduleCreateScope(v as "namespace" | "cluster")
                      }
                    >
                      <SelectTrigger id="schedule-scope">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="namespace">Namespace</SelectItem>
                        <SelectItem value="cluster">Cluster</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {scheduleCreateScope === "namespace" && (
                    <div className="space-y-2">
                      <Label htmlFor="schedule-namespace">Namespace</Label>
                      <Select
                        value={scheduleCreateNamespace}
                        onValueChange={setScheduleCreateNamespace}
                      >
                        <SelectTrigger id="schedule-namespace">
                          <SelectValue placeholder="Select namespace" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">Select…</SelectItem>
                          {namespaces.map((n) => (
                            <SelectItem key={n} value={n}>
                              {n}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="schedule-cron">
                      Cron Expression (5 parts: minute hour day month weekday)
                    </Label>
                    <Input
                      id="schedule-cron"
                      type="text"
                      value={scheduleCreateCron}
                      onChange={(e) => setScheduleCreateCron(e.target.value)}
                      placeholder="0 * * * *"
                      className="font-mono"
                    />
                    <p className="text-xs text-muted-foreground">
                      Format: <code>minute hour day month weekday</code>
                      <br />
                      Examples: <code>0 * * * *</code> (every hour),{" "}
                      <code>0 0 * * *</code> (daily at midnight),{" "}
                      <code>0 0 * * 0</code> (weekly on Sunday)
                    </p>
                    {scheduleCreateCron &&
                      !/^(\*|[0-5]?\d) (\*|[01]?\d|2[0-3]) (\*|[012]?\d|3[01]) (\*|[01]?\d) (\*|[0-6])$/.test(
                        scheduleCreateCron.trim(),
                      ) && (
                        <p className="text-xs text-destructive">
                          Invalid cron expression. Use format:{" "}
                          <code>minute hour day month weekday</code>
                        </p>
                      )}
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="schedule-enabled"
                      checked={scheduleCreateEnabled}
                      onCheckedChange={(checked: boolean) =>
                        setScheduleCreateEnabled(checked === true)
                      }
                    />
                    <Label
                      htmlFor="schedule-enabled"
                      className="cursor-pointer"
                    >
                      Enabled
                    </Label>
                  </div>
                  <div className="flex justify-end gap-2 pt-4">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setScheduleCreateDialogOpen(false);
                        setScheduleCreateCron("0 * * * *");
                        setScheduleCreateEnabled(true);
                        setScheduleCreateScope("namespace");
                        setScheduleCreateNamespace("");
                        setScheduleCreateContext("");
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={() => {
                        handleScheduleCreate();
                        setScheduleCreateDialogOpen(false);
                      }}
                      disabled={
                        scheduleLoading ||
                        !scheduleCreateCron.trim() ||
                        (scheduleCreateScope === "namespace" &&
                          !scheduleCreateNamespace.trim()) ||
                        !/^(\*|[0-5]?\d) (\*|[01]?\d|2[0-3]) (\*|[012]?\d|3[01]) (\*|[01]?\d) (\*|[0-6])$/.test(
                          scheduleCreateCron.trim(),
                        )
                      }
                    >
                      {scheduleLoading ? "Creating…" : "Create Schedule"}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            {editingScheduleId && (
              <Dialog
                open={!!editingScheduleId}
                onOpenChange={(open) => !open && setEditingScheduleId(null)}
              >
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Edit Schedule</DialogTitle>
                    <DialogDescription>
                      Update the cron expression and enabled status
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="edit-schedule-cron">
                        Cron Expression (5 parts)
                      </Label>
                      <Input
                        id="edit-schedule-cron"
                        type="text"
                        value={editScheduleCron}
                        onChange={(e) => setEditScheduleCron(e.target.value)}
                        placeholder="0 * * * *"
                        className="font-mono"
                      />
                      <p className="text-xs text-muted-foreground">
                        Format: <code>minute hour day month weekday</code>
                      </p>
                      {editScheduleCron &&
                        !/^(\*|[0-5]?\d) (\*|[01]?\d|2[0-3]) (\*|[012]?\d|3[01]) (\*|[01]?\d) (\*|[0-6])$/.test(
                          editScheduleCron.trim(),
                        ) && (
                          <p className="text-xs text-destructive">
                            Invalid cron expression
                          </p>
                        )}
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="edit-schedule-enabled"
                        checked={editScheduleEnabled}
                        onCheckedChange={(checked: boolean) =>
                          setEditScheduleEnabled(checked === true)
                        }
                      />
                      <Label
                        htmlFor="edit-schedule-enabled"
                        className="cursor-pointer"
                      >
                        Enabled
                      </Label>
                    </div>
                    <div className="flex justify-end gap-2 pt-4">
                      <Button
                        variant="outline"
                        onClick={() => setEditingScheduleId(null)}
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={() => {
                          handleScheduleUpdate();
                          setEditingScheduleId(null);
                        }}
                        disabled={
                          scheduleLoading ||
                          !editScheduleCron.trim() ||
                          !/^(\*|[0-5]?\d) (\*|[01]?\d|2[0-3]) (\*|[012]?\d|3[01]) (\*|[01]?\d) (\*|[0-6])$/.test(
                            editScheduleCron.trim(),
                          )
                        }
                      >
                        {scheduleLoading ? "Saving…" : "Save"}
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            )}
          </>
        )}

        {tab === "scan" && (
          <>
            <PageHeader
              title="Cluster Health Scan"
              subtitle="Scan your cluster or namespace for security and configuration issues"
            />
            {scanError && (
              <ErrorAlert
                message={scanError}
                onDismiss={() => setScanError(null)}
              />
            )}
            <Card>
              <CardHeader>
                <CardTitle>Scan Configuration</CardTitle>
                <CardDescription>
                  Configure scan scope and options
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {showContextSelect && (
                  <div className="space-y-2">
                    <Label htmlFor="scan-context-select">Context</Label>
                    <Select
                      value={selectedContext}
                      onValueChange={handleContextChange}
                    >
                      <SelectTrigger id="scan-context-select">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {contexts.map((c) => (
                          <SelectItem key={c.name} value={c.name}>
                            {c.name}
                            {c.current ? " (current)" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="scan-scope-select">Scope</Label>
                    <Select
                      value={scanScope}
                      onValueChange={(v) =>
                        setScanScope(v as "namespace" | "cluster")
                      }
                    >
                      <SelectTrigger id="scan-scope-select">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="namespace">Namespace</SelectItem>
                        <SelectItem value="cluster">Cluster</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {scanScope === "namespace" && (
                    <div className="space-y-2">
                      <Label htmlFor="scan-namespace-select">Namespace</Label>
                      <Select
                        key={`scan-namespace-${selectedContext}-${namespaceKeyRef.current}`}
                        value={scanNamespace}
                        onValueChange={setScanNamespace}
                      >
                        <SelectTrigger id="scan-namespace-select">
                          <SelectValue placeholder="Select namespace" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">Select...</SelectItem>
                          {namespaces.map((ns) => (
                            <SelectItem key={ns} value={ns}>
                              {ns}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="scan-include-logs"
                    checked={scanIncludeLogs}
                    onChange={(e) => setScanIncludeLogs(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <Label htmlFor="scan-include-logs" className="cursor-pointer">
                    Include logs in evidence
                  </Label>
                </div>
                <Button
                  onClick={handleScan}
                  disabled={
                    scanLoading ||
                    (scanScope === "namespace" && !scanNamespace.trim())
                  }
                  className="w-full md:w-auto"
                >
                  {scanLoading ? "Scanning…" : "Scan"}
                </Button>
              </CardContent>
            </Card>

            {scanResult && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>
                        {llmProviderLabel ? `${llmProviderLabel} – ` : ""}
                        Scan Results
                      </CardTitle>
                      {scanResult.duration_ms != null &&
                        scanResult.duration_ms >= 0 && (
                          <CardDescription className="mt-1">
                            Duration:{" "}
                            {scanResult.duration_ms >= 1000
                              ? `${(scanResult.duration_ms / 1000).toFixed(1)}s`
                              : `${scanResult.duration_ms}ms`}
                          </CardDescription>
                        )}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        onClick={handleCreateIncidentFromScan}
                        disabled={creatingIncidentFromScan || !scanResult.id}
                        size="sm"
                        variant="outline"
                      >
                        {creatingIncidentFromScan
                          ? "Creating…"
                          : "Create incident"}
                      </Button>
                      <Button
                        onClick={() => setShowAddToIncident(!showAddToIncident)}
                        disabled={incidentLoading}
                        size="sm"
                        variant="outline"
                      >
                        Add to incident
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {showAddToIncident && scanResult.id && (
                    <div className="rounded-lg border p-4 space-y-2">
                      <Input
                        type="text"
                        placeholder="Search incidents..."
                        value={addToIncidentSearch}
                        onChange={(e) => setAddToIncidentSearch(e.target.value)}
                      />
                      <div className="max-h-48 overflow-y-auto space-y-1">
                        {incidentList
                          .filter(
                            (inc) =>
                              addToIncidentSearch.trim() === "" ||
                              inc.title
                                .toLowerCase()
                                .includes(addToIncidentSearch.toLowerCase()),
                          )
                          .map((inc) => (
                            <Button
                              key={inc.id}
                              type="button"
                              variant="outline"
                              onClick={() =>
                                handleAddToExistingIncident(
                                  inc.id,
                                  "scan",
                                  scanResult.id!,
                                )
                              }
                              disabled={incidentLoading}
                              className="w-full justify-start text-left"
                              size="sm"
                            >
                              {inc.title} ({inc.status})
                            </Button>
                          ))}
                        {incidentList.filter(
                          (inc) =>
                            addToIncidentSearch.trim() === "" ||
                            inc.title
                              .toLowerCase()
                              .includes(addToIncidentSearch.toLowerCase()),
                        ).length === 0 && (
                          <div className="p-2 text-sm text-muted-foreground text-center">
                            No incidents found
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  {scanResult.error && (
                    <ErrorAlert message={scanResult.error} />
                  )}
                  {scanResult.summary_markdown && (
                    <div className="rounded-lg border bg-muted/50 p-4">
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
                            <h3 className="text-lg font-semibold mb-2">
                              {heading}
                            </h3>
                            <div className="flex flex-wrap gap-2 mb-2">
                              {severities.map((s) => (
                                <div
                                  key={s.key}
                                  className="flex items-center gap-1"
                                >
                                  <SeverityBadge
                                    severity={s.key}
                                    className="text-xs"
                                  />
                                  <span className="text-xs">
                                    {s.label}: {counts[s.key] ?? 0}
                                  </span>
                                </div>
                              ))}
                            </div>
                            <p className="text-sm text-muted-foreground">
                              Total findings: {total}
                            </p>
                          </>
                        );
                      })()}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="severity-filter">Severity</Label>
                      <Select
                        value={scanFilterSeverity}
                        onValueChange={setScanFilterSeverity}
                      >
                        <SelectTrigger
                          id="severity-filter"
                          className="w-[180px]"
                        >
                          <SelectValue placeholder="All severities" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">All</SelectItem>
                          {severities.map((s) => (
                            <SelectItem key={s} value={s}>
                              {s}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="category-filter">Category</Label>
                      <Select
                        value={scanFilterCategory}
                        onValueChange={setScanFilterCategory}
                      >
                        <SelectTrigger
                          id="category-filter"
                          className="w-[180px]"
                        >
                          <SelectValue placeholder="All categories" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">All</SelectItem>
                          {categories.map((c) => (
                            <SelectItem key={c} value={c}>
                              {c}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {sortedFindings.length > 0 ? (
                    <div className="rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-[120px]">
                              Severity
                            </TableHead>
                            <TableHead className="w-[150px]">
                              Category
                            </TableHead>
                            <TableHead>Title</TableHead>
                            <TableHead className="w-[120px]">Time</TableHead>
                            <TableHead className="w-[100px]">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {sortedFindings.map((f) => (
                            <TableRow
                              key={f.id}
                              className="cursor-pointer"
                              onClick={() => setSelectedFinding(f)}
                            >
                              <TableCell>
                                <SeverityBadge severity={f.severity} />
                              </TableCell>
                              <TableCell>
                                <CategoryBadge category={f.category} />
                              </TableCell>
                              <TableCell className="font-medium">
                                {f.title}
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {(f.occurred_at ?? scanResult.created_at) &&
                                  new Date(
                                    f.occurred_at ?? scanResult.created_at!,
                                  ).toLocaleString(undefined, {
                                    month: "2-digit",
                                    day: "2-digit",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                              </TableCell>
                              <TableCell>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedFinding(f);
                                  }}
                                >
                                  View
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ) : (
                    <EmptyState
                      title="No findings"
                      description="No findings match the current filters"
                    />
                  )}
                </CardContent>
              </Card>
            )}

            <Sheet
              open={!!selectedFinding}
              onOpenChange={(open) => !open && setSelectedFinding(null)}
            >
              <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
                {selectedFinding && (
                  <>
                    <SheetHeader>
                      <div className="flex items-center gap-2">
                        <SeverityBadge severity={selectedFinding.severity} />
                        <CategoryBadge category={selectedFinding.category} />
                      </div>
                      <SheetTitle>{selectedFinding.title}</SheetTitle>
                      <SheetDescription>
                        {selectedFinding.description ||
                          "No description available"}
                      </SheetDescription>
                    </SheetHeader>
                    <div className="mt-6 space-y-4">
                      {selectedFinding.affected_refs?.length > 0 && (
                        <div>
                          <h4 className="text-sm font-semibold mb-2">
                            Affected Resources
                          </h4>
                          <div className="space-y-1">
                            {selectedFinding.affected_refs.map((r, i) => (
                              <Badge key={i} variant="outline" className="mr-2">
                                {r.kind || "?"}/
                                {r.namespace ? `${r.namespace}/` : ""}
                                {r.name || "?"}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                      {selectedFinding.evidence_snippet && (
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <h4 className="text-sm font-semibold">Evidence</h4>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                navigator.clipboard.writeText(
                                  selectedFinding.evidence_snippet!,
                                );
                              }}
                            >
                              <Copy className="h-4 w-4 mr-2" />
                              Copy
                            </Button>
                          </div>
                          <div className="rounded-lg border bg-muted/30 p-4 font-mono text-xs overflow-auto max-h-96">
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
                          </div>
                        </div>
                      )}
                      {selectedFinding.suggested_commands?.length > 0 && (
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <h4 className="text-sm font-semibold">
                              Suggested Commands
                            </h4>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                navigator.clipboard.writeText(
                                  selectedFinding.suggested_commands!.join(
                                    "\n",
                                  ),
                                );
                              }}
                            >
                              <Copy className="h-4 w-4 mr-2" />
                              Copy All
                            </Button>
                          </div>
                          <div className="space-y-2">
                            {selectedFinding.suggested_commands.map(
                              (cmd, i) => (
                                <div
                                  key={i}
                                  className="flex items-center justify-between rounded-lg border bg-muted/30 p-3 font-mono text-xs"
                                >
                                  <code>{cmd}</code>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                      navigator.clipboard.writeText(cmd);
                                    }}
                                  >
                                    <Copy className="h-3 w-3" />
                                  </Button>
                                </div>
                              ),
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </SheetContent>
            </Sheet>

            <Card>
              <CardHeader>
                <CardTitle>Recent Scans</CardTitle>
                <CardDescription>
                  View and load previous scan results
                </CardDescription>
              </CardHeader>
              <CardContent>
                {scanList.length > 0 ? (
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Scope</TableHead>
                          <TableHead>Namespace</TableHead>
                          <TableHead>Findings</TableHead>
                          <TableHead>Created</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {scanList.slice(0, 15).map((s) => (
                          <TableRow key={s.id}>
                            <TableCell className="font-medium">
                              {s.scope}
                            </TableCell>
                            <TableCell>{s.namespace || "—"}</TableCell>
                            <TableCell>{s.findings_count}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {new Date(s.created_at).toLocaleString()}
                            </TableCell>
                            <TableCell>
                              {s.error ? (
                                <Badge variant="destructive">Partial</Badge>
                              ) : (
                                <Badge variant="outline">Complete</Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={async () => {
                                  try {
                                    const detail = await api.scanGet(s.id);
                                    const findings = detail.findings ?? [];
                                    const counts: Record<string, number> = {};
                                    findings.forEach((f) => {
                                      counts[f.severity] =
                                        (counts[f.severity] ?? 0) + 1;
                                    });
                                    setScanResult({
                                      id: detail.id,
                                      created_at:
                                        detail.created_at ?? undefined,
                                      summary_markdown:
                                        detail.summary_markdown ?? null,
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
                                Load
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <EmptyState
                    title="No scans yet"
                    description="Run a scan to see results here"
                  />
                )}
              </CardContent>
            </Card>
          </>
        )}

        {tab === "analyze" && (
          <>
            <PageHeader
              title="Analyze Resource"
              subtitle="Troubleshoot Kubernetes resources with AI-powered analysis"
            />
            {error && (
              <ErrorAlert message={error} onDismiss={() => setError(null)} />
            )}
            <Card>
              <CardHeader>
                <CardTitle>Resource Selection</CardTitle>
                <CardDescription>
                  Select a Kubernetes resource to analyze
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {showContextSelect && (
                  <div className="space-y-2">
                    <Label htmlFor="context-select">Context</Label>
                    <Select
                      value={selectedContext}
                      onValueChange={handleContextChange}
                    >
                      <SelectTrigger id="context-select">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {contexts.map((c) => (
                          <SelectItem key={c.name} value={c.name}>
                            {c.name}
                            {c.current ? " (current)" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="namespace-select">Namespace</Label>
                    <Select
                      key={`namespace-${selectedContext}-${namespaceKeyRef.current}`}
                      value={selectedNamespace}
                      onValueChange={setSelectedNamespace}
                      disabled={kind === "Node"}
                    >
                      <SelectTrigger id="namespace-select">
                        <SelectValue placeholder="Select namespace" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">--</SelectItem>
                        {namespaces.map((ns) => (
                          <SelectItem key={ns} value={ns}>
                            {ns}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="kind-select">Target</Label>
                    <Select
                      value={kind}
                      onValueChange={(v) => setKind(v as Kind)}
                    >
                      <SelectTrigger id="kind-select">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Pod">Pod</SelectItem>
                        <SelectItem value="Deployment">Deployment</SelectItem>
                        <SelectItem value="StatefulSet">StatefulSet</SelectItem>
                        <SelectItem value="Node">Node</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="resource-select">Resource</Label>
                  <Select
                    value={selectedName}
                    onValueChange={setSelectedName}
                    disabled={resourceNames.length === 0}
                  >
                    <SelectTrigger id="resource-select">
                      <SelectValue placeholder="Select resource" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Select...</SelectItem>
                      {resourceNames.map((r) => (
                        <SelectItem key={r.name} value={r.name}>
                          {r.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="include-logs"
                    checked={includePreviousLogs}
                    onChange={(e) => setIncludePreviousLogs(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <Label htmlFor="include-logs" className="cursor-pointer">
                    Include previous logs (e.g. crash)
                  </Label>
                </div>
                <Button
                  onClick={handleAnalyze}
                  disabled={loading || !selectedName.trim()}
                  className="w-full md:w-auto"
                >
                  {loading ? "Analyzing…" : "Analyze"}
                </Button>
              </CardContent>
            </Card>

            {result && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>
                      {llmProviderLabel ? `${llmProviderLabel} – ` : ""}
                      Analysis Result
                    </CardTitle>
                    <StatPills
                      items={
                        [
                          result.tokens_used > 0
                            ? {
                                label: "Tokens",
                                value: result.tokens_used.toLocaleString(),
                              }
                            : null,
                          result.response_time_ms > 0
                            ? {
                                label: "Time",
                                value:
                                  result.response_time_ms >= 1000
                                    ? `${(result.response_time_ms / 1000).toFixed(1)}s`
                                    : `${result.response_time_ms}ms`,
                              }
                            : null,
                        ].filter(Boolean) as Array<{
                          label: string;
                          value: string | number;
                        }>
                      }
                    />
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {result.error && <ErrorAlert message={result.error} />}
                  {result.analysis_markdown && (
                    <div className="markdown-body rounded-lg border bg-muted/50 p-4">
                      <ReactMarkdown>{result.analysis_markdown}</ReactMarkdown>
                    </div>
                  )}
                  {result.truncation_report?.truncated && (
                    <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800">
                      Evidence was truncated (
                      {result.truncation_report.total_chars_after} /{" "}
                      {result.truncation_report.total_chars_before} chars).
                    </div>
                  )}
                  <div className="space-y-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setEvidenceOpen(!evidenceOpen)}
                      className="w-full justify-between"
                    >
                      <span>Raw evidence (sanitized)</span>
                      <span>{evidenceOpen ? "▼" : "▶"}</span>
                    </Button>
                    {evidenceOpen && (
                      <div className="rounded-lg border bg-muted/30 p-4 font-mono text-xs overflow-auto max-h-96">
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
                    <div className="space-y-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setExplainOpen(!explainOpen)}
                        className="w-full justify-between"
                      >
                        <span>Explain reasoning</span>
                        <span>{explainOpen ? "▼" : "▶"}</span>
                      </Button>
                      {explainOpen && (
                        <div className="rounded-lg border bg-muted/30 p-4 space-y-4">
                          {result.analysis_json.heuristics?.length ? (
                            <section className="space-y-2">
                              <h4 className="text-sm font-semibold">
                                Heuristic signals
                              </h4>
                              <ul className="list-disc list-inside space-y-1 text-sm">
                                {result.analysis_json.heuristics.map((h, i) => (
                                  <li key={i}>
                                    <strong>{h.condition}</strong>{" "}
                                    {h.evidence_refs?.length
                                      ? `(${h.evidence_refs.join(", ")})`
                                      : ""}
                                    <ul className="list-disc list-inside ml-4 space-y-1 text-sm">
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
                            <section className="space-y-2">
                              <h4 className="text-sm font-semibold">
                                Evidence mapping
                              </h4>
                              <ul className="list-disc list-inside space-y-1 text-sm">
                                {result.analysis_json.why.map((w, i) => (
                                  <li key={i}>
                                    <code className="text-xs bg-muted px-1 rounded">
                                      {w.ref}
                                    </code>
                                    : {w.explanation}
                                  </li>
                                ))}
                              </ul>
                            </section>
                          ) : null}
                          {(result.analysis_json.uncertain?.length ||
                            (result.analysis_json.follow_up_questions?.length ??
                              0) > 0) && (
                            <section className="space-y-2">
                              <h4 className="text-sm font-semibold">
                                Uncertain / follow-up questions
                              </h4>
                              <ul className="list-disc list-inside space-y-1 text-sm">
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
                </CardContent>
              </Card>
            )}
          </>
        )}

        {tab === "history" && (
          <>
            <PageHeader
              title="Analysis History"
              subtitle="View and manage past Kubernetes resource analyses"
            />
            {history.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle>Recent Analyses</CardTitle>
                  <CardDescription>
                    Click a row to view analysis details
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[180px]">Created</TableHead>
                          <TableHead className="w-[120px]">Context</TableHead>
                          <TableHead className="w-[120px]">Namespace</TableHead>
                          <TableHead>Resource</TableHead>
                          <TableHead className="w-[100px]">Tokens</TableHead>
                          <TableHead className="w-[100px]">Latency</TableHead>
                          <TableHead className="w-[80px]">Status</TableHead>
                          <TableHead className="w-[100px]">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {history.map((h) => (
                          <TableRow
                            key={h.id}
                            className="cursor-pointer"
                            onClick={() => openHistoryDetail(h.id)}
                          >
                            <TableCell className="text-sm">
                              {new Date(h.created_at).toLocaleString()}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {h.context || "—"}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {h.namespace || "—"}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <Badge
                                  variant="outline"
                                  className="font-mono text-xs"
                                >
                                  {h.kind}
                                </Badge>
                                <span className="font-medium">{h.name}</span>
                              </div>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              —
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              —
                            </TableCell>
                            <TableCell>
                              {h.error ? (
                                <Badge variant="destructive">Error</Badge>
                              ) : (
                                <Badge variant="outline">Success</Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openHistoryDetail(h.id);
                                  }}
                                >
                                  View
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    if (
                                      confirm(
                                        `Delete analysis for ${h.kind} ${h.name}?`,
                                      )
                                    ) {
                                      try {
                                        await api.historyDelete(h.id);
                                        setHistory((prev) =>
                                          prev.filter(
                                            (item) => item.id !== h.id,
                                          ),
                                        );
                                      } catch (e) {
                                        setError(`Failed to delete: ${e}`);
                                      }
                                    }
                                  }}
                                  className="text-destructive hover:text-destructive"
                                >
                                  Delete
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <EmptyState
                title="No analyses yet"
                description="Run an analysis to see results here"
              />
            )}

            <Dialog
              open={!!viewHistoryId}
              onOpenChange={(open) =>
                !open &&
                (setViewHistoryId(null),
                setHistoryDetail(null),
                setShowAddToIncident(false))
              }
            >
              {historyDetail && (
                <>
                  <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                      <div className="flex items-center justify-between">
                        <div>
                          <DialogTitle>
                            Analysis: {historyDetail.kind} {historyDetail.name}
                          </DialogTitle>
                          <DialogDescription className="mt-1">
                            {historyDetail.namespace &&
                              `Namespace: ${historyDetail.namespace}`}
                            {historyDetail.context &&
                              ` • Context: ${historyDetail.context}`}
                            {" • "}
                            {new Date(
                              historyDetail.created_at,
                            ).toLocaleString()}
                          </DialogDescription>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            onClick={() =>
                              handleCreateIncidentFromAnalysis(historyDetail.id)
                            }
                            disabled={creatingIncidentFromAnalysis}
                            size="sm"
                            variant="outline"
                          >
                            {creatingIncidentFromAnalysis
                              ? "Creating…"
                              : "Create incident"}
                          </Button>
                          <Button
                            onClick={() =>
                              setShowAddToIncident(!showAddToIncident)
                            }
                            disabled={incidentLoading}
                            size="sm"
                            variant="outline"
                          >
                            Add to incident
                          </Button>
                        </div>
                      </div>
                    </DialogHeader>
                    <div className="mt-4 space-y-4">
                      {showAddToIncident && (
                        <div className="rounded-lg border p-4 space-y-2">
                          <Input
                            type="text"
                            placeholder="Search incidents..."
                            value={addToIncidentSearch}
                            onChange={(e) =>
                              setAddToIncidentSearch(e.target.value)
                            }
                          />
                          <div className="max-h-48 overflow-y-auto space-y-1">
                            {incidentList
                              .filter(
                                (inc) =>
                                  addToIncidentSearch.trim() === "" ||
                                  inc.title
                                    .toLowerCase()
                                    .includes(
                                      addToIncidentSearch.toLowerCase(),
                                    ),
                              )
                              .map((inc) => (
                                <Button
                                  key={inc.id}
                                  type="button"
                                  variant="outline"
                                  onClick={() =>
                                    handleAddToExistingIncident(
                                      inc.id,
                                      "analysis",
                                      historyDetail.id,
                                    )
                                  }
                                  disabled={incidentLoading}
                                  className="w-full justify-start text-left"
                                  size="sm"
                                >
                                  {inc.title} ({inc.status})
                                </Button>
                              ))}
                            {incidentList.filter(
                              (inc) =>
                                addToIncidentSearch.trim() === "" ||
                                inc.title
                                  .toLowerCase()
                                  .includes(addToIncidentSearch.toLowerCase()),
                            ).length === 0 && (
                              <div className="p-2 text-sm text-muted-foreground text-center">
                                No incidents found
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                      {historyDetail.error && (
                        <ErrorAlert message={historyDetail.error} />
                      )}
                      {historyDetail.analysis_markdown && (
                        <div>
                          <h3 className="text-lg font-semibold mb-2">
                            Analysis
                          </h3>
                          <div className="markdown-body rounded-lg border bg-muted/30 p-4">
                            <ReactMarkdown>
                              {historyDetail.analysis_markdown}
                            </ReactMarkdown>
                          </div>
                        </div>
                      )}
                      {historyDetail.analysis_json && (
                        <>
                          {historyDetail.analysis_json.kubectl_commands &&
                            historyDetail.analysis_json.kubectl_commands
                              .length > 0 && (
                              <div>
                                <div className="flex items-center justify-between mb-2">
                                  <h3 className="text-lg font-semibold">
                                    Kubectl Commands
                                  </h3>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                      navigator.clipboard.writeText(
                                        historyDetail.analysis_json!.kubectl_commands!.join(
                                          "\n",
                                        ),
                                      );
                                    }}
                                  >
                                    <Copy className="h-4 w-4 mr-2" />
                                    Copy All
                                  </Button>
                                </div>
                                <div className="space-y-2">
                                  {historyDetail.analysis_json.kubectl_commands.map(
                                    (cmd: string, i: number) => (
                                      <div
                                        key={i}
                                        className="flex items-center justify-between rounded-lg border bg-muted/30 p-3 font-mono text-xs"
                                      >
                                        <code>{cmd}</code>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          onClick={() => {
                                            navigator.clipboard.writeText(cmd);
                                          }}
                                        >
                                          <Copy className="h-3 w-3" />
                                        </Button>
                                      </div>
                                    ),
                                  )}
                                </div>
                              </div>
                            )}
                        </>
                      )}
                    </div>
                  </DialogContent>
                </>
              )}
            </Dialog>
          </>
        )}

        {tab === "compare" && (
          <>
            <PageHeader
              title="Compare Analyses"
              subtitle="Select two analyses to compare changes over time"
            />
            {compareError && (
              <ErrorAlert
                message={compareError}
                onDismiss={() => setCompareError(null)}
              />
            )}
            {compareResult && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>Compare Results</CardTitle>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setCompareResult(null);
                        setCompareError(null);
                      }}
                    >
                      ← Back
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <h3 className="text-lg font-semibold mb-2">Analysis A</h3>
                      <div className="space-y-1">
                        <p className="text-sm">
                          <Badge
                            variant="outline"
                            className="font-mono text-xs mr-2"
                          >
                            {compareResult.analysis_a.kind}
                          </Badge>
                          {compareResult.analysis_a.name}
                          {compareResult.analysis_a.namespace &&
                            ` (${compareResult.analysis_a.namespace})`}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(
                            compareResult.analysis_a.created_at,
                          ).toLocaleString()}
                        </p>
                      </div>
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold mb-2">Analysis B</h3>
                      <div className="space-y-1">
                        <p className="text-sm">
                          <Badge
                            variant="outline"
                            className="font-mono text-xs mr-2"
                          >
                            {compareResult.analysis_b.kind}
                          </Badge>
                          {compareResult.analysis_b.name}
                          {compareResult.analysis_b.namespace &&
                            ` (${compareResult.analysis_b.namespace})`}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(
                            compareResult.analysis_b.created_at,
                          ).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  </div>
                  {compareResult.likely_reasoning && (
                    <div>
                      <h3 className="text-lg font-semibold mb-2">
                        Likely Reasoning
                      </h3>
                      <div className="rounded-lg border bg-muted/30 p-4">
                        <p className="whitespace-pre-wrap text-sm">
                          {compareResult.likely_reasoning}
                        </p>
                      </div>
                    </div>
                  )}
                  {compareResult.diff_summary && (
                    <div>
                      <h3 className="text-lg font-semibold mb-2">
                        Diff Summary
                      </h3>
                      <div className="markdown-body rounded-lg border bg-muted/30 p-4">
                        <ReactMarkdown>
                          {compareResult.diff_summary}
                        </ReactMarkdown>
                      </div>
                    </div>
                  )}
                  <div>
                    <h3 className="text-lg font-semibold mb-2">
                      Kubectl Commands
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <p className="text-sm text-muted-foreground mb-2">
                          From A (
                          {compareResult.analysis_a.created_at.slice(0, 10)})
                        </p>
                        {(compareResult.analysis_a.kubectl_commands ?? [])
                          .length > 0 ? (
                          <Button
                            variant="outline"
                            onClick={() =>
                              copyKubectlCommands(
                                compareResult.analysis_a.kubectl_commands ?? [],
                              )
                            }
                            className="w-full"
                          >
                            <Copy className="h-4 w-4 mr-2" />
                            Copy{" "}
                            {
                              compareResult.analysis_a.kubectl_commands?.length
                            }{" "}
                            commands
                          </Button>
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            No commands
                          </p>
                        )}
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground mb-2">
                          From B (
                          {compareResult.analysis_b.created_at.slice(0, 10)})
                        </p>
                        {(compareResult.analysis_b.kubectl_commands ?? [])
                          .length > 0 ? (
                          <Button
                            variant="outline"
                            onClick={() =>
                              copyKubectlCommands(
                                compareResult.analysis_b.kubectl_commands ?? [],
                              )
                            }
                            className="w-full"
                          >
                            <Copy className="h-4 w-4 mr-2" />
                            Copy{" "}
                            {
                              compareResult.analysis_b.kubectl_commands?.length
                            }{" "}
                            commands
                          </Button>
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            No commands
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle>Select Analyses to Compare</CardTitle>
                <CardDescription>
                  Select two analyses from the list below and click Compare
                </CardDescription>
              </CardHeader>
              <CardContent>
                {history.length > 0 ? (
                  <div className="space-y-2">
                    {history.slice(0, 15).map((h) => (
                      <div
                        key={h.id}
                        className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50"
                      >
                        <input
                          type="checkbox"
                          checked={compareSelectedIds.includes(h.id)}
                          onChange={() => toggleCompareSelection(h.id)}
                          aria-label={`Select ${h.kind} ${h.name} for compare`}
                          className="h-4 w-4 rounded border-gray-300"
                        />
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <Badge
                              variant="outline"
                              className="font-mono text-xs"
                            >
                              {h.kind}
                            </Badge>
                            <span className="font-medium">{h.name}</span>
                            {h.namespace && (
                              <span className="text-sm text-muted-foreground">
                                ({h.namespace})
                              </span>
                            )}
                            {h.error && (
                              <Badge variant="destructive">Error</Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            {new Date(h.created_at).toLocaleString()}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setTab("history");
                              openHistoryDetail(h.id);
                            }}
                          >
                            View
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={async () => {
                              if (
                                confirm(
                                  `Delete analysis for ${h.kind} ${h.name}?`,
                                )
                              ) {
                                try {
                                  await api.historyDelete(h.id);
                                  setHistory((prev) =>
                                    prev.filter((item) => item.id !== h.id),
                                  );
                                  setCompareSelectedIds((prev) =>
                                    prev.filter((id) => id !== h.id),
                                  );
                                } catch (e) {
                                  setError(`Failed to delete: ${e}`);
                                }
                              }
                            }}
                            className="text-destructive hover:text-destructive"
                          >
                            Delete
                          </Button>
                        </div>
                      </div>
                    ))}
                    {compareSelectedIds.length === 2 && (
                      <Button
                        onClick={runCompare}
                        disabled={compareLoading}
                        className="w-full mt-4"
                      >
                        {compareLoading ? "Comparing…" : "Compare Selected"}
                      </Button>
                    )}
                  </div>
                ) : (
                  <EmptyState
                    title="No analyses yet"
                    description="Run an analysis to see results here"
                  />
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </Layout>
  );
}

export default App;
