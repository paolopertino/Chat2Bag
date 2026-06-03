import { Folder, LoaderCircle, Pencil, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";

interface BagRootChipProps {
  rootDir: string;
  onRootDirChange: (value: string) => void;
  onScan: () => void;
  isScanning?: boolean;
}

/**
 * Collapsed-but-expandable representation of the root-dir input.
 * Default: shows the current root dir (truncated) with a pencil to edit.
 * Edit mode: inline input + Scan/Cancel buttons. Enter triggers Scan.
 */
export function BagRootChip({
  rootDir,
  onRootDirChange,
  onScan,
  isScanning,
}: BagRootChipProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(rootDir);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep draft in sync if rootDir is updated externally while we're not editing.
  useEffect(() => {
    if (!editing) setDraft(rootDir);
  }, [rootDir, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (trimmed !== rootDir) onRootDirChange(trimmed);
    setEditing(false);
    onScan();
  };

  const cancel = () => {
    setDraft(rootDir);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1 rounded-md border border-[var(--line)] bg-[var(--surface)] p-1">
        <Input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            else if (e.key === "Escape") cancel();
          }}
          placeholder="/path/to/bags"
          className="h-7 text-xs"
        />
        <Button
          size="sm"
          onClick={commit}
          disabled={isScanning || !draft.trim()}
          className="h-7"
        >
          {isScanning ? <LoaderCircle className="h-3 w-3 animate-spin" /> : "Scan"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={cancel}
          className="h-7 w-7 p-0"
          aria-label="Cancel"
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--surface)] p-1.5"
      title={rootDir || "No root directory set"}
    >
      <Folder className="h-3.5 w-3.5 shrink-0 text-[var(--ink-soft)]" />
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--ink-soft)]">
        {rootDir || "No root directory"}
      </span>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setEditing(true)}
        className="h-6 w-6 p-0"
        aria-label="Change root directory"
      >
        <Pencil className="h-3 w-3" />
      </Button>
    </div>
  );
}
