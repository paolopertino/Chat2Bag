import { createContext, useContext } from "react";
import type { ReactNode } from "react";

import { useExtractionJobs } from "../hooks/use-extraction-jobs";

type JobsState = ReturnType<typeof useExtractionJobs>;

const JobsContext = createContext<JobsState | null>(null);

export function JobsProvider({ children }: { children: ReactNode }) {
  const value = useExtractionJobs();
  return <JobsContext.Provider value={value}>{children}</JobsContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useJobs(): JobsState {
  const ctx = useContext(JobsContext);
  if (ctx === null) {
    throw new Error("useJobs must be used inside <JobsProvider>");
  }
  return ctx;
}
