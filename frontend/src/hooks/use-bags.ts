import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { getBagStatus, indexBag, scanBags } from "../api/client";
import type { BagInfo } from "../api/types";

const ROOT_DIR_STORAGE_KEY = "bag_gpt_root_dir";

export function useBags() {
  const [rootDir, setRootDir] = useState(() => window.localStorage.getItem(ROOT_DIR_STORAGE_KEY) ?? "");
  const [bags, setBags] = useState<BagInfo[]>([]);
  const [selectedBagPaths, setSelectedBagPaths] = useState<string[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [isPolling, setIsPolling] = useState(false);

  const indexingBagPaths = useMemo(
    () => bags.filter((bag) => bag.status === "indexing").map((bag) => bag.bag_path),
    [bags],
  );

  const onScan = useCallback(async () => {
    if (!rootDir.trim()) {
      toast.error("Please enter a root directory.");
      return;
    }

    setIsScanning(true);
    try {
      const data = await scanBags(rootDir.trim());
      setBags(data.bags);
      setSelectedBagPaths((prev) =>
        prev.filter((bagPath) => data.bags.some((bag) => bag.bag_path === bagPath)),
      );
      toast.success(`Found ${data.bags.length} bag(s).`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to scan bags.";
      toast.error(message);
    } finally {
      setIsScanning(false);
    }
  }, [rootDir]);

  const toggleBagSelection = useCallback((bagPath: string) => {
    setSelectedBagPaths((prev) => {
      if (prev.includes(bagPath)) {
        return prev.filter((item) => item !== bagPath);
      }
      return [...prev, bagPath];
    });
  }, []);

  const toggleAllBags = useCallback(() => {
    setSelectedBagPaths((prev) => {
      if (prev.length === bags.length) {
        return [];
      }
      return bags.map((bag) => bag.bag_path);
    });
  }, [bags]);

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

  return {
    rootDir,
    setRootDir,
    bags,
    selectedBagPaths,
    isScanning,
    isPolling,
    onScan,
    onIndex,
    toggleBagSelection,
    toggleAllBags,
  };
}
