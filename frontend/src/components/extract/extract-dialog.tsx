import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { submitExtraction } from "../../api/client";
import { useJobs } from "../../context/jobs-context";
import {
  DEFAULT_WINDOW_S,
  clampNs,
  formatWindowTime,
  parseWindowTime,
  windowLengthS,
  withLengthS,
} from "../../lib/extraction-window";
import { ExtractionFields } from "./extraction-fields";

type Mode = "window" | "full";

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
  const [showSettings, setShowSettings] = useState(false);
  const [showOutput, setShowOutput] = useState(false);
  const [outputFolder, setOutputFolder] = useState("");
  const [userConfig, setUserConfig] = useState<Record<string, unknown>>({});
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
    setShowSettings(false);
    setShowOutput(false);
    setOutputFolder("");
    setUserConfig(schema?.defaults ? { ...(schema.defaults as Record<string, unknown>) } : {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const lengthS = useMemo(() => windowLengthS({ startNs, endNs }), [startNs, endNs]);
  const enabled = schema?.enabled ?? false;
  const windowValid = mode === "full" || endNs > startNs;

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

  async function onSubmit() {
    setSubmitting(true);
    try {
      await submitExtraction({
        bag_path: bagPath,
        mode,
        user_config: userConfig,
        output_folder: outputFolder.trim() || undefined,
        ...(mode === "window" ? { timestamp_ns: startNs, window_length_s: lengthS } : {}),
      });
      toast.success("Extraction job submitted.");
      onOpenChange(false);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Extraction failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={() => onOpenChange(false)}
    >
      <div
        className="max-h-[85vh] w-[34rem] max-w-[92vw] overflow-y-auto rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 text-sm font-semibold">Extract dataset</h2>
        <p className="mb-3 truncate text-xs opacity-70">{bagName}</p>

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
          <div className="mb-3 grid grid-cols-3 gap-2 text-xs">
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
          <div className="mb-3 rounded border border-[var(--line)] px-3 py-2 text-xs">
            Entire bag · {formatWindowTime(firstNs, firstNs)} → {formatWindowTime(lastNs, firstNs)} ·{" "}
            {windowLengthS({ startNs: firstNs, endNs: lastNs }).toFixed(1)} s
          </div>
        )}

        <div className="border-t border-[var(--line)] pt-2">
          <button
            type="button"
            className="flex w-full items-center gap-1 text-xs"
            onClick={() => setShowSettings((v) => !v)}
          >
            <span className="opacity-50">{showSettings ? "▾" : "▸"}</span> Extraction settings
            {!showSettings ? <span className="ml-auto opacity-40">using defaults</span> : null}
          </button>
          {showSettings && schema ? (
            <div className="mt-2">
              <ExtractionFields
                editableFields={schema.editable_fields}
                defaults={schema.defaults as Record<string, unknown>}
                values={userConfig}
                onChange={(field, value) => setUserConfig((prev) => ({ ...prev, [field]: value }))}
              />
            </div>
          ) : null}
        </div>

        <div className="mt-1 border-t border-[var(--line)] pt-2">
          <button
            type="button"
            className="flex w-full items-center gap-1 text-xs"
            onClick={() => setShowOutput((v) => !v)}
          >
            <span className="opacity-50">{showOutput ? "▾" : "▸"}</span> Output folder
            {!showOutput ? <span className="ml-auto opacity-40">auto</span> : null}
          </button>
          {showOutput ? (
            <input
              className="mt-2 w-full rounded border border-[var(--line)] bg-transparent px-2 py-1 text-xs"
              placeholder="blank = auto path under the bag's artifact dir"
              value={outputFolder}
              onChange={(e) => setOutputFolder(e.target.value)}
            />
          ) : null}
        </div>

        <div className="mt-4 flex justify-end gap-2 text-sm">
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
            disabled={submitting || !enabled || !windowValid}
            title={
              !enabled
                ? "Extraction service offline"
                : !windowValid
                  ? "Window length must be greater than zero"
                  : undefined
            }
          >
            {submitting ? "submitting…" : mode === "window" ? "Extract window" : "Extract full bag"}
          </button>
        </div>
      </div>
    </div>
  );
}
