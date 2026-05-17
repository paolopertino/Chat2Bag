// RECOVERY STUB — original was not captured in session logs.
// Original spec: hero-state centered root-dir input when bags.length === 0;
// promotes to a top strip once a scan returns bags; main area shows a folder tree
// that collapses single-child chains.
//
// This stub gives a minimal working page so the route resolves. Reimplement
// per spec at docs/superpowers/specs/2026-04-24-bag-explorer-design.md.
import { useOutletContext } from "react-router-dom";

import { BagRootChip } from "../../components/bags/bag-root-chip";
import { BagTree } from "../../components/bags/bag-tree";
import type { BagsOutletContext } from "./bags-layout";

export function BagsListPage() {
  const { rootDir, setRootDir, bags, isScanning, onScan, onIndex } =
    useOutletContext<BagsOutletContext>();

  const isEmpty = bags.length === 0;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      {isEmpty ? (
        <div className="flex flex-col items-center gap-3 py-16">
          <h1 className="text-2xl font-semibold">Bag Explorer</h1>
          <p className="text-sm text-[var(--ink-soft)]">
            Enter a root directory to scan for ROS2 bags.
          </p>
          <div className="w-full max-w-md">
            <BagRootChip
              rootDir={rootDir}
              onRootDirChange={setRootDir}
              onScan={onScan}
              isScanning={isScanning}
            />
          </div>
        </div>
      ) : (
        <>
          <BagRootChip
            rootDir={rootDir}
            onRootDirChange={setRootDir}
            onScan={onScan}
            isScanning={isScanning}
          />
          <BagTree bags={bags} onIndex={onIndex} />
        </>
      )}
    </div>
  );
}
