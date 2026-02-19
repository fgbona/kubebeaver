import { useState, useEffect, useCallback } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
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
import { SeverityBadge } from "@/components/SeverityBadge";
import { CategoryBadge } from "@/components/CategoryBadge";
import { EmptyState } from "@/components/EmptyState";
import { ErrorAlert } from "@/components/ErrorAlert";
import { Copy } from "lucide-react";
import {
  api,
  type ScanResponse,
  type ScanListItem,
  type ScanFindingItem,
  type IncidentListItem,
  type ContextInfo,
} from "@/api";

const SEVERITY_ORDER: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

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

interface ScanPageProps {
  selectedContext: string;
  onContextChange: (context: string) => void;
  contexts: ContextInfo[];
  namespaces: string[];
  incidentList: IncidentListItem[];
  namespaceKeyRef: React.MutableRefObject<number>;
  llmProviderLabel?: string;
  onScanComplete?: () => void;
  onTabChange?: (tab: string) => void;
}

export function ScanPage({
  selectedContext,
  onContextChange,
  contexts,
  namespaces,
  incidentList,
  namespaceKeyRef,
  llmProviderLabel,
  onScanComplete,
  onTabChange,
}: ScanPageProps) {
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
  const [showAddToIncident, setShowAddToIncident] = useState(false);
  const [addToIncidentSearch, setAddToIncidentSearch] = useState("");
  const [creatingIncidentFromScan, setCreatingIncidentFromScan] =
    useState(false);
  const [incidentLoading, setIncidentLoading] = useState(false);

  const loadScanList = useCallback(async () => {
    try {
      const list = await api.scans(30);
      setScanList(list);
    } catch {
      setScanList([]);
    }
  }, []);

  useEffect(() => {
    loadScanList();
  }, [loadScanList]);

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
      onScanComplete?.();
    } catch (e) {
      setScanError(String(e));
    } finally {
      setScanLoading(false);
    }
  };

  const handleCreateIncidentFromScan = async () => {
    if (!scanResult?.id) return;
    setCreatingIncidentFromScan(true);
    try {
      await api.incidentFromScan({
        scan_id: scanResult.id,
      });
      if (onTabChange) {
        onTabChange("incidents");
      }
    } catch (e) {
      setScanError(String(e));
    } finally {
      setCreatingIncidentFromScan(false);
    }
  };

  const handleAddToExistingIncident = async (
    incidentId: string,
    itemType: "scan" | "analysis",
    refId: string,
  ) => {
    setIncidentLoading(true);
    try {
      await api.incidentAddItem(incidentId, { type: itemType, ref_id: refId });
      setShowAddToIncident(false);
      setAddToIncidentSearch("");
    } catch (e) {
      setScanError(String(e));
    } finally {
      setIncidentLoading(false);
    }
  };

  const handleContextChange = useCallback(
    async (newContext: string) => {
      namespaceKeyRef.current += 1;
      setScanNamespace("");
      onContextChange(newContext);
    },
    [onContextChange, namespaceKeyRef],
  );

  const showContextSelect = contexts.length > 1;

  const filteredFindings =
    scanResult?.findings.filter((f) => {
      if (scanFilterSeverity && f.severity !== scanFilterSeverity) return false;
      if (scanFilterCategory && f.category !== scanFilterCategory) return false;
      return true;
    }) ?? [];

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
      <PageHeader
        title="Cluster Health Scan"
        subtitle="Scan your cluster or namespace for security and configuration issues"
      />
      {scanError && (
        <ErrorAlert message={scanError} onDismiss={() => setScanError(null)} />
      )}
      <Card>
        <CardHeader>
          <CardTitle>Scan Configuration</CardTitle>
          <CardDescription>Configure scan scope and options</CardDescription>
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
            <Checkbox
              id="scan-include-logs"
              checked={scanIncludeLogs}
              onCheckedChange={(checked) =>
                setScanIncludeLogs(checked === true)
              }
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
                  {creatingIncidentFromScan ? "Creating…" : "Create incident"}
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
            {scanResult.error && <ErrorAlert message={scanResult.error} />}
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
                      <h3 className="text-lg font-semibold mb-2">{heading}</h3>
                      <div className="flex flex-wrap gap-2 mb-2">
                        {severities.map((s) => (
                          <div key={s.key} className="flex items-center gap-1">
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
                  <SelectTrigger id="severity-filter" className="w-[180px]">
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
                  <SelectTrigger id="category-filter" className="w-[180px]">
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
                      <TableHead className="w-[120px]">Severity</TableHead>
                      <TableHead className="w-[150px]">Category</TableHead>
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
                        <TableCell className="font-medium">{f.title}</TableCell>
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
                  {selectedFinding.description || "No description available"}
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
                          {r.kind || "?"}/{r.namespace ? `${r.namespace}/` : ""}
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
                      {/^\s*[{\[]/.test(selectedFinding.evidence_snippet) ? (
                        <JsonHighlight
                          text={prettyJson(selectedFinding.evidence_snippet)}
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
                            selectedFinding.suggested_commands!.join("\n"),
                          );
                        }}
                      >
                        <Copy className="h-4 w-4 mr-2" />
                        Copy All
                      </Button>
                    </div>
                    <div className="space-y-2">
                      {selectedFinding.suggested_commands.map((cmd, i) => (
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
                      ))}
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
          <CardDescription>View and load previous scan results</CardDescription>
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
                      <TableCell className="font-medium">{s.scope}</TableCell>
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
                                created_at: detail.created_at ?? undefined,
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
  );
}
