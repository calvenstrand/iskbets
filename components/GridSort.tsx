"use client";

/** How the dashboard grid is ordered. Persisted to localStorage so a
 * viewer's pick survives reloads. The metric each mode sorts on follows
 * the active framing — today's intraday % during live trading, the
 * week-over-week % during the recap window. */
export type SortMode = "chaos" | "moon" | "rekt" | "stacks" | "bags";

type Option = {
  mode: SortMode;
  label: string;
  /** Tooltip — plain enough to explain what the WSB label actually does. */
  title: string;
};

export const SORT_OPTIONS: Option[] = [
  {
    mode: "chaos",
    label: "🌪 MAX CHAOS",
    title: "Biggest movers first — gainers or losers, magnitude wins",
  },
  { mode: "moon", label: "🚀 TO THE MOON", title: "Fattest green up top" },
  { mode: "rekt", label: "💀 GET REKT", title: "Deepest red up top" },
  { mode: "stacks", label: "💰 FAT STACKS", title: "Priciest tickers first" },
  { mode: "bags", label: "💎 OUR BAGS", title: "Friend-group holdings first" },
];

export function isSortMode(value: string): value is SortMode {
  return SORT_OPTIONS.some((o) => o.mode === value);
}

type GridSortProps = {
  value: SortMode;
  onChange: (mode: SortMode) => void;
};

export function GridSort({ value, onChange }: GridSortProps) {
  return (
    <div className="sort-bar" role="group" aria-label="Sort the stock grid">
      <span className="sort-bar-label">SORT BY</span>
      <div className="sort-bar-pills">
        {SORT_OPTIONS.map((opt) => (
          <button
            key={opt.mode}
            type="button"
            className={`sort-pill${value === opt.mode ? " active" : ""}`}
            aria-pressed={value === opt.mode}
            title={opt.title}
            onClick={() => onChange(opt.mode)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
