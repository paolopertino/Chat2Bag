// RECOVERY STUB — original was not captured in session logs.
// Renders a compact root-dir input + scan button used in the sidebar of /bags/:bagId.
import { LoaderCircle } from "lucide-react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";

interface BagRootChipProps {
  rootDir: string;
  onRootDirChange: (value: string) => void;
  onScan: () => void;
  isScanning?: boolean;
}

export function BagRootChip({ rootDir, onRootDirChange, onScan, isScanning }: BagRootChipProps) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--surface)] p-2">
      <Input
        value={rootDir}
        onChange={(e) => onRootDirChange(e.target.value)}
        placeholder="Root dir"
        className="h-8 text-xs"
      />
      <Button size="sm" onClick={onScan} disabled={isScanning || !rootDir.trim()}>
        {isScanning ? <LoaderCircle className="h-3 w-3 animate-spin" /> : "Scan"}
      </Button>
    </div>
  );
}
