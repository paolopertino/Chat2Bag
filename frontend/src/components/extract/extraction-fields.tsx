import type { ChangeEvent } from "react";

type WidgetKind = "path" | "text" | "number" | "int" | "toggle";

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
};

function prettify(key: string): string {
  return key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function presentationFor(field: string, value: unknown): FieldPresentation {
  if (PRESENTATION[field]) return PRESENTATION[field];
  const widget: WidgetKind =
    typeof value === "boolean" ? "toggle" : typeof value === "number" ? "number" : "text";
  return { label: prettify(field), widget };
}

interface ExtractionFieldsProps {
  fields: string[];
  values: Record<string, unknown>;
  onChange: (field: string, value: unknown) => void;
}

export function ExtractionFields({ fields, values, onChange }: ExtractionFieldsProps) {
  return (
    <div className="flex flex-col gap-3">
      {fields.map((field) => {
        const value = values[field];
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
