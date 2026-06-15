import { PanelLeftClose, PanelLeftOpen, RefreshCw } from "lucide-react";
import { useState, type ReactNode } from "react";

import type { BagInfo } from "../../api/types";
import { trackColor } from "./fleet-tracks-layer";

interface MapSidePanelProps {
  bags: BagInfo[];
  locatedOrder: string[]; // bag_paths in the order tracks are drawn (for color match)
  rootDir: string;
  setRootDir: (dir: string) => void;
  isScanning: boolean;
  onScan: () => void;
  onIndex: (bagPath: string) => void;
  onHoverBag: (bagPath: string | null) => void;
  onOpenBag: (bagPath: string) => void;
  jobsTab: ReactNode; // filled in Task 17; pass null until then
}

function statusBadge(bag: BagInfo): string {
  if (bag.status === "indexing") return "⏳ indexing";
  if (!bag.is_indexed) return "not indexed";
  if (!bag.is_located) return "⚠ no GPS";
  return "✓";
}

export function MapSidePanel(props: MapSidePanelProps) {
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<"bags" | "jobs">("bags");

  if (!open) {
    return (
      <button
        className="absolute left-4 top-20 z-10 rounded-md border border-[var(--line)] bg-[var(--surface)] p-2"
        onClick={() => setOpen(true)}
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
        <button onClick={() => setOpen(false)} aria-label="Collapse panel">
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
          <ul className="min-h-0 flex-1 overflow-y-auto p-1">
            {props.bags.map((bag) => {
              const colorIdx = props.locatedOrder.indexOf(bag.bag_path);
              return (
                <li
                  key={bag.bag_path}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-white/5"
                  onMouseEnter={() => props.onHoverBag(bag.bag_path)}
                  onMouseLeave={() => props.onHoverBag(null)}
                  onClick={() => bag.is_indexed && props.onOpenBag(bag.bag_path)}
                >
                  <span
                    className="h-2 w-2 flex-none rounded-full"
                    style={{ background: colorIdx >= 0 ? trackColor(colorIdx) : "#777" }}
                  />
                  <span className="min-w-0 flex-1 truncate">{bag.bag_name}</span>
                  <span className="flex-none text-xs opacity-70">{statusBadge(bag)}</span>
                  {!bag.is_indexed && bag.status !== "indexing" ? (
                    <button
                      className="flex-none rounded border border-[var(--line)] px-1.5 text-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        props.onIndex(bag.bag_path);
                      }}
                    >
                      index
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-2">{props.jobsTab}</div>
      )}
    </div>
  );
}
