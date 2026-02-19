import { ReactNode } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

type Tab =
  | "analyze"
  | "scan"
  | "history"
  | "compare"
  | "incidents"
  | "schedules";

interface LayoutProps {
  currentTab: Tab;
  onTabChange: (tab: Tab) => void;
  children: ReactNode;
}

export function Layout({ currentTab, onTabChange, children }: LayoutProps) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">KubeBeaver</h1>
              <p className="text-sm text-muted-foreground">
                Kubernetes troubleshooting assistant
              </p>
            </div>
            <Tabs
              value={currentTab}
              onValueChange={(v) => onTabChange(v as Tab)}
            >
              <TabsList>
                <TabsTrigger value="analyze">Analyze</TabsTrigger>
                <TabsTrigger value="scan">Scan</TabsTrigger>
                <TabsTrigger value="history">History</TabsTrigger>
                <TabsTrigger value="compare">Compare</TabsTrigger>
                <TabsTrigger value="incidents">Incidents</TabsTrigger>
                <TabsTrigger value="schedules">Schedules</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>
      </header>
      <main className="container mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
