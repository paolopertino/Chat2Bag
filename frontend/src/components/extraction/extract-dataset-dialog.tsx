import { ChevronDown, ChevronRight, Database, LoaderCircle } from "lucide-react";
import { useMemo, useState } from "react";

import type { ExtractionConfigSchema } from "../../api/types";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import { Separator } from "../ui/separator";

// ---- Types ----------------------------------------------------------------

interface TopicItem {
  name: string;
  topic_path?: string;
  modality?: string;
  [key: string]: unknown;
}

// ---- Helpers ----------------------------------------------------------------

function formatMs(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").replace("Z", "");
}

/** Detect whether a schema default value is a list of named objects (e.g. topics). */
function isNamedObjectList(value: unknown): value is TopicItem[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    typeof value[0] === "object" &&
    value[0] !== null &&
    "name" in (value[0] as object)
  );
}

function groupByModality(items: TopicItem[]): Record<string, TopicItem[]> {
  const groups: Record<string, TopicItem[]> = {};
  for (const item of items) {
    const key = item.modality ?? "other";
    (groups[key] ??= []).push(item);
  }
  return groups;
}

// ---- Sub-components --------------------------------------------------------

interface TopicChecklistProps {
  /** All available topics from the defaults. */
  allTopics: TopicItem[];
  /** Currently selected topics (subset of allTopics). */
  selectedTopics: TopicItem[];
  onChange: (selected: TopicItem[]) => void;
}

