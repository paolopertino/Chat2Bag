import { AlertTriangle, ChevronDown, ChevronRight, Eye, EyeOff } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import type { BagInfo } from "../../api/types";
import { buildBagTree, type BagTreeNode } from "../../lib/bag-tree";
import { trackColor } from "./fleet-tracks-layer";

interface BagTreeProps {
  bags: BagInfo[];
  root: string | null;
  /** bag_paths in track-draw order, for matching the color dot. */
  locatedOrder: string[];
  isBagHidden: (bagPath: string) => boolean;
  onToggleBagVisibility: (bagPath: string) => void;
  onSetGroupHidden: (bagPaths: string[], hidden: boolean) => void;
  onIndex: (bagPath: string) => void;
  onRetry: (bagPath: string) => void;
  onHoverBag: (bagPath: string | null) => void;
  onOpenBag: (bagPath: string) => void;
}

function statusBadge(bag: BagInfo): string {
  if (bag.status === "indexing") return "⏳ indexing";
  if (bag.status === "error") return "⚠ failed";
  if (!bag.is_indexed) return "not indexed";
  if (!bag.is_located) return "⚠ no GPS";
  return "✓";
}

export function BagTree(props: BagTreeProps) {
  const tree = useMemo(() => buildBagTree(props.bags, props.root), [props.bags, props.root]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggleCollapse = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const renderNode = (node: BagTreeNode, depth: number): ReactNode => {
    const pad = { paddingLeft: `${depth * 12 + 8}px` };

    if (node.kind === "group") {
      const isOpen = !collapsed.has(node.path);
      const allHidden = node.bagPaths.every((p) => props.isBagHidden(p));
      return (
        <li key={`g:${node.path}`}>
          <div
            className="flex items-center gap-1.5 rounded px-2 py-1 text-sm hover:bg-white/5"
            style={pad}
          >
            <button
              onClick={() => toggleCollapse(node.path)}
              aria-label={isOpen ? "Collapse group" : "Expand group"}
              className="flex-none"
            >
              {isOpen ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
            </button>
            <span className="min-w-0 flex-1 truncate font-medium">{node.name}</span>
            <span className="flex-none text-xs opacity-50">({node.bagPaths.length})</span>
            <button
              onClick={() => props.onSetGroupHidden(node.bagPaths, !allHidden)}
              aria-label={allHidden ? "Show all in group" : "Hide all in group"}
              title={allHidden ? "Show all in group" : "Hide all in group"}
              className="flex-none opacity-70 hover:opacity-100"
            >
              {allHidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
          {isOpen ? (
            <ul>{node.children.map((child) => renderNode(child, depth + 1))}</ul>
          ) : null}
        </li>
      );
    }

    const bag = node.bag;
    const colorIdx = props.locatedOrder.indexOf(bag.bag_path);
    const hidden = props.isBagHidden(bag.bag_path);
    return (
      <li key={`b:${bag.bag_path}`}>
        <div
          className={
            "flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-white/5 " +
            (hidden ? "opacity-40" : "")
          }
          style={pad}
          onMouseEnter={() => props.onHoverBag(bag.bag_path)}
          onMouseLeave={() => props.onHoverBag(null)}
        >
          <span
            className="h-2 w-2 flex-none rounded-full"
            style={{ background: colorIdx >= 0 ? trackColor(colorIdx) : "#777" }}
          />
          <button
            className="min-w-0 flex-1 truncate text-left"
            onClick={() => bag.is_indexed && props.onOpenBag(bag.bag_path)}
            disabled={!bag.is_indexed}
            title={bag.is_indexed ? "Open in bag viewer" : undefined}
          >
            {bag.bag_name}
          </button>

          {bag.status === "error" ? (
            <span
              className="flex flex-none items-center gap-1 text-xs text-red-400"
              title={bag.error_message ?? "Indexing failed"}
            >
              <AlertTriangle className="h-3 w-3" /> failed
            </span>
          ) : (
            <span className="flex-none text-xs opacity-70">{statusBadge(bag)}</span>
          )}

          {bag.status === "error" ? (
            <button
              className="flex-none rounded border border-[var(--line)] px-1.5 text-xs"
              onClick={() => props.onRetry(bag.bag_path)}
              title="Reset and re-index"
            >
              retry
            </button>
          ) : !bag.is_indexed && bag.status !== "indexing" ? (
            <button
              className="flex-none rounded border border-[var(--line)] px-1.5 text-xs"
              onClick={() => props.onIndex(bag.bag_path)}
            >
              index
            </button>
          ) : null}

          <button
            onClick={() => props.onToggleBagVisibility(bag.bag_path)}
            aria-label={hidden ? "Show bag" : "Hide bag"}
            title={hidden ? "Show on map & include in search" : "Hide from map & search"}
            className="flex-none opacity-70 hover:opacity-100"
          >
            {hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        </div>
      </li>
    );
  };

  if (props.bags.length === 0) {
    return (
      <p className="p-3 text-center text-xs opacity-60">
        No bags. Set a root directory and scan.
      </p>
    );
  }

  return <ul className="min-h-0 flex-1 overflow-y-auto p-1">{tree.map((n) => renderNode(n, 0))}</ul>;
}
