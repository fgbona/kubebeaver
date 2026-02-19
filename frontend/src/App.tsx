import { useState, useEffect, useCallback, useRef } from "react";
import { TabsContent } from "@/components/ui/tabs";
import { AppShell } from "@/components/layout/AppShell";
import { AnalyzePage } from "@/pages/AnalyzePage";
import { ScanPage } from "@/pages/ScanPage";
import { HistoryPage } from "@/pages/HistoryPage";
import { ComparePage } from "@/pages/ComparePage";
import { IncidentsPage } from "@/pages/IncidentsPage";
import { SchedulesPage } from "@/pages/SchedulesPage";
import { useContexts } from "@/hooks/useContexts";
import { useNamespaces } from "@/hooks/useNamespaces";
import {
  api,
  type HealthResponse,
  type HistoryItem,
  type ScanListItem,
  type IncidentListItem,
} from "./api";

type Tab =
  | "analyze"
  | "scan"
  | "history"
  | "compare"
  | "incidents"
  | "schedules";

function App() {
  const [tab, setTab] = useState<Tab>("analyze");
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [scanList, setScanList] = useState<ScanListItem[]>([]);
  const [incidentList, setIncidentList] = useState<IncidentListItem[]>([]);
  const namespaceKeyRef = useRef<number>(0);

  const { contexts, selectedContext, loadContexts, handleContextChange } =
    useContexts();

  const { namespaces, loadNamespaces } = useNamespaces(selectedContext);

  const loadHealth = useCallback(async () => {
    try {
      const h = await api.health();
      setHealth(h);
    } catch {
      setHealth(null);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const list = await api.history(100, selectedContext);
      setHistory(list);
    } catch {
      setHistory([]);
    }
  }, [selectedContext]);

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

  useEffect(() => {
    loadHealth();
  }, [loadHealth]);

  useEffect(() => {
    loadContexts();
  }, [loadContexts]);

  useEffect(() => {
    if (selectedContext) {
      loadNamespaces();
    }
  }, [selectedContext, loadNamespaces]);

  useEffect(() => {
    if (tab === "scan" || tab === "incidents" || tab === "schedules") {
      loadScanList();
    }
    if (tab === "incidents") {
      loadIncidentList();
      loadHistory();
    }
    if (tab === "history" || tab === "compare") {
      loadHistory();
    }
  }, [tab, loadScanList, loadIncidentList, loadHistory]);

  const handleContextChangeWrapper = useCallback(
    async (newContext: string) => {
      namespaceKeyRef.current += 1;
      await handleContextChange(newContext);
    },
    [handleContextChange],
  );

  const handleAnalysisComplete = useCallback(() => {
    loadHistory();
  }, [loadHistory]);

  const handleScanComplete = useCallback(() => {
    loadScanList();
  }, [loadScanList]);

  const handleViewHistory = useCallback(() => {
    setTab("history");
    // HistoryPage will handle opening the detail dialog
  }, []);

  const handleViewScan = useCallback(() => {
    setTab("scan");
    // ScanPage will handle loading the scan
  }, []);

  const handleTabChange = useCallback((tab: string) => {
    setTab(tab as Tab);
  }, []);

  const llmProviderLabel =
    health?.llm_provider === "groq"
      ? "Groq"
      : health?.llm_provider === "openai_compatible"
        ? "Local"
        : "";

  return (
    <AppShell currentTab={tab} onTabChange={setTab} health={health}>
      <div className="space-y-6">
        <TabsContent value="analyze" className="space-y-6">
          <AnalyzePage
            selectedContext={selectedContext}
            onContextChange={handleContextChangeWrapper}
            contexts={contexts}
            llmProviderLabel={llmProviderLabel}
            onAnalysisComplete={handleAnalysisComplete}
          />
        </TabsContent>

        <TabsContent value="scan" className="space-y-6">
          <ScanPage
            selectedContext={selectedContext}
            onContextChange={handleContextChangeWrapper}
            contexts={contexts}
            namespaces={namespaces}
            incidentList={incidentList}
            namespaceKeyRef={namespaceKeyRef}
            llmProviderLabel={llmProviderLabel}
            onScanComplete={handleScanComplete}
            onTabChange={handleTabChange}
          />
        </TabsContent>

        <TabsContent value="history" className="space-y-6">
          <HistoryPage
            selectedContext={selectedContext}
            incidentList={incidentList}
            onAnalysisComplete={handleAnalysisComplete}
          />
        </TabsContent>

        <TabsContent value="compare" className="space-y-6">
          <ComparePage history={history} />
        </TabsContent>

        <TabsContent value="incidents" className="space-y-6">
          <IncidentsPage
            history={history}
            scanList={scanList}
            onTabChange={handleTabChange}
            onViewHistory={handleViewHistory}
            onViewScan={handleViewScan}
          />
        </TabsContent>

        <TabsContent value="schedules" className="space-y-6">
          <SchedulesPage
            selectedContext={selectedContext}
            onContextChange={handleContextChangeWrapper}
            contexts={contexts}
            namespaces={namespaces}
            namespaceKeyRef={namespaceKeyRef}
          />
        </TabsContent>
      </div>
    </AppShell>
  );
}

export default App;
