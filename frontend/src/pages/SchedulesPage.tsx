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
import { EmptyState } from "@/components/EmptyState";
import { ErrorAlert } from "@/components/ErrorAlert";
import { api, type ScheduleListItem, type ContextInfo } from "@/api";

interface SchedulesPageProps {
  selectedContext: string;
  onContextChange: (context: string) => void;
  contexts: ContextInfo[];
  namespaces: string[];
  namespaceKeyRef: React.MutableRefObject<number>;
}

export function SchedulesPage({
  selectedContext,
  onContextChange,
  contexts,
  namespaces,
  namespaceKeyRef,
}: SchedulesPageProps) {
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

  const loadScheduleList = useCallback(async () => {
    try {
      const list = await api.schedules(100);
      setScheduleList(list);
    } catch {
      setScheduleList([]);
    }
  }, []);

  useEffect(() => {
    loadScheduleList();
  }, [loadScheduleList]);

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
      setScheduleCreateCron("0 * * * *");
      setScheduleCreateEnabled(true);
      setScheduleCreateScope("namespace");
      setScheduleCreateNamespace("");
      setScheduleCreateContext("");
      setScheduleCreateDialogOpen(false);
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

  const cronRegex =
    /^(\*|[0-5]?\d) (\*|[01]?\d|2[0-3]) (\*|[012]?\d|3[01]) (\*|[01]?\d) (\*|[0-6])$/;
  const isValidCron = (cron: string) => cronRegex.test(cron.trim());

  return (
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
                        <Badge variant="secondary">{s.namespace || "—"}</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {s.context ? (
                        <Badge variant="outline">{s.context}</Badge>
                      ) : (
                        <span className="text-muted-foreground">default</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={s.enabled ? "default" : "secondary"}>
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
              Configure a scheduled scan to run automatically on a cron schedule
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
                    if (v) onContextChange(v);
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
                  key={`schedule-namespace-${selectedContext}-${namespaceKeyRef.current}`}
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
              {scheduleCreateCron && !isValidCron(scheduleCreateCron) && (
                <ErrorAlert message="Invalid cron expression. Use format: minute hour day month weekday" />
              )}
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="schedule-enabled"
                checked={scheduleCreateEnabled}
                onCheckedChange={(checked) =>
                  setScheduleCreateEnabled(checked === true)
                }
              />
              <Label htmlFor="schedule-enabled" className="cursor-pointer">
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
                onClick={handleScheduleCreate}
                disabled={
                  scheduleLoading ||
                  !scheduleCreateCron.trim() ||
                  (scheduleCreateScope === "namespace" &&
                    !scheduleCreateNamespace.trim()) ||
                  !isValidCron(scheduleCreateCron)
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
                {editScheduleCron && !isValidCron(editScheduleCron) && (
                  <ErrorAlert message="Invalid cron expression" />
                )}
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="edit-schedule-enabled"
                  checked={editScheduleEnabled}
                  onCheckedChange={(checked) =>
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
                  onClick={handleScheduleUpdate}
                  disabled={
                    scheduleLoading ||
                    !editScheduleCron.trim() ||
                    !isValidCron(editScheduleCron)
                  }
                >
                  {scheduleLoading ? "Updating…" : "Update Schedule"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
