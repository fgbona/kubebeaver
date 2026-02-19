import { useState, useEffect, useCallback } from "react";
import { api } from "@/api";

export function useNamespaces(selectedContext: string) {
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [selectedNamespace, setSelectedNamespace] = useState<string>("");

  const loadNamespaces = useCallback(
    async (forContext?: string) => {
      const contextToUse = forContext ?? selectedContext;
      if (!contextToUse) return;

      try {
        const list = await api.namespaces(contextToUse);
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
    [selectedContext],
  );

  useEffect(() => {
    if (selectedContext) {
      loadNamespaces();
    }
  }, [selectedContext, loadNamespaces]);

  return {
    namespaces,
    selectedNamespace,
    setSelectedNamespace,
    loadNamespaces,
  };
}
