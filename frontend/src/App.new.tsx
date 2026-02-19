// This is a new refactored version of App.tsx
// It will replace App.tsx once complete
// Keeping the original App.tsx for reference during migration

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
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
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

function App() {
  const [tab, setTab] = useState<Tab>("analyze");
  // ... rest of state will be added
  // This is a placeholder - the full implementation will follow

  return (
    <Layout currentTab={tab} onTabChange={setTab}>
      <div className="space-y-6">
        <PageHeader
          title="KubeBeaver"
          subtitle="Kubernetes troubleshooting assistant"
        />
        <Card>
          <CardHeader>
            <CardTitle>Welcome</CardTitle>
            <CardDescription>Select a tab to get started</CardDescription>
          </CardHeader>
        </Card>
      </div>
    </Layout>
  );
}

export default App;
