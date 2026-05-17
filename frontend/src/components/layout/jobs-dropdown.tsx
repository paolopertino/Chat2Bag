import { Briefcase } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { JobsPanel } from "../extraction/jobs-panel";
import { useJobs } from "../../context/jobs-context";

const ACTIVE_STATUSES = new Set(["queued", "running"]);

export function JobsDropdown() {
  const { jobs, extractionEnabled, cancelJob, fetchLogs } = useJobs();

  // Hidden entirely when the feature is disabled (spec §3).
  if (!extractionEnabled) return null;

  const activeCount = jobs.filter((j) => ACTIVE_STATUSES.has(j.status)).length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" aria-label="Extraction jobs">
          <Briefcase className="h-3.5 w-3.5" />
          <span>Jobs</span>
          {activeCount > 0 ? (
            <Badge variant="indexing" className="ml-1 h-5 px-1.5 text-[10px]">
              {activeCount}
            </Badge>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="w-[28rem] max-w-[90vw] p-3"
      >
        {jobs.length === 0 ? (
          <p className="px-1 py-4 text-center text-xs text-[var(--ink-soft)]">
            No extraction jobs yet.
          </p>
        ) : (
          <JobsPanel jobs={jobs} onCancel={cancelJob} onFetchLogs={fetchLogs} />
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
