import { useState, useEffect, useCallback } from "react";
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
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/EmptyState";
import { ErrorAlert } from "@/components/ErrorAlert";
import { Copy } from "lucide-react";
import { api, type HistoryItem, type IncidentListItem } from "@/api";

interface HistoryPageProps {
  selectedContext?: string;
  incidentList: IncidentListItem[];
  onAnalysisComplete?: () => void;
}

export function HistoryPage({
  selectedContext,
  incidentList,
  onAnalysisComplete,
}: HistoryPageProps) {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [viewHistoryId, setViewHistoryId] = useState<string | null>(null);
  const [historyDetail, setHistoryDetail] = useState<
    | (HistoryItem & {
        analysis_markdown?: string;
        analysis_json?: import("@/api").AnalysisJson;
      })
    | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [incidentLoading, setIncidentLoading] = useState(false);
  const [showAddToIncident, setShowAddToIncident] = useState(false);
  const [addToIncidentSearch, setAddToIncidentSearch] = useState("");
  const [creatingIncidentFromAnalysis, setCreatingIncidentFromAnalysis] =
    useState(false);

  const loadHistory = useCallback(async () => {
    try {
      const list = await api.history(100, selectedContext);
      setHistory(list);
    } catch {
      setHistory([]);
    }
  }, [selectedContext]);

  useEffect(() => {
    loadHistory();
    onAnalysisComplete?.();
  }, [loadHistory, onAnalysisComplete]);

  const openHistoryDetail = async (id: string) => {
    setViewHistoryId(id);
    setError(null);
    try {
      const detail = await api.historyGet(id);
      setHistoryDetail(detail);
    } catch (e) {
      setError(String(e));
      setHistoryDetail(null);
    }
  };

  const handleCreateIncidentFromAnalysis = async (analysisId: string) => {
    setCreatingIncidentFromAnalysis(true);
    setError(null);
    try {
      await api.incidentFromAnalysis({ analysis_id: analysisId });
      await loadHistory();
    } catch (e) {
      setError(String(e));
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
    setError(null);
    try {
      await api.incidentAddItem(incidentId, { type: itemType, ref_id: refId });
      setShowAddToIncident(false);
      setAddToIncidentSearch("");
    } catch (e) {
      setError(String(e));
    } finally {
      setIncidentLoading(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Analysis History"
        subtitle="View and manage past Kubernetes resource analyses"
      />
      {error && <ErrorAlert message={error} onDismiss={() => setError(null)} />}
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
                                    prev.filter((item) => item.id !== h.id),
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
                    {new Date(historyDetail.created_at).toLocaleString()}
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
                    onClick={() => setShowAddToIncident(!showAddToIncident)}
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
                  <h3 className="text-lg font-semibold mb-2">Analysis</h3>
                  <div className="markdown-body rounded-lg border bg-muted/30 p-4">
                    <ReactMarkdown>
                      {historyDetail.analysis_markdown}
                    </ReactMarkdown>
                  </div>
                </div>
              )}
              {historyDetail.analysis_json &&
                historyDetail.analysis_json.kubectl_commands &&
                historyDetail.analysis_json.kubectl_commands.length > 0 && (
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
            </div>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
