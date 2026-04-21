import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  cancelExtractionJob,
  getExtractionLogs,
  getExtractionSchema,
  listExtractionJobs,
} from "../api/client";
import type { ExtractionConfigSchema, ExtractionJob } from "../api/types";

const POLL_INTERVAL_MS = 2000;
const ACTIVE_STATUSES = new Set(["queued", "running"]);

export function useExtractionJobs() {
  const [jobs, setJobs] = useState<ExtractionJob[]>([]);
  const [schema, setSchema] = useState<ExtractionConfigSchema | null>(null);
  const [extractionEnabled, setExtractionEnabled] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const updated = await listExtractionJobs();
      setJobs(updated);
    } catch {
      // Service unavailable — silently skip
    }
  }, []);

  // Probe whether the extraction feature is enabled
  useEffect(() => {
    getExtractionSchema()
      .then((s) => {
        setSchema(s);
        setExtractionEnabled(s.enabled);
        void refresh();
      })
      .catch(() => {
        setExtractionEnabled(false);
      });
  }, [refresh]);

  // Polling while any job is active
  useEffect(() => {
    const hasActive = jobs.some((j) => ACTIVE_STATUSES.has(j.status));

    if (hasActive && !pollingRef.current) {
      pollingRef.current = setInterval(() => {
        void refresh();
      }, POLL_INTERVAL_MS);
    } else if (!hasActive && pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [jobs, refresh]);

  const cancelJob = useCallback(
    async (jobId: string) => {
      try {
        const updated = await cancelExtractionJob(jobId);
        setJobs((prev) => prev.map((j) => (j.job_id === jobId ? updated : j)));
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Failed to cancel job.";
        toast.error(msg);
      }
    },
    [],
  );

  const fetchLogs = useCallback(async (jobId: string, tail = 500): Promise<string[]> => {
    try {
      return await getExtractionLogs(jobId, tail);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to fetch logs.";
      toast.error(msg);
      return [];
    }
  }, []);

  const isPolling = jobs.some((j) => ACTIVE_STATUSES.has(j.status));

  return {
    jobs,
    schema,
    extractionEnabled,
    isPolling,
    refresh,
    cancelJob,
    fetchLogs,
  };
}
