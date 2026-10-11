import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { ModelOutcomes } from "../lib/outcomes";

/** Outcome history for the picker, read when the picker opens. The opt-in
 * toggle saves `routing.suggest_from_history`; it never changes the model. */
export function useModelOutcomes(
  workspace: string,
  current: string,
  open: boolean,
) {
  const [outcomes, setOutcomes] = useState<ModelOutcomes | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!open || !workspace) return;
    let live = true;
    api
      .modelOutcomes(workspace, current)
      .then((value) => {
        if (live) setOutcomes(value);
      })
      .catch(() => {
        if (live) setOutcomes(null);
      });
    return () => {
      live = false;
    };
  }, [workspace, current, open, version]);
  const setSuggestions = useCallback(async (on: boolean) => {
    await api.saveConfig({ routing: { suggest_from_history: on } });
    setVersion((v) => v + 1);
  }, []);
  return { outcomes, setSuggestions };
}
