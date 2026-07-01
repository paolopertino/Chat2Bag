import { useState } from "react";
import type { ChangeEvent } from "react";

type WidgetKind = "path" | "text" | "number" | "int" | "toggle" | "topics";

interface FieldPresentation {
  label: string;
  widget: WidgetKind;
  placeholder?: string;
  step?: number;
  min?: number;
}

const PRESENTATION: Record<string, FieldPresentation> = {
  calibration_path: { label: "Calibration path", widget: "path", placeholder: "/path/to/calibration" },
  frames_path: { label: "Frames path", widget: "path", placeholder: "/path/to/frames" },
  target_lidar_frame: { label: "Target lidar frame", widget: "text", placeholder: "lidar_top" },
  sync_threshold: { label: "Sync threshold (s)", widget: "number", step: 0.01, min: 0 },
  n_workers: { label: "Workers", widget: "int", min: 1 },
  save_on_disk: { label: "Save on disk", widget: "toggle" },
  topics: { label: "Topics", widget: "topics" },
};

function prettify(key: string): string {
  return key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function inferWidget(value: unknown): WidgetKind {
  if (typeof value === "boolean") return "toggle";
  if (typeof value === "number") return "number";
  if (Array.isArray(value)) return "topics";
  return "text";
}

function presentationFor(field: string, value: unknown): FieldPresentation {
  return PRESENTATION[field] ?? { label: prettify(field), widget: inferWidget(value) };
}

interface ExtractionFieldsProps {
  editableFields: string[];
  defaults: Record<string, unknown>;
  values: Record<string, unknown>;
  onChange: (field: string, value: unknown) => void;
}

export function ExtractionFields({ editableFields, defaults, values, onChange }: ExtractionFieldsProps) {
  const valueOf = (field: string) => (field in values ? values[field] : defaults[field]);

  return (
    <div className="flex flex-col gap-2.5">
      {editableFields.map((field) => {
        const value = valueOf(field);
        const p = presentationFor(field, value);

        if (p.widget === "toggle") {
          return (
            <label key={field} className="flex items-center justify-between text-xs">
              <span className="opacity-70">{p.label}</span>
              <input
                type="checkbox"
                checked={Boolean(value)}
                onChange={(e) => onChange(field, e.target.checked)}
              />
            </label>
          );
        }

        if (p.widget === "topics") {
          return (
            <TopicsEditor
              key={field}
              label={p.label}
              value={Array.isArray(value) ? (value as string[]) : []}
              onChange={(next) => onChange(field, next)}
            />
          );
        }

        const numeric = p.widget === "number" || p.widget === "int";
        return (
          <label key={field} className="block text-xs">
            <span className="opacity-70">{p.label}</span>
            <input
              type={numeric ? "number" : "text"}
              className="mt-1 w-full rounded border border-[var(--line)] bg-transparent px-2 py-1"
              placeholder={p.placeholder}
              step={p.widget === "int" ? 1 : p.step}
              min={p.min}
              value={value === undefined || value === null ? "" : String(value)}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                if (p.widget === "int") {
                  onChange(field, e.target.value === "" ? null : Math.trunc(Number(e.target.value)));
                } else if (p.widget === "number") {
                  onChange(field, e.target.value === "" ? null : Number(e.target.value));
                } else {
                  onChange(field, e.target.value);
                }
              }}
            />
          </label>
        );
      })}
    </div>
  );
}

function TopicsEditor({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const t = draft.trim();
    if (t && !value.includes(t)) onChange([...value, t]);
    setDraft("");
  };
  return (
    <div className="text-xs">
      <span className="opacity-70">{label}</span>
      <div className="mt-1 flex flex-wrap gap-1">
        {value.map((t) => (
          <span key={t} className="flex items-center gap-1 rounded-full border border-[var(--line)] px-2 py-0.5">
            {t}
            <button
              type="button"
              className="opacity-50 hover:opacity-100"
              onClick={() => onChange(value.filter((x) => x !== t))}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="mt-1 flex gap-1">
        <input
          className="w-full rounded border border-[var(--line)] bg-transparent px-2 py-1"
          placeholder="/topic/name"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" className="rounded border border-[var(--line)] px-2" onClick={add}>
          add
        </button>
      </div>
    </div>
  );
}
