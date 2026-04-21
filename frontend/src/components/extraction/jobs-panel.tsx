import { CheckCircle, CircleDashed, ClipboardCopy, Loader, Terminal, XCircle } from "lucide-react";
import { useCallback, useState } from "react";

import type { ExtractionJob } from "../../api/types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { ScrollArea } from "../ui/scroll-area";

interface JobsPanelProps {
  jobs: ExtractionJob[];
  onCancel: (jobId: string) => void;
  onFetchLogs: (jobId: string) => Promise<string[]>;
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

function StatusIcon({ status }: { status: ExtractionJob["status"] }) {
  switch (status) {
    case "done": return <CheckCircle className="h-3.5 w-3.5 text-green-600" />;
    case "running": return <Loader className="h-3.5 w-3.5 animate-spin text-[var(--teal)]" />;
    case "queued": return <CircleDashed className="h-3.5 w-3.5 text-[var(--ink-soft)]" />;
    case "error": return <XCircle className="h-3.5 w-3.5 text-red-500" />;
    case "cancelled": return <XCircle className="h-3.5 w-3.5 text-[var(--ink-soft)]" />;
  }
}

function bagName(bagPath: string): string {
  return bagPath.split("/").filter(Boolean).pop() ?? bagPath;
}

function elapsedLabel(job: ExtractionJob): string {
  if (!job.started_at) return "";
  const start = new Date(job.started_at).getTime();
  const end = job.ended_at ? new Date(job.ended_at).getTime() : Date.now();
  const diffS = Math.round((end - start) / 1000);
  if (diffS < 60) return `${diffS}s`;
  return `${Math.floor(diffS / 60)}m ${diffS % 60}s`;
}

export function JobsPanel({ jobs, onCancel, onFetchLogs }: JobsPanelProps) {
  const [logJobId, setLogJobId] = useState<string | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  const openLogs = useCallback(
    async (jobId: string) => {
      setLogJobId(jobId);
      setLogLines([]);
      setLoadingLogs(true);
      const lines = await onFetchLogs(jobId);
      setLogLines(lines);
      setLoadingLogs(false);
    },
    [onFetchLogs],
  );

  if (jobs.length === 0) {
    return (
      <p className="text-xs text-[var(--ink-soft)]">
        No extraction jobs yet. Select a frame in the sequence viewer and click <em>Extract Dataset</em>.
      </p>
    );
  }

  return (
    <>
      <div className="space-y-2">
        {jobs.map((job) => (
          <div
            key={job.job_id}
            className="rounded-xl border border-[var(--line)] bg-[var(--bg-paper)] p-3 text-xs"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <StatusIcon status={job.status} />
                  <span className="truncate font-medium">{bagName(job.bag_path)}</span>
                </div>
                {job.window_length_s != null && job.timestamp_ns != null ? (
                  <p className="mt-0.5 text-[var(--ink-soft)]">
                    {job.window_length_s}s @ {Math.floor(job.timestamp_ns / 1_000_000).toLocaleString()} ms
                  </p>
                ) : null}
                {elapsedLabel(job) ? (
                  <p className="mt-0.5 text-[var(--ink-soft)]">{elapsedLabel(job)}</p>
                ) : null}
                {job.error_message ? (
                  <p className="mt-1 truncate text-red-500">{job.error_message}</p>
                ) : null}
              </div>
              <Badge variant={statusVariant(job.status)} className="shrink-0 capitalize text-[10px]">
                {job.status}
              </Badge>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {(job.status === "queued" || job.status === "running") ? (
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  className="h-6 px-2 text-[11px]"
                  onClick={() => onCancel(job.job_id)}
                >
                  Cancel
                </Button>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="h-6 px-2 text-[11px]"
                onClick={() => void openLogs(job.job_id)}
              >
                <Terminal className="mr-1 h-3 w-3" />
                Logs
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[11px]"
                onClick={() => void navigator.clipboard.writeText(job.output_folder)}
              >
                <ClipboardCopy className="mr-1 h-3 w-3" />
                Copy path
              </Button>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={logJobId !== null} onOpenChange={(open) => { if (!open) setLogJobId(null); }}>
        <DialogContent className="max-h-[80vh] sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Job Logs</DialogTitle>
          </DialogHeader>
          {loadingLogs ? (
            <p className="text-sm text-[var(--ink-soft)]">Loading logs…</p>
          ) : (
            <ScrollArea className="h-96 rounded-lg border border-[var(--line)] bg-black p-3">
              <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-green-400">
                {logLines.length > 0 ? logLines.join("\n") : "No log output yet."}
              </pre>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
