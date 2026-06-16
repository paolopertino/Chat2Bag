import { CheckCircle, CircleDashed, Loader, XCircle } from "lucide-react";

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

export function JobsTab() {
  const { jobs, extractionEnabled, cancelJob } = useJobs();

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
      {jobs.map((job) => (
        <li
          key={job.job_id}
          className="rounded-xl border border-[var(--line)] bg-[var(--bg-paper)] p-3 text-xs"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <StatusIcon status={job.status} />
                <span className="truncate font-medium">{bagName(job.bag_path)}</span>
              </div>
              {job.window_length_s != null ? (
                <p className="mt-0.5 text-[var(--ink-soft)]">
                  {job.window_length_s}s window
                </p>
              ) : null}
              {job.error_message ? (
                <p className="mt-1 truncate text-red-500">{job.error_message}</p>
              ) : null}
            </div>
            <Badge variant={statusVariant(job.status)} className="shrink-0 capitalize text-[10px]">
              {job.status}
            </Badge>
          </div>
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
      ))}
    </ul>
  );
}
