import { useState, useEffect, useCallback, useRef } from "react";
import ReactMarkdown from "react-markdown";
import { PageHeader } from "@/components/PageHeader";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { StatPills } from "@/components/StatPills";
import { ErrorAlert } from "@/components/ErrorAlert";
import {
  api,
  type AnalyzeResponse,
  type ContextInfo,
  type ResourceItem,
} from "@/api";

type Kind =
  | "Pod"
  | "Deployment"
  | "StatefulSet"
  | "DaemonSet"
  | "ReplicaSet"
  | "Job"
  | "CronJob"
  | "Node";

/** Tokenize JSON string for jq-style syntax highlighting */
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

const SIGNAL_LABELS: Record<string, string> = {
  crash_loop_back_off: "CrashLoop",
  image_pull_back_off: "ImagePull Error",
  oom_killed: "OOM Killed",
  unschedulable: "Unschedulable",
  restart_count: "Restarts",
  node_not_ready: "Node Not Ready",
  replica_mismatch: "Replica Mismatch",
  warning_event_count: "Warning Events",
};

function ConfidenceBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color =
    pct >= 90
      ? "bg-red-100 text-red-800 border-red-200"
      : pct >= 70
        ? "bg-orange-100 text-orange-800 border-orange-200"
        : pct >= 50
          ? "bg-yellow-100 text-yellow-800 border-yellow-200"
          : "bg-gray-100 text-gray-700 border-gray-200";
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${color}`}
    >
      {pct}% confidence
    </span>
  );
}

interface AnalyzePageProps {
  selectedContext: string;
  onContextChange: (context: string) => void;
  contexts: ContextInfo[];
  llmProviderLabel?: string;
  onAnalysisComplete?: () => void;
}

export function AnalyzePage({
  selectedContext,
  onContextChange,
  contexts,
  llmProviderLabel,
  onAnalysisComplete,
}: AnalyzePageProps) {
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [selectedNamespace, setSelectedNamespace] = useState<string>("");
  const namespaceKeyRef = useRef<number>(0);
  const isLoadingNamespacesRef = useRef<boolean>(false);
  const [kind, setKind] = useState<Kind>("Pod");
  const [resourceNames, setResourceNames] = useState<ResourceItem[]>([]);
  const [selectedName, setSelectedName] = useState<string>("");
  const [includePreviousLogs, setIncludePreviousLogs] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [explainOpen, setExplainOpen] = useState(false);

  const loadNamespaces = useCallback(
    async (forContext?: string) => {
      const contextToUse = forContext ?? selectedContext;
      if (!contextToUse && contexts.length > 0) return;

      try {
        const list = await api.namespaces(
          contextToUse ? contextToUse : undefined,
        );
        setNamespaces(list);
        if (list.length > 0) {
          setSelectedNamespace(list[0]);
        } else {
          setSelectedNamespace("");
        }
      } catch (e) {
        console.error("Error loading namespaces:", e);
        setNamespaces([]);
        setSelectedNamespace("");
      }
    },
    [selectedContext, contexts.length],
  );

  const handleContextChange = useCallback(
    async (newContext: string) => {
      isLoadingNamespacesRef.current = true;
      namespaceKeyRef.current += 1;
      setNamespaces([]);
      setSelectedNamespace("");
      onContextChange(newContext);
      try {
        const list = await api.namespaces(newContext, true);
        if (list.length > 0) {
          setNamespaces(list);
          setSelectedNamespace(list[0]);
        } else {
          setSelectedNamespace("");
        }
      } catch (e) {
        console.error("Error loading namespaces:", e);
        setNamespaces([]);
        setSelectedNamespace("");
      } finally {
        setTimeout(() => {
          isLoadingNamespacesRef.current = false;
        }, 100);
      }
    },
    [onContextChange],
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
    if (
      !isLoadingNamespacesRef.current &&
      selectedContext &&
      contexts.length > 0
    ) {
      const isInitialLoad = !namespaceKeyRef.current;
      if (isInitialLoad) {
        namespaceKeyRef.current = 1;
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
      onAnalysisComplete?.();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const showContextSelect = contexts.length > 1;

  return (
    <>
      <PageHeader
        title="Analyze Resource"
        subtitle="Troubleshoot Kubernetes resources with AI-powered analysis"
      />
      {error && <ErrorAlert message={error} onDismiss={() => setError(null)} />}
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
              <Select value={kind} onValueChange={(v) => setKind(v as Kind)}>
                <SelectTrigger id="kind-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Pod">Pod</SelectItem>
                  <SelectItem value="Deployment">Deployment</SelectItem>
                  <SelectItem value="StatefulSet">StatefulSet</SelectItem>
                  <SelectItem value="DaemonSet">DaemonSet</SelectItem>
                  <SelectItem value="ReplicaSet">ReplicaSet</SelectItem>
                  <SelectItem value="Job">Job</SelectItem>
                  <SelectItem value="CronJob">CronJob</SelectItem>
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
            <Checkbox
              id="include-logs"
              checked={includePreviousLogs}
              onCheckedChange={(checked) =>
                setIncludePreviousLogs(checked === true)
              }
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
              <CardTitle className="flex items-center gap-2 flex-wrap">
                {llmProviderLabel ? `${llmProviderLabel} – ` : ""}
                Analysis Result
                {result.diagnostic_engine &&
                  result.diagnostic_engine.findings.length > 0 && (
                    <ConfidenceBadge
                      value={result.diagnostic_engine.engine_confidence}
                    />
                  )}
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
            {result.diagnostic_engine &&
              result.diagnostic_engine.findings.length > 0 && (
                <div className="rounded-lg border border-orange-200 bg-orange-50/60 p-3 space-y-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-semibold text-orange-900 mr-1">
                      Signals:
                    </span>
                    {Object.entries(result.diagnostic_engine.signals)
                      .filter(
                        ([, v]) =>
                          v === true || (typeof v === "number" && v > 0),
                      )
                      .map(([k, v]) => (
                        <span
                          key={k}
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${
                            typeof v === "boolean"
                              ? "bg-red-100 text-red-800 border-red-200"
                              : "bg-amber-100 text-amber-800 border-amber-200"
                          }`}
                        >
                          {SIGNAL_LABELS[k] ?? k.replace(/_/g, " ")}
                          {typeof v === "number" ? `: ${v}` : ""}
                        </span>
                      ))}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-orange-900 mr-1">
                      Root causes:
                    </span>
                    {result.diagnostic_engine.findings.map((f, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1.5 text-xs"
                      >
                        <ConfidenceBadge value={f.confidence} />
                        <span className="text-orange-900 font-medium">
                          {f.root_cause.replace(/_/g, " ")}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
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
              (result.analysis_json?.follow_up_questions?.length ?? 0) > 0) && (
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
                      (result.analysis_json.follow_up_questions?.length ?? 0) >
                        0) && (
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
                          {(result.analysis_json.follow_up_questions ?? []).map(
                            (q, i) => (
                              <li key={`q-${i}`}>{q}</li>
                            ),
                          )}
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
  );
}
