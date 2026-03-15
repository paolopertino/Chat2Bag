import { Search } from "lucide-react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";

interface BagScannerProps {
  rootDir: string;
  onRootDirChange: (value: string) => void;
  onScan: () => void;
  isScanning: boolean;
}

export function BagScanner({
  rootDir,
  onRootDirChange,
  onScan,
  isScanning,
}: BagScannerProps) {
  return (
    <div className="space-y-3">
      <label htmlFor="root-dir" className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--ink-soft)]">
        Bag Root Directory
      </label>
      <div className="flex gap-2">
        <Input
          id="root-dir"
          value={rootDir}
          onChange={(event) => onRootDirChange(event.target.value)}
          placeholder="/home/user/bags"
        />
        <Button onClick={onScan} disabled={isScanning} className="min-w-24">
          <Search className="mr-2 h-4 w-4" />
          {isScanning ? "Scanning" : "Scan"}
        </Button>
      </div>
    </div>
  );
}
