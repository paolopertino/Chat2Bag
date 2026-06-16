import { useState } from "react";
import { toast } from "sonner";

import { submitExtraction } from "../../api/client";

interface ExtractDialogProps {
  bagPath: string;
  timestampNs: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ExtractDialog({ bagPath, timestampNs, open, onOpenChange }: ExtractDialogProps) {
  const [windowLengthS, setWindowLengthS] = useState(10);
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  async function onSubmit() {
    setSubmitting(true);
    try {
      const resp = await submitExtraction({
        bag_path: bagPath,
        mode: "window",
        timestamp_ns: timestampNs,
        window_length_s: windowLengthS,
        user_config: {},
      });
      toast.success(`Extraction queued (job ${resp.job_id})`);
      onOpenChange(false);
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
        className="w-80 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-sm font-semibold">Extract window</h2>
        <p className="mb-2 truncate text-xs opacity-70">{bagPath}</p>
        <p className="mb-3 text-xs opacity-70">start: {timestampNs}</p>
        <label className="mb-3 block text-xs">
          window length (s)
          <input
            type="number"
            min={1}
            className="mt-1 w-full rounded border border-[var(--line)] bg-transparent px-2 py-1"
            value={windowLengthS}
            onChange={(e) => setWindowLengthS(Number(e.target.value))}
          />
        </label>
        <div className="flex justify-end gap-2 text-sm">
          <button
            className="rounded border border-[var(--line)] px-3 py-1"
            onClick={() => onOpenChange(false)}
          >
            cancel
          </button>
          <button
            className="rounded bg-sky-500/80 px-3 py-1 disabled:opacity-50"
            onClick={() => void onSubmit()}
            disabled={submitting}
          >
            {submitting ? "submitting…" : "extract"}
          </button>
        </div>
      </div>
    </div>
  );
}
