import { LoaderCircle, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";

import { BagTree } from "../../components/bags/bag-tree";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import type { BagsOutletContext } from "./bags-layout";

export function BagsListPage() {
  const {
    rootDir,
    setRootDir,
    bags,
    isScanning,
    lastScannedRootDir,
    onScan,
    onIndex,
  } = useOutletContext<BagsOutletContext>();

  const [draft, setDraft] = useState(rootDir);

  // Sync draft when rootDir is updated externally (e.g., localStorage prefill).
  useEffect(() => setDraft(rootDir), [rootDir]);

  const submit = () => {
    const trimmed = draft.trim();
    if (!trimmed || isScanning) return;
    if (trimmed !== rootDir) setRootDir(trimmed);
    onScan();
  };

  const isHero = bags.length === 0;
  // Distinguish "haven't scanned yet" from "scanned, got nothing back".
  const scannedEmpty = isHero && lastScannedRootDir !== null && !isScanning;

  return (
    <div className="flex h-full flex-col">
      {isHero ? <HeroState /> : null}
      <div
        className={
          isHero
            ? "mx-auto flex w-full max-w-2xl flex-col gap-3 px-6 pb-6"
            : "border-b border-[var(--line)] bg-[var(--surface)] px-6 py-3"
        }
      >
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 shrink-0 text-[var(--ink-soft)]" />
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            placeholder="/path/to/bags"
            className={isHero ? "h-11 text-base" : "h-9 text-sm"}
            autoFocus={isHero}
          />
          <Button onClick={submit} disabled={isScanning || !draft.trim()}>
            {isScanning ? <LoaderCircle className="h-4 w-4 animate-spin" /> : "Scan"}
          </Button>
        </div>
        {scannedEmpty ? (
          <p className="text-sm text-[var(--ink-soft)]">
            No bags found in this directory.
          </p>
        ) : null}
      </div>

      {!isHero ? (
        <div className="flex-1 overflow-auto px-6 py-4">
          <BagTree bags={bags} onIndex={onIndex} />
        </div>
      ) : null}
    </div>
  );
}

function HeroState() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-end gap-2 px-6 pb-6 pt-24">
      <h1 className="text-3xl font-semibold text-[var(--ink)]">Bag Explorer</h1>
      <p className="text-sm text-[var(--ink-soft)]">
        Enter a root directory to scan for ROS2 bags.
      </p>
    </div>
  );
}
