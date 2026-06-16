import { PanelLeftClose, PanelLeftOpen, RefreshCw } from "lucide-react";
import { useState, type ReactNode } from "react";

import type { BagInfo } from "../../api/types";
import { BagTree } from "./bag-tree";

interface MapSidePanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bags: BagInfo[];
  root: string | null;
  locatedOrder: string[];
  rootDir: string;
  setRootDir: (dir: string) => void;
  isScanning: boolean;
  onScan: () => void;
  onIndex: (bagPath: string) => void;
  onRetry: (bagPath: string) => void;
  isBagHidden: (bagPath: string) => boolean;
  onToggleBagVisibility: (bagPath: string) => void;
  onSetGroupHidden: (bagPaths: string[], hidden: boolean) => void;
  onHoverBag: (bagPath: string | null) => void;
  onOpenBag: (bagPath: string) => void;
  jobsTab: ReactNode;
}

export function MapSidePanel(props: MapSidePanelProps) {
  const [tab, setTab] = useState<"bags" | "jobs">("bags");

  if (!props.open) {
    return (
      <button
        className="absolute left-4 top-20 z-10 rounded-md border border-[var(--line)] bg-[var(--surface)] p-2"
        onClick={() => props.onOpenChange(true)}
        aria-label="Open bag panel"
      >
        <PanelLeftOpen className="h-4 w-4" />
      </button>
    );
  }

  return (
    <div className="absolute bottom-28 left-4 top-20 z-10 flex w-72 flex-col rounded-lg border border-[var(--line)] bg-[var(--glass)] shadow-lg backdrop-blur">
      <div className="flex items-center justify-between border-b border-[var(--line)] px-3 py-2">
        <div className="flex gap-1 text-sm">
          <button
            className={tab === "bags" ? "font-semibold" : "opacity-60"}
            onClick={() => setTab("bags")}
          >
            Bags
          </button>
          <span className="opacity-30">·</span>
          <button
            className={tab === "jobs" ? "font-semibold" : "opacity-60"}
            onClick={() => setTab("jobs")}
          >
            Jobs
          </button>
        </div>
        <button onClick={() => props.onOpenChange(false)} aria-label="Collapse panel">
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>

      {tab === "bags" ? (
        <>
          <div className="flex gap-2 border-b border-[var(--line)] p-2">
            <input
              className="min-w-0 flex-1 rounded border border-[var(--line)] bg-transparent px-2 py-1 text-xs"
              value={props.rootDir}
              placeholder="bags root directory"
              onChange={(e) => props.setRootDir(e.target.value)}
            />
            <button
              className="rounded border border-[var(--line)] px-2"
              onClick={props.onScan}
              disabled={props.isScanning}
              aria-label="Scan root"
            >
              <RefreshCw className={"h-4 w-4" + (props.isScanning ? " animate-spin" : "")} />
            </button>
          </div>
          <BagTree
            bags={props.bags}
            root={props.root}
            locatedOrder={props.locatedOrder}
            isBagHidden={props.isBagHidden}
            onToggleBagVisibility={props.onToggleBagVisibility}
            onSetGroupHidden={props.onSetGroupHidden}
            onIndex={props.onIndex}
            onRetry={props.onRetry}
            onHoverBag={props.onHoverBag}
            onOpenBag={props.onOpenBag}
          />
        </>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-2">{props.jobsTab}</div>
      )}
    </div>
  );
}
