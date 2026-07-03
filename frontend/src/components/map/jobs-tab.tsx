import { useCallback, useRef, useState } from "react";
import { CheckCircle, ChevronDown, ChevronRight, CircleDashed, Loader, XCircle } from "lucide-react";

import { useJobs } from "../../context/jobs-context";
import type { ExtractionJob } from "../../api/types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

function StatusIcon({ status }: { status: ExtractionJob["status"] }) {
  switch (status) {
    case "done": return <CheckCircle className="h-3.5 w-3.5 text-green-600" />;
    case "running": return <Loader className="h-3.5 w-3.5 animate-spin text-[var(--teal)]" />;
    case "queued": return <CircleDashed className="h-3.5 w-3.5 text-[var(--ink-soft)]" />;
    case "error": return <XCircle className="h-3.5 w-3.5 text-red-500" />;
    case "cancelled": return <XCircle className="h-3.5 w-3.5 text-[var(--ink-soft)]" />;
  }
}

function statusVariant(status: ExtractionJob["status"]): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "done": return "default";
    case "running": return "secondary";
    case "queued": return "outline";
    case "error": return "destructive";
    case "cancelled": return "outline";
  }
}

function bagName(bagPath: string): string {
  return bagPath.split("/").filter(Boolean).pop() ?? bagPath;
}

interface LogState {
  loading: boolean;
  loaded: boolean;
  lines: string[];
}

export function JobsTab() {
  const { jobs, extractionEnabled, cancelJob, fetchLogs } = useJobs();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [logs, setLogs] = useState<Record<string, LogState>>({});
  const fetchedRef = useRef<Set<string>>(new Set());

  const toggle = useCallback(
    (jobId: string) => {
      const willExpand = expandedId !== jobId;
      setExpandedId(willExpand ? jobId : null);
      if (willExpand && !fetchedRef.current.has(jobId)) {
        fetchedRef.current.add(jobId);
        setLogs((prev) => ({ ...prev, [jobId]: { loading: true, loaded: false, lines: [] } }));
        void fetchLogs(jobId).then((lines) =>
          setLogs((prev) => ({ ...prev, [jobId]: { loading: false, loaded: true, lines } })),
        );
      }
    },
    [expandedId, fetchLogs],
  );

  if (!extractionEnabled) {
    return (
      <p className="p-2 text-xs opacity-60">Extraction feature is not enabled.</p>
    );
  }

  if (jobs.length === 0) {
    return (
      <p className="p-2 text-xs opacity-60">No extraction jobs yet.</p>
    );
  }

  return (
    <ul className="space-y-2">
      {jobs.map((job) => {
        const expanded = expandedId === job.job_id;
        const logState = logs[job.job_id];
        return (
          <li
            key={job.job_id}
            className="rounded-xl border border-[var(--line)] bg-[var(--bg-paper)] p-3 text-xs"
          >
            <button
              type="button"
              className="flex w-full items-start justify-between gap-2 text-left"
              onClick={() => toggle(job.job_id)}
              aria-expanded={expanded}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  {expanded ? (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--ink-soft)]" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--ink-soft)]" />
                  )}
                  <StatusIcon status={job.status} />
                  <span className="truncate font-medium">{bagName(job.bag_path)}</span>
                </div>
                {job.window_length_s != null ? (
                  <p className="mt-0.5 text-[var(--ink-soft)]">
                    {job.window_length_s}s window
                  </p>
                ) : null}
                {job.error_message ? (
                  <p
                    className={
                      "mt-1 text-red-500 " +
                      (expanded ? "whitespace-pre-wrap break-words" : "truncate")
                    }
                  >
                    {job.error_message}
                  </p>
                ) : null}
              </div>
              <Badge variant={statusVariant(job.status)} className="shrink-0 capitalize text-[10px]">
                {job.status}
              </Badge>
            </button>

            {expanded ? (
              <div className="mt-2 border-t border-[var(--line)] pt-2">
                <p className="mb-1 text-[10px] uppercase tracking-wide text-[var(--ink-soft)]">
                  Logs
                </p>
                {logState?.loading ? (
                  <p className="flex items-center gap-1.5 text-[var(--ink-soft)]">
                    <Loader className="h-3 w-3 animate-spin" /> Loading logs…
                  </p>
                ) : logState?.lines.length ? (
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-black/30 p-2 font-mono text-[11px] leading-relaxed">
                    {logState.lines.join("\n")}
                  </pre>
                ) : (
                  <p className="text-[var(--ink-soft)]">No logs available for this job.</p>
                )}
              </div>
            ) : null}

            {(job.status === "queued" || job.status === "running") ? (
              <div className="mt-2">
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  className="h-6 px-2 text-[11px]"
                  onClick={() => void cancelJob(job.job_id)}
                >
                  Cancel
                </Button>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
