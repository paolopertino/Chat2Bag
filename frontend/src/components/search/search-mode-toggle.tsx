export type SearchMode = "global" | "region";

interface SearchModeToggleProps {
  mode: SearchMode;
  onChange: (mode: SearchMode) => void;
}

const MODES: { value: SearchMode; label: string }[] = [
  { value: "global", label: "Global" },
  { value: "region", label: "Region" },
];

export function SearchModeToggle({ mode, onChange }: SearchModeToggleProps) {
  return (
    <div className="inline-flex shrink-0 rounded-lg border border-[var(--line)] bg-[var(--bg-paper)] p-0.5">
      {MODES.map((m) => (
        <button
          key={m.value}
          type="button"
          onClick={() => onChange(m.value)}
          aria-pressed={mode === m.value}
          className={
            "rounded-md px-3 py-1 text-xs font-medium transition-colors " +
            (mode === m.value
              ? "bg-[var(--teal)] text-white"
              : "text-[var(--ink-soft)] hover:text-[var(--ink)]")
          }
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