function TopicChecklist({ allTopics, selectedTopics, onChange }: TopicChecklistProps) {
  const selectedNames = useMemo(
    () => new Set(selectedTopics.map((t) => t.name)),
    [selectedTopics],
  );

  const groups = useMemo(() => groupByModality(allTopics), [allTopics]);

  const toggle = (topic: TopicItem) => {
    if (selectedNames.has(topic.name)) {
      onChange(selectedTopics.filter((t) => t.name !== topic.name));
    } else {
      // Re-insert in original order to preserve sync_leader ordering
      const names = new Set([...Array.from(selectedNames), topic.name]);
      onChange(allTopics.filter((t) => names.has(t.name)));
    }
  };

  const toggleGroup = (groupItems: TopicItem[]) => {
    const allSelected = groupItems.every((t) => selectedNames.has(t.name));
    if (allSelected) {
      const groupNames = new Set(groupItems.map((t) => t.name));
      onChange(selectedTopics.filter((t) => !groupNames.has(t.name)));
    } else {
      const existing = new Set(selectedTopics.map((t) => t.name));
      groupItems.forEach((t) => existing.add(t.name));
      onChange(allTopics.filter((t) => existing.has(t.name)));
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-[var(--ink-soft)]">
          {selectedNames.size} / {allTopics.length} topics selected
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            className="text-[11px] text-[var(--teal)] hover:underline"
            onClick={() => onChange([...allTopics])}
          >
            All
          </button>
          <button
            type="button"
            className="text-[11px] text-[var(--ink-soft)] hover:underline"
            onClick={() => onChange([])}
          >
            None
          </button>
        </div>
      </div>

      <ScrollArea className="h-64 rounded-lg border border-[var(--line)] bg-[var(--bg-paper)] p-2">
        <div className="space-y-3">
          {Object.entries(groups).map(([modality, items]) => {
            const allGroupSelected = items.every((t) => selectedNames.has(t.name));
            const someGroupSelected = items.some((t) => selectedNames.has(t.name));
            return (
              <div key={modality}>
                {/* Group header */}
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded px-1 py-0.5 hover:bg-[var(--bg-sand)]"
                  onClick={() => toggleGroup(items)}
                >
                  <input
                    type="checkbox"
                    readOnly
                    checked={allGroupSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someGroupSelected && !allGroupSelected;
                    }}
                    className="accent-[var(--teal)]"
                    aria-label={`Toggle all ${modality}`}
                  />
                  <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--ink-soft)]">
                    {modality}
                  </span>
                  <span className="text-[11px] text-[var(--ink-soft)]">
                    ({items.filter((t) => selectedNames.has(t.name)).length}/{items.length})
                  </span>
                </button>

                {/* Topic rows */}
                {items.map((topic) => (
                  <label
                    key={topic.name}
                    className="flex cursor-pointer items-start gap-2 rounded px-3 py-1 hover:bg-[var(--bg-sand)]"
                  >
                    <input
                      type="checkbox"
                      checked={selectedNames.has(topic.name)}
                      onChange={() => toggle(topic)}
                      className="mt-0.5 accent-[var(--teal)]"
                    />
                    <div className="min-w-0">
                      <p className="text-xs font-medium leading-tight text-[var(--ink)]">
                        {topic.name}
                      </p>
                      {topic.topic_path ? (
                        <p className="truncate font-mono text-[10px] text-[var(--ink-soft)]">
                          {topic.topic_path}
                        </p>
                      ) : null}
                    </div>
                  </label>
                ))}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}

// ---- Scalar field renderer -------------------------------------------------

interface ScalarFieldProps {
  field: string;
  value: unknown;
  defaultValue: unknown;
  onChange: (value: unknown) => void;
}

function ScalarField({ field, value, defaultValue, onChange }: ScalarFieldProps) {
  const isBoolean =
    typeof value === "boolean" ||
    (defaultValue != null && typeof defaultValue === "boolean");
  const isNumber =
    typeof value === "number" ||
    (defaultValue != null && typeof defaultValue === "number");

  if (isBoolean) {
    return (
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id={`field-${field}`}
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          className="accent-[var(--teal)]"
        />
        <span className="text-xs text-[var(--ink-soft)]">{String(value ?? false)}</span>
      </div>
    );
  }

  return (
    <Input
      id={`field-${field}`}
      type={isNumber ? "number" : "text"}
      value={value == null ? "" : String(value)}
      onChange={(e) =>
        onChange(
          isNumber
            ? e.target.value === ""
              ? null
              : Number(e.target.value)
            : e.target.value,
        )
      }
      placeholder={defaultValue == null ? "" : String(defaultValue)}
      className="h-8 font-mono text-xs"
    />
  );
}

// ---- Main dialog -----------------------------------------------------------

interface ExtractDatasetDialogProps {
  isOpen: boolean;
  isSubmitting: boolean;
  schema: ExtractionConfigSchema | null;
  bagName: string;
  bagPath: string;
  centerTimestampMs: number;
  windowS: number;
  outputFolder: string;
  userConfig: Record<string, unknown>;
  onClose: () => void;
  onSubmit: () => void;
  onBagPathChange: (value: string) => void;
  onWindowChange: (value: number) => void;
  onOutputFolderChange: (value: string) => void;
  onFieldChange: (field: string, value: unknown) => void;
}

export function ExtractDatasetDialog({
  isOpen,
  isSubmitting,
  schema,
  bagName,
  bagPath,
  centerTimestampMs,
  windowS,
  outputFolder,
  userConfig,
  onClose,
  onSubmit,
  onBagPathChange,
  onWindowChange,
  onOutputFolderChange,
  onFieldChange,
}: ExtractDatasetDialogProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const startMs = centerTimestampMs - (windowS / 2) * 1000;
  const endMs = centerTimestampMs + (windowS / 2) * 1000;

  // Partition editable fields into named-object-lists vs scalars
  const { listFields, scalarFields } = useMemo(() => {
    if (!schema) return { listFields: [] as string[], scalarFields: [] as string[] };
    const lists: string[] = [];
    const scalars: string[] = [];
    for (const f of schema.editable_fields) {
      if (isNamedObjectList(schema.defaults[f])) {
        lists.push(f);
      } else {
        scalars.push(f);
      }
    }
    return { listFields: lists, scalarFields: scalars };
  }, [schema]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-[var(--teal)]" />
            <DialogTitle>Extract NuScenes Dataset</DialogTitle>
          </div>
          <DialogDescription>
            Configure and launch an extraction job from{" "}
            <span className="font-medium">{bagName}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Window */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ink-soft)]">
              Extraction Window
            </p>
            <div className="rounded-lg border border-[var(--line)] bg-[var(--bg-paper)] px-3 py-2 text-xs text-[var(--ink-soft)]">
              <p>
                Center: <span className="font-mono">{formatMs(centerTimestampMs)}</span>
              </p>
              <p className="mt-0.5">
                Range:{" "}
                <span className="font-mono">{formatMs(startMs)}</span>
                {" → "}
                <span className="font-mono">{formatMs(endMs)}</span>
              </p>
            </div>
            <div className="rounded-lg border border-[var(--line)] bg-[var(--bg-paper)] px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium text-[var(--ink-soft)]">
                  Duration: {windowS}s
                </p>
                <div className="flex items-center gap-1.5">
                  {[5, 10, 20, 30].map((preset) => (
                    <Button
                      key={preset}
                      type="button"
                      size="sm"
                      variant={windowS === preset ? "default" : "secondary"}
                      onClick={() => onWindowChange(preset)}
                      className="h-6 px-2 text-[11px]"
                    >
                      {preset}s
                    </Button>
                  ))}
                </div>
              </div>
              <input
                type="range"
                min={5}
                max={120}
                value={windowS}
                onChange={(e) => onWindowChange(Number(e.target.value) || 5)}
                className="mt-2 w-full accent-[var(--teal)]"
                aria-label="Extraction window duration"
              />
            </div>
          </div>

          <Separator />

          {/* Bag path — editable so the user can adjust for Docker path mappings */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-[var(--ink)]">
              Bag Path{" "}
              <span className="text-[var(--ink-soft)]">
                (as seen by the extraction service)
              </span>
            </label>
            <Input
              type="text"
              value={bagPath}
              onChange={(e) => onBagPathChange(e.target.value)}
              className="h-8 font-mono text-xs"
            />
          </div>

          <Separator />

          {/* Scalar config fields */}
          {scalarFields.length > 0 ? (
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ink-soft)]">
                Configuration
              </p>
              {scalarFields.map((field) => (
                <div key={field} className="space-y-1">
                  <label
                    htmlFor={`field-${field}`}
                    className="text-xs font-medium text-[var(--ink)]"
                  >
                    {field}
                  </label>
                  <ScalarField
                    field={field}
                    value={userConfig[field]}
                    defaultValue={schema?.defaults[field]}
                    onChange={(v) => onFieldChange(field, v)}
                  />
                </div>
              ))}
            </div>
          ) : null}

          {/* Named-object-list fields (e.g. topics) */}
          {listFields.map((field) => {
            const allItems = (schema?.defaults[field] ?? []) as TopicItem[];
            const selectedItems = Array.isArray(userConfig[field])
              ? (userConfig[field] as TopicItem[])
              : allItems;
            return (
              <div key={field} className="space-y-2">
                <Separator />
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ink-soft)]">
                  {field === "topics" ? "Topics to Extract" : field}
                </p>
                <TopicChecklist
                  allTopics={allItems}
                  selectedTopics={selectedItems}
                  onChange={(v) => onFieldChange(field, v)}
                />
              </div>
            );
          })}

          {/* Output folder */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-[var(--ink)]">
              Output Folder{" "}
              <span className="text-[var(--ink-soft)]">(optional — auto-computed if empty)</span>
            </label>
            <Input
              type="text"
              value={outputFolder}
              onChange={(e) => onOutputFolderChange(e.target.value)}
              placeholder="/path/to/output (leave empty for auto)"
              className="h-8 font-mono text-xs"
            />
          </div>

          {/* Advanced — fixed overrides */}
          {schema && Object.keys(schema.fixed_overrides_preview).length > 0 ? (
            <div>
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="flex items-center gap-1 text-xs text-[var(--ink-soft)] hover:text-[var(--ink)]"
              >
                {showAdvanced ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
                Fixed overrides (read-only — set by admin)
              </button>
              {showAdvanced ? (
                <pre className="mt-2 overflow-x-auto rounded-lg border border-[var(--line)] bg-[var(--bg-paper)] p-3 text-[11px] text-[var(--ink-soft)]">
                  {JSON.stringify(schema.fixed_overrides_preview, null, 2)}
                </pre>
              ) : null}
            </div>
          ) : null}

          <Separator />

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="button" onClick={onSubmit} disabled={isSubmitting}>
              {isSubmitting ? (
                <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {isSubmitting ? "Submitting..." : "Launch Extraction"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
