import { ReactNode } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { type HealthResponse } from "@/api";

type Tab =
  | "analyze"
  | "scan"
  | "history"
  | "compare"
  | "incidents"
  | "schedules";

interface AppShellProps {
  currentTab: Tab;
  onTabChange: (tab: Tab) => void;
  children: ReactNode;
  health?: HealthResponse | null;
}

export function AppShell({
  currentTab,
  onTabChange,
  children,
  health,
}: AppShellProps) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card shadow-sm">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">KubeBeaver</h1>
              <p className="text-sm text-muted-foreground">
                Kubernetes troubleshooting assistant
              </p>
            </div>
            {health && (
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className="text-sm font-medium">
                    {health.llm_provider === "groq"
                      ? "Groq"
                      : health.llm_provider === "openai_compatible"
                        ? "Local"
                        : health.llm_provider}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge
                      variant={
                        health.kube_connected ? "default" : "destructive"
                      }
                    >
                      {health.kube_connected
                        ? "K8s Connected"
                        : "K8s Disconnected"}
                    </Badge>
                    <Badge
                      variant={health.llm_configured ? "default" : "secondary"}
                    >
                      {health.llm_configured
                        ? "LLM Ready"
                        : "LLM Not Configured"}
                    </Badge>
                  </div>
                </div>
              </div>
            )}
          </div>
          <Tabs value={currentTab} onValueChange={(v) => onTabChange(v as Tab)}>
            <TabsList className="grid w-full grid-cols-6">
              <TabsTrigger value="analyze">Analyze</TabsTrigger>
              <TabsTrigger value="scan">Scan</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
              <TabsTrigger value="compare">Compare</TabsTrigger>
              <TabsTrigger value="incidents">Incidents</TabsTrigger>
              <TabsTrigger value="schedules">Schedules</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </header>
      <main className="container mx-auto px-4 py-6">
        <Tabs value={currentTab} onValueChange={(v) => onTabChange(v as Tab)}>
          {children}
        </Tabs>
      </main>
    </div>
  );
}
