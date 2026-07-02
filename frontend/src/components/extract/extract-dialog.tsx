import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { getExtractionSchema, submitExtraction } from "../../api/client";
import { useJobs } from "../../context/jobs-context";
import {
  DEFAULT_WINDOW_S,
  clampNs,
  formatWindowTime,
  parseWindowTime,
  windowLengthS,
  withLengthS,
} from "../../lib/extraction-window";
import {
  assembleTopics,
  clearStore,
  hydrate,
  loadStore,
  saveStore,
  toStored,
  validateTopics,
  type TopicSelectionState,
} from "../../lib/extraction-config-store";
import { ExtractionFields } from "./extraction-fields";
import { TopicsEditor } from "./topics-editor";

type Mode = "window" | "full";
type Section = "window" | "settings" | "topics" | "output";

const EMPTY_TOPIC_STATE: TopicSelectionState = { topics: [], included: [], leader: null };

interface ExtractDialogProps {
  bagPath: string;
  bagName: string;
  firstNs: number;
  lastNs: number;
  initialWindow?: { startNs: number; endNs: number } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ExtractDialog({
  bagPath,
  bagName,
  firstNs,
  lastNs,
  initialWindow,
  open,
  onOpenChange,
}: ExtractDialogProps) {
  const { schema, refresh } = useJobs();
  const [mode, setMode] = useState<Mode>("window");
  const [startNs, setStartNs] = useState(firstNs);
  const [endNs, setEndNs] = useState(firstNs);
  const [section, setSection] = useState<Section>("window");
  const [scalars, setScalars] = useState<Record<string, unknown>>({});
  const [topicState, setTopicState] = useState<TopicSelectionState>(EMPTY_TOPIC_STATE);
  const [outputFolder, setOutputFolder] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    const w = initialWindow ?? {
      startNs: firstNs,
      endNs: clampNs(firstNs + DEFAULT_WINDOW_S * 1e9, firstNs, lastNs),
    };
    setMode("window");
    setStartNs(w.startNs);
    setEndNs(w.endNs);
    setSection("window");
    setOutputFolder("");
    if (schema) {
      const { scalars: s, topicState: ts } = hydrate(schema, loadStore());
      setScalars(s);
      setTopicState(ts);
    } else {
      setScalars({});
      setTopicState(EMPTY_TOPIC_STATE);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Schema can resolve after the dialog is already open (e.g. the service was
  // still starting up). Hydrate once it arrives, but only if the form hasn't
  // been hydrated yet, so this never clobbers in-progress edits.
  useEffect(() => {
    if (!open || !schema) return;
    if (topicState.topics.length > 0) return;
    const { scalars: s, topicState: ts } = hydrate(schema, loadStore());
    setScalars(s);
    setTopicState(ts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, schema]);

  const lengthS = useMemo(() => windowLengthS({ startNs, endNs }), [startNs, endNs]);
  const available = schema?.enabled ?? false;
  const windowValid = mode === "full" || endNs > startNs;
  const topicVal = useMemo(() => validateTopics(topicState), [topicState]);
  const scalarFields = useMemo(
    () => (schema ? schema.editable_fields.filter((f) => f !== "topics") : []),
    [schema],
  );
  const canSubmit = available && windowValid && topicVal.ok && !submitting;

  if (!open) return null;

  const setStartFromText = (text: string) => {
    const ns = parseWindowTime(text, firstNs);
    if (ns === null) return;
    setStartNs(clampNs(ns, firstNs, endNs));
  };
  const setEndFromText = (text: string) => {
    const ns = parseWindowTime(text, firstNs);
    if (ns === null) return;
    setEndNs(clampNs(ns, startNs, lastNs));
  };
  const setLength = (seconds: number) => {
    if (Number.isNaN(seconds)) return;
    setEndNs(withLengthS(startNs, seconds, lastNs));
  };

  const resetToDefaults = () => {
    clearStore();
    if (schema) {
      const { scalars: s, topicState: ts } = hydrate(schema, null);
      setScalars(s);
      setTopicState(ts);
    }
  };

  async function onSubmit() {
    setSubmitting(true);
    try {
      await submitExtraction({
        bag_path: bagPath,
        mode,
        user_config: { ...scalars, topics: assembleTopics(topicState) },
        output_folder: outputFolder.trim() || undefined,
        ...(mode === "window" ? { timestamp_ns: startNs, window_length_s: lengthS } : {}),
      });
      saveStore(toStored(scalars, topicState));
      toast.success("Extraction job submitted.");
      onOpenChange(false);
      refresh();
    } catch (err) {
      let serviceDown = false;
      try {
        await getExtractionSchema();
      } catch {
        serviceDown = true;
      }
      if (serviceDown) {
        toast.error("Extraction service is not available. Start the dataset-generation service and try again.");
      } else {
        toast.error(err instanceof Error ? err.message : "Extraction failed");
      }
    } finally {
      setSubmitting(false);
    }
  }

  const navItems: { key: Section; label: string; hint: string }[] = [
    {
      key: "window",
      label: "Window",
      hint: mode === "full" ? "full bag" : `${lengthS.toFixed(1)} s`,
    },
    { key: "settings", label: "Settings", hint: `${scalarFields.length} fields` },
    {
      key: "topics",
      label: "Topics",
      hint: `${topicState.included.length} / ${topicState.topics.length}`,
    },
    { key: "output", label: "Output", hint: outputFolder.trim() ? "custom" : "auto" },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={() => onOpenChange(false)}
    >
      <div
        className="flex h-[min(44rem,88vh)] w-[min(56rem,94vw)] flex-col overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-[var(--line)] px-4 py-3">
          <h2 className="text-sm font-semibold">Extract dataset</h2>
          <p className="truncate text-xs opacity-70">{bagName}</p>
        </div>

        {!available ? (
          <div className="flex flex-1 items-center justify-center p-8 text-center text-xs opacity-70">
            Extraction service is not available. Start the dataset-generation service and reload the page.
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
            <nav className="flex w-full flex-row gap-1 overflow-x-auto border-b border-[var(--line)] p-2 sm:w-44 sm:flex-col sm:border-b-0 sm:border-r">
              {navItems.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={
                    "rounded px-2 py-1.5 text-left text-xs " +
                    (section === item.key ? "bg-[var(--line)] font-semibold" : "opacity-70")
                  }
                  onClick={() => setSection(item.key)}
                >
                  <span className="block">{item.label}</span>
                  <span className="block text-[10px] opacity-50">{item.hint}</span>
                </button>
              ))}
            </nav>

            <div className="min-w-0 flex-1 overflow-y-auto p-4">
              {section === "window" ? (
                <div>
                  <div className="mb-3 flex rounded border border-[var(--line)] p-0.5 text-xs">
                    {(["window", "full"] as Mode[]).map((m) => (
                      <button
                        key={m}
                        type="button"
                        className={"flex-1 rounded px-2 py-1 " + (mode === m ? "bg-[var(--line)] font-semibold" : "opacity-70")}
                        onClick={() => setMode(m)}
                      >
                        {m === "window" ? "Window" : "Full bag"}
                      </button>
                    ))}
                  </div>
                  {mode === "window" ? (
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <label className="block">
                        <span className="opacity-70">Start</span>
                        <input
                          key={`start-${startNs}`}
                          className="mt-1 w-full rounded border border-[var(--line)] bg-transparent px-2 py-1"
                          defaultValue={formatWindowTime(startNs, firstNs)}
                          onBlur={(e) => setStartFromText(e.target.value)}
                        />
                        <span className="mt-0.5 block text-[10px] opacity-40">{startNs} ns</span>
                      </label>
                      <label className="block">
                        <span className="opacity-70">End</span>
                        <input
                          key={`end-${endNs}`}
                          className="mt-1 w-full rounded border border-[var(--line)] bg-transparent px-2 py-1"
                          defaultValue={formatWindowTime(endNs, firstNs)}
                          onBlur={(e) => setEndFromText(e.target.value)}
                        />
                        <span className="mt-0.5 block text-[10px] opacity-40">{endNs} ns</span>
                      </label>
                      <label className="block">
                        <span className="opacity-70">Length (s)</span>
                        <input
                          type="number"
                          min={0}
                          step={0.1}
                          className="mt-1 w-full rounded border border-[var(--line)] bg-transparent px-2 py-1"
                          value={Number(lengthS.toFixed(3))}
                          onChange={(e) => setLength(Number(e.target.value))}
                        />
                      </label>
                    </div>
                  ) : (
                    <div className="rounded border border-[var(--line)] px-3 py-2 text-xs">
                      Entire bag · {formatWindowTime(firstNs, firstNs)} → {formatWindowTime(lastNs, firstNs)} ·{" "}
                      {windowLengthS({ startNs: firstNs, endNs: lastNs }).toFixed(1)} s
                    </div>
                  )}
                </div>
              ) : null}

              {section === "settings" ? (
                <ExtractionFields
                  fields={scalarFields}
                  values={scalars}
                  onChange={(field, value) => setScalars((prev) => ({ ...prev, [field]: value }))}
                />
              ) : null}

              {section === "topics" ? (
                <TopicsEditor state={topicState} onChange={setTopicState} />
              ) : null}

              {section === "output" ? (
                <label className="block text-xs">
                  <span className="opacity-70">Output folder</span>
                  <input
                    className="mt-1 w-full rounded border border-[var(--line)] bg-transparent px-2 py-1"
                    placeholder="blank = auto path under the bag's artifact dir"
                    value={outputFolder}
                    onChange={(e) => setOutputFolder(e.target.value)}
                  />
                </label>
              ) : null}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-[var(--line)] px-4 py-3 text-xs">
          <span className="min-w-0 truncate opacity-60">
            {available ? (
              <>
                Remembered from last extraction ·{" "}
                <button type="button" className="underline hover:opacity-100" onClick={resetToDefaults}>
                  reset to server defaults
                </button>
              </>
            ) : null}
          </span>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              className="rounded border border-[var(--line)] px-3 py-1"
              onClick={() => onOpenChange(false)}
            >
              cancel
            </button>
            <button
              type="button"
              className="rounded bg-sky-500/80 px-3 py-1 disabled:opacity-50"
              onClick={() => void onSubmit()}
              disabled={!canSubmit}
              title={
                !available
                  ? "Extraction service is not available"
                  : !windowValid
                    ? "Window length must be greater than zero"
                    : !topicVal.ok
                      ? topicVal.error
                      : undefined
              }
            >
              {submitting ? "submitting…" : mode === "window" ? "Extract window" : "Extract full bag"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
