import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { getBagStatus, indexBag, scanBags } from "../api/client";
import type { BagInfo } from "../api/types";

const ROOT_DIR_STORAGE_KEY = "bag_gpt_root_dir";
const HIDDEN_BAGS_STORAGE_KEY = "bag_gpt_hidden_bags";

function loadHiddenBags(): Set<string> {
  try {
    const raw = window.localStorage.getItem(HIDDEN_BAGS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? new Set(parsed.filter((x): x is string => typeof x === "string"))
      : new Set();
  } catch {
    return new Set();
  }
}

export function useBagsState() {
  const [rootDir, setRootDir] = useState(() => window.localStorage.getItem(ROOT_DIR_STORAGE_KEY) ?? "");
  const [bags, setBags] = useState<BagInfo[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [lastScannedRootDir, setLastScannedRootDir] = useState<string | null>(null);
  const [scannedRoot, setScannedRoot] = useState<string | null>(null);
  const [hiddenBagPaths, setHiddenBagPaths] = useState<Set<string>>(loadHiddenBags);

  useEffect(() => {
    window.localStorage.setItem(
      HIDDEN_BAGS_STORAGE_KEY,
      JSON.stringify([...hiddenBagPaths]),
    );
  }, [hiddenBagPaths]);

  const toggleBagVisibility = useCallback((bagPath: string) => {
    setHiddenBagPaths((prev) => {
      const next = new Set(prev);
      if (next.has(bagPath)) next.delete(bagPath);
      else next.add(bagPath);
      return next;
    });
  }, []);

  const setBagsHidden = useCallback((bagPaths: string[], hidden: boolean) => {
    setHiddenBagPaths((prev) => {
      const next = new Set(prev);
      for (const p of bagPaths) {
        if (hidden) next.add(p);
        else next.delete(p);
      }
      return next;
    });
  }, []);

  const isBagHidden = useCallback(
    (bagPath: string) => hiddenBagPaths.has(bagPath),
    [hiddenBagPaths],
  );

  const visibleIndexedBagPaths = useMemo(
    () =>
      bags
        .filter((b) => b.is_indexed && !hiddenBagPaths.has(b.bag_path))
        .map((b) => b.bag_path),
    [bags, hiddenBagPaths],
  );

  const indexingBagPaths = useMemo(
    () => bags.filter((bag) => bag.status === "indexing").map((bag) => bag.bag_path),
    [bags],
  );

  const onScan = useCallback(async () => {
    const trimmedRootDir = rootDir.trim();

    if (!trimmedRootDir) {
      toast.error("Please enter a root directory.");
      return;
    }

    setLastScannedRootDir(null);
    setIsScanning(true);
    try {
      const data = await scanBags(trimmedRootDir);
      setLastScannedRootDir(trimmedRootDir);
      setScannedRoot(data.root_dir);
      setBags(data.bags);
      toast.success(`Found ${data.bags.length} bag(s).`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to scan bags.";
      toast.error(message);
    } finally {
      setIsScanning(false);
    }
  }, [rootDir]);

  const onIndex = useCallback(async (bagPath: string) => {
    try {
      await indexBag(bagPath);
      setBags((prev) =>
        prev.map((bag) => (bag.bag_path === bagPath ? { ...bag, status: "indexing" } : bag)),
      );
      setIsPolling(true);
      toast.success("Indexing started.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to start indexing.";
      toast.error(message);
    }
  }, []);

  const registerBag = useCallback((bag: BagInfo) => {
    setBags((prev) => {
      if (prev.some((b) => b.bag_path === bag.bag_path)) return prev;
      return [...prev, bag];
    });
  }, []);

  const unregisterBag = useCallback((bagPath: string) => {
    setBags((prev) => prev.filter((b) => b.bag_path !== bagPath));
  }, []);

  useEffect(() => {
    if (indexingBagPaths.length === 0) {
      setIsPolling(false);
      return;
    }

    setIsPolling(true);
    const interval = window.setInterval(async () => {
      try {
        const statuses = await Promise.all(indexingBagPaths.map((bagPath) => getBagStatus(bagPath)));
        setBags((prev) =>
          prev.map((bag) => {
            const next = statuses.find((status) => status.bag_path === bag.bag_path);
            if (!next) {
              return bag;
            }
            return {
              ...bag,
              status: next.status,
              is_indexed: next.status === "done" || bag.is_indexed,
              error_message: next.error_message ?? null,
            };
          }),
        );
      } catch {
        // Keep polling; temporary API failures should not break the UI.
      }
    }, 2000);

    return () => window.clearInterval(interval);
  }, [indexingBagPaths]);

  useEffect(() => {
    window.localStorage.setItem(ROOT_DIR_STORAGE_KEY, rootDir);
  }, [rootDir]);

  // Auto-scan on mount when rootDir is already persisted from a previous session.
  const autoScannedRef = useRef(false);
  useEffect(() => {
    if (autoScannedRef.current || !rootDir.trim()) return;
    autoScannedRef.current = true;
    void onScan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    rootDir,
    setRootDir,
    scannedRoot,
    bags,
    isScanning,
    isPolling,
    lastScannedRootDir,
    onScan,
    onIndex,
    registerBag,
    unregisterBag,
    hiddenBagPaths,
    toggleBagVisibility,
    setBagsHidden,
    isBagHidden,
    visibleIndexedBagPaths,
  };
}
