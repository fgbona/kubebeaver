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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { SeverityBadge } from "@/components/SeverityBadge";
import { EmptyState } from "@/components/EmptyState";
import { ErrorAlert } from "@/components/ErrorAlert";
import {
  api,
  type IncidentListItem,
  type IncidentDetail,
  type HistoryItem,
  type ScanListItem,
} from "@/api";

interface IncidentsPageProps {
  history: HistoryItem[];
  scanList: ScanListItem[];
  onTabChange?: (tab: string) => void;
  onViewHistory?: (id: string) => void;
  onViewScan?: (id: string) => void;
}

export function IncidentsPage({
  history,
  scanList,
  onTabChange,
  onViewHistory,
  onViewScan,
}: IncidentsPageProps) {
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

  const loadIncidentList = useCallback(async () => {
    try {
      const list = await api.incidents(50);
      setIncidentList(list);
    } catch {
      setIncidentList([]);
    }
  }, []);

  useEffect(() => {
    loadIncidentList();
  }, [loadIncidentList]);

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

  return (
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
            Create a new incident to track and manage related analyses and scans
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
                      <h4 className="font-semibold truncate">{inc.title}</h4>
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
                      <SelectItem value="mitigating">Mitigating</SelectItem>
                      <SelectItem value="resolved">Resolved</SelectItem>
                    </SelectContent>
                  </Select>
                  {incidentDetail.severity && (
                    <SeverityBadge severity={incidentDetail.severity as any} />
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
                    incidentDetail.updated_at !== incidentDetail.created_at && (
                      <span>
                        Updated{" "}
                        {new Date(incidentDetail.updated_at).toLocaleString()}
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
              <Label htmlFor="incident-tags">Tags (comma-separated)</Label>
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
                          {new Date(entry.created_at || "").toLocaleString()}
                        </div>
                        {entry.type === "incident_created" && (
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">CREATED</Badge>
                            <span className="text-sm">Incident created</span>
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
                              {entry.item_type?.toUpperCase() || "UNKNOWN"}
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
                                  onViewHistory?.(entry.ref_id);
                                  if (onTabChange) onTabChange("history");
                                } else if (entry.item_type === "scan") {
                                  onViewScan?.(entry.ref_id);
                                  if (onTabChange) onTabChange("scan");
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
                            <SelectItem value="analysis">Analysis</SelectItem>
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
                                  {new Date(h.created_at).toLocaleDateString()}
                                </SelectItem>
                              ))}
                            {addItemType === "scan" &&
                              scanList.map((s) => (
                                <SelectItem key={s.id} value={s.id}>
                                  {s.scope} {s.namespace || ""} –{" "}
                                  {new Date(s.created_at).toLocaleDateString()}
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
                        <Label htmlFor="add-note-content">Note Content</Label>
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
                        disabled={incidentLoading || !addNoteContent.trim()}
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
  );
}
