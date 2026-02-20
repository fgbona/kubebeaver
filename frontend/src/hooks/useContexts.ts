import { useState, useEffect, useCallback, useRef } from "react";
import { api, type ContextInfo } from "@/api";

export function useContexts() {
  const [contexts, setContexts] = useState<ContextInfo[]>([]);
  const [selectedContext, setSelectedContext] = useState<string>("");
  const contextRef = useRef<string>("");

  const loadContexts = useCallback(async (preserveCurrent: boolean = false) => {
    try {
      const list = await api.contexts();
      const currentSelectedContext = contextRef.current;

      setContexts(list);

      if (preserveCurrent && currentSelectedContext) {
        const contextExists = list.some(
          (c) => c.name === currentSelectedContext,
        );
        if (contextExists) {
          return;
        }
      }

      const current = list.find((c) => c.current);
      const initialContext = current ? current.name : (list[0]?.name ?? "");
      if (initialContext) {
        if (!currentSelectedContext || !preserveCurrent) {
          if (initialContext !== currentSelectedContext) {
            contextRef.current = initialContext;
            setSelectedContext(initialContext);
          }
        }
      }
    } catch (e) {
      console.error("Error loading contexts:", e);
    }
  }, []);

  const handleContextChange = useCallback(async (newContext: string) => {
    contextRef.current = newContext;
    setSelectedContext(newContext);
  }, []);

  useEffect(() => {
    loadContexts(false);
  }, []);

  return {
    contexts,
    selectedContext,
    setSelectedContext,
    loadContexts,
    handleContextChange,
  };
}
