import { useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ErrorAlert } from "@/components/ErrorAlert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, type HistoryItem, type CompareResponse, type CompareChangeItem } from "@/api";

interface ComparePageProps {
  history: HistoryItem[];
}

export function ComparePage({ history }: ComparePageProps) {
  const [compareSelectedIds, setCompareSelectedIds] = useState<string[]>([]);
  const [compareResult, setCompareResult] = useState<CompareResponse | null>(
    null,
  );
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);

  const handleCompare = useCallback(async () => {
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
      if (res.error) {
        setCompareError(res.error);
      }
    } catch (e) {
      setCompareError(String(e));
    } finally {
      setCompareLoading(false);
    }
  }, [compareSelectedIds]);

  return (
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
      {!compareResult ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Analysis A</CardTitle>
            </CardHeader>
            <CardContent>
              <Select
                value={compareSelectedIds[0] || ""}
                onValueChange={(v) =>
                  setCompareSelectedIds([v, compareSelectedIds[1] || ""])
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select first analysis" />
                </SelectTrigger>
                <SelectContent>
                  {history.map((h) => (
                    <SelectItem key={h.id} value={h.id}>
                      {h.kind} {h.name}
                      {h.namespace ? ` (${h.namespace})` : ""} –{" "}
                      {new Date(h.created_at).toLocaleDateString()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Analysis B</CardTitle>
            </CardHeader>
            <CardContent>
              <Select
                value={compareSelectedIds[1] || ""}
                onValueChange={(v) =>
                  setCompareSelectedIds([compareSelectedIds[0] || "", v])
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select second analysis" />
                </SelectTrigger>
                <SelectContent>
                  {history.map((h) => (
                    <SelectItem key={h.id} value={h.id}>
                      {h.kind} {h.name}
                      {h.namespace ? ` (${h.namespace})` : ""} –{" "}
                      {new Date(h.created_at).toLocaleDateString()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>
          <div className="md:col-span-2">
            <Button
              onClick={handleCompare}
              disabled={compareLoading || compareSelectedIds.length !== 2}
              className="w-full"
            >
              {compareLoading ? "Comparing…" : "Compare"}
            </Button>
          </div>
        </div>
      ) : (
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
                    <Badge variant="outline" className="font-mono text-xs mr-2">
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
                    <Badge variant="outline" className="font-mono text-xs mr-2">
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
                <h3 className="text-lg font-semibold mb-2">Likely Reasoning</h3>
                <div className="rounded-lg border bg-muted/30 p-4">
                  <p className="whitespace-pre-wrap text-sm">
                    {compareResult.likely_reasoning}
                  </p>
                </div>
              </div>
            )}
            {compareResult.diff_summary && (
              <div>
                <h3 className="text-lg font-semibold mb-2">Diff Summary</h3>
                <div className="markdown-body rounded-lg border bg-muted/30 p-4">
                  <ReactMarkdown>{compareResult.diff_summary}</ReactMarkdown>
                </div>
              </div>
            )}
            {compareResult.changes &&
              compareResult.changes.length > 0 && (
                <div>
                  <h3 className="text-lg font-semibold mb-2">
                    Structured Changes
                  </h3>
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Field</TableHead>
                          <TableHead>Change Type</TableHead>
                          <TableHead>Before</TableHead>
                          <TableHead>After</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {compareResult.changes.map((change: CompareChangeItem, i: number) => (
                          <TableRow key={i}>
                            <TableCell className="font-medium">
                              {change.path}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  change.type === "added"
                                    ? "default"
                                    : change.type === "removed"
                                      ? "destructive"
                                      : "secondary"
                                }
                              >
                                {change.type}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {String(change.before ?? "—")}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {String(change.after ?? "—")}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
          </CardContent>
        </Card>
      )}
    </>
  );
}
