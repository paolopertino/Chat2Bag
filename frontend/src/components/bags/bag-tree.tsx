import { ChevronDown, ChevronRight, LoaderCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import type { BagInfo, BagStatus } from "../../api/types";
import { encodeBagId } from "../../lib/bag-id";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

interface BagTreeProps {
  bags: BagInfo[];
  selectedBagPath?: string | null;
  onIndex?: (bagPath: string) => void;
  /** Compact mode (smaller text, tighter spacing) — used in detail-page sidebar. */
  compact?: boolean;
}

interface FolderNode {
  kind: "folder";
  /** Path segment displayed at this node (may include slashes after collapsing). */
  label: string;
  /** Absolute path up to and including this folder. Used as a stable key. */
  fullPath: string;
  children: TreeNode[];
}

interface LeafNode {
  kind: "leaf";
  bag: BagInfo;
}

type TreeNode = FolderNode | LeafNode;

function buildTree(bags: BagInfo[]): TreeNode[] {
  // Build a virtual root, then return its children.
  const root: FolderNode = { kind: "folder", label: "", fullPath: "", children: [] };

  for (const bag of bags) {
    // Split path; drop empty leading segment if path starts with '/'.
    const parts = bag.bag_path.split("/").filter(Boolean);
    if (parts.length === 0) continue;

    let current = root;
    // All segments except the last are folders; the last segment is the bag leaf.
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      const childPath = current.fullPath ? `${current.fullPath}/${seg}` : `/${seg}`;
      let next = current.children.find(
        (c): c is FolderNode => c.kind === "folder" && c.label === seg,
      );
      if (!next) {
        next = { kind: "folder", label: seg, fullPath: childPath, children: [] };
        current.children.push(next);
      }
      current = next;
    }
    current.children.push({ kind: "leaf", bag });
  }

  collapseSingleChildChains(root);
  return root.children;
}

/**
 * Merge folders that have exactly one child folder (and no leaf children) with
 * that child. E.g. /data → project-x → day1 → bag_001 collapses to
 * /data/project-x/day1 → bag_001 when each intermediate folder has only one
 * child folder. Folders with multiple children OR with any leaf children are
 * preserved as-is.
 */
function collapseSingleChildChains(node: FolderNode): void {
  for (const child of node.children) {
    if (child.kind === "folder") collapseSingleChildChains(child);
  }
  // Now collapse this node's folder children if they're single-folder chains.
  node.children = node.children.map((child) => {
    if (child.kind !== "folder") return child;
    let cur: FolderNode = child;
    while (
      cur.children.length === 1 &&
      cur.children[0].kind === "folder"
    ) {
      const only = cur.children[0] as FolderNode;
      cur = {
        kind: "folder",
        label: `${cur.label}/${only.label}`,
        fullPath: only.fullPath,
        children: only.children,
      };
    }
    return cur;
  });
}

function statusVariant(status: BagStatus): "idle" | "indexing" | "done" | "error" {
  return status;
}

interface RenderArgs {
  selectedBagPath?: string | null;
  onIndex?: (bagPath: string) => void;
  compact?: boolean;
  /** Folders containing the selected leaf — used to default-expand them in compact mode. */
  selectedAncestors: Set<string>;
}

