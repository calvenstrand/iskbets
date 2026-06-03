"use client";

import { useEffect, useState } from "react";
import { isSortMode, type SortMode } from "@/components/GridSort";

const SORT_STORAGE_KEY = "iskbets:gridSort";

/** Persists the grid sort mode to localStorage. Seeded to "chaos" so
 * the first client render matches the server (no hydration mismatch);
 * the saved preference is read from localStorage post-mount. */
export function useGridSort(): [SortMode, (mode: SortMode) => void] {
  const [sortMode, setSortMode] = useState<SortMode>("chaos");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(SORT_STORAGE_KEY);
      if (saved && isSortMode(saved)) setSortMode(saved);
    } catch {
      // localStorage unavailable (private mode / blocked) — keep default.
    }
  }, []);

  const handleSortChange = (mode: SortMode): void => {
    setSortMode(mode);
    try {
      window.localStorage.setItem(SORT_STORAGE_KEY, mode);
    } catch {
      // Non-fatal — the choice still applies for this session.
    }
  };

  return [sortMode, handleSortChange];
}
