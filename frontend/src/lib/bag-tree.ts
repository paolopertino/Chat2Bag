import type { BagInfo } from "../api/types";

export interface BagTreeLeaf {
  kind: "bag";
  bag: BagInfo;
}

export interface BagTreeGroup {
  kind: "group";
  /** Folder segment name shown in the UI. */
  name: string;
  /** Root-relative path of the group; stable key + collapse id. */
  path: string;
  children: BagTreeNode[];
  /** Every descendant bag_path (for group-level visibility toggles). */
  bagPaths: string[];
}

export type BagTreeNode = BagTreeGroup | BagTreeLeaf;

function stripTrailingSlash(p: string): string {
  return p.replace(/\/+$/, "");
}

/** Path of `bagPath` relative to `root`, or just the leaf name when `root`
 * is null or is not a prefix (defensive fallback → flat list). */
function relativeToRoot(bagPath: string, root: string | null): string {
  const bp = stripTrailingSlash(bagPath);
  if (root) {
    const r = stripTrailingSlash(root);
    if (bp === r) return bp.split("/").pop() ?? bp;
    if (bp.startsWith(r + "/")) return bp.slice(r.length + 1);
  }
  return bp.split("/").pop() ?? bp;
}

/**
 * Build a nested tree mirroring the on-disk layout. Intermediate folder
 * segments become collapsible groups; the final segment is a bag leaf.
 * `bags` is assumed pre-sorted by path (the scan endpoint sorts it).
 */
export function buildBagTree(bags: BagInfo[], root: string | null): BagTreeNode[] {
  const rootNodes: BagTreeNode[] = [];
  const groupByPath = new Map<string, BagTreeGroup>();

  for (const bag of bags) {
    const rel = relativeToRoot(bag.bag_path, root);
    const segments = rel.split("/").filter(Boolean);
    const groupSegs = segments.slice(0, -1);

    if (groupSegs.length === 0) {
      rootNodes.push({ kind: "bag", bag });
      continue;
    }

    let siblings = rootNodes;
    let accPath = "";
    for (const seg of groupSegs) {
      accPath = accPath ? `${accPath}/${seg}` : seg;
      let group = groupByPath.get(accPath);
      if (!group) {
        group = { kind: "group", name: seg, path: accPath, children: [], bagPaths: [] };
        groupByPath.set(accPath, group);
        siblings.push(group);
      }
      group.bagPaths.push(bag.bag_path);
      siblings = group.children;
    }
    siblings.push({ kind: "bag", bag });
  }

  return rootNodes;
}