function FolderRow({
  node,
  depth,
  defaultOpen,
  args,
}: {
  node: FolderNode;
  depth: number;
  defaultOpen: boolean;
  args: RenderArgs;
}) {
  const [userOpen, setUserOpen] = useState(defaultOpen);
  // Keep folder open if a descendant is selected.
  const open = userOpen || args.selectedAncestors.has(node.fullPath);

  const Chevron = open ? ChevronDown : ChevronRight;
  const textClass = args.compact ? "text-xs" : "text-sm";
  const indent = depth * (args.compact ? 12 : 16);

  return (
    <li>
      <button
        type="button"
        onClick={() => setUserOpen((v) => !v)}
        className={`flex w-full items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-[var(--surface)] ${textClass} text-[var(--ink-soft)]`}
        style={{ paddingLeft: indent }}
      >
        <Chevron className="h-3 w-3 shrink-0" />
        <span className="truncate font-medium">{node.label}</span>
      </button>
      {open && node.children.length > 0 ? (
        <ul className="space-y-0.5">
          {node.children.map((child) => (
            <NodeRow
              key={child.kind === "folder" ? child.fullPath : child.bag.bag_path}
              node={child}
              depth={depth + 1}
              args={args}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function BagRow({
  bag,
  depth,
  args,
}: {
  bag: BagInfo;
  depth: number;
  args: RenderArgs;
}) {
  const isSelected = args.selectedBagPath === bag.bag_path;
  const isIndexing = bag.status === "indexing";
  const id = encodeBagId(bag.bag_path);
  const textClass = args.compact ? "text-xs" : "text-sm";
  const indent = depth * (args.compact ? 12 : 16) + 16;

  return (
    <li>
      <div
        className={`group flex items-center justify-between gap-2 rounded px-1 py-0.5 ${
          isSelected ? "bg-[var(--surface)]" : "hover:bg-[var(--surface)]"
        }`}
        style={{ paddingLeft: indent }}
      >
        <Link
          to={`/bags/${id}`}
          className={`flex min-w-0 flex-1 items-center gap-2 ${textClass} ${
            isSelected ? "font-semibold text-[var(--ink)]" : "text-[var(--ink)]"
          }`}
          title={bag.bag_path}
        >
          <span className="truncate">{bag.bag_name}</span>
          <Badge variant={statusVariant(bag.status)} className="shrink-0 text-[10px]">
            {bag.status}
          </Badge>
        </Link>
        {args.onIndex ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={isIndexing}
            onClick={(e) => {
              e.preventDefault();
              args.onIndex?.(bag.bag_path);
            }}
            className="h-6 px-2 text-[10px] opacity-0 group-hover:opacity-100"
          >
            {isIndexing ? (
              <LoaderCircle className="h-3 w-3 animate-spin" />
            ) : bag.is_indexed ? (
              "Re-index"
            ) : (
              "Index"
            )}
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function NodeRow({
  node,
  depth,
  args,
}: {
  node: TreeNode;
  depth: number;
  args: RenderArgs;
}) {
  if (node.kind === "leaf") return <BagRow bag={node.bag} depth={depth} args={args} />;
  // On the detail page (compact), only expand by default if this folder is on
  // the selected path. On the list page, expand everything.
  const onSelectedPath = args.selectedAncestors.has(node.fullPath);
  const defaultOpen = args.compact ? onSelectedPath : true;
  return <FolderRow node={node} depth={depth} defaultOpen={defaultOpen} args={args} />;
}

export function BagTree({ bags, selectedBagPath, onIndex, compact }: BagTreeProps) {
  const tree = useMemo(() => buildTree(bags), [bags]);

  const selectedAncestors = useMemo(() => {
    if (!selectedBagPath) return new Set<string>();
    // Build set of all ancestor folder fullPaths for the selected bag.
    const ancestors = new Set<string>();
    const visit = (nodes: TreeNode[], trail: string[]): boolean => {
      for (const n of nodes) {
        if (n.kind === "leaf") {
          if (n.bag.bag_path === selectedBagPath) {
            for (const t of trail) ancestors.add(t);
            return true;
          }
        } else if (visit(n.children, [...trail, n.fullPath])) {
          return true;
        }
      }
      return false;
    };
    visit(tree, []);
    return ancestors;
  }, [tree, selectedBagPath]);

  if (bags.length === 0) {
    return (
      <div
        className={`rounded-md border border-dashed border-[var(--line)] p-3 ${
          compact ? "text-[11px]" : "text-sm"
        } text-[var(--ink-soft)]`}
      >
        Scan a root directory to list bags.
      </div>
    );
  }

  return (
    <ul className="space-y-0.5">
      {tree.map((node) => (
        <NodeRow
          key={node.kind === "folder" ? node.fullPath : node.bag.bag_path}
          node={node}
          depth={0}
          args={{ selectedBagPath, onIndex, compact, selectedAncestors }}
        />
      ))}
    </ul>
  );
}
