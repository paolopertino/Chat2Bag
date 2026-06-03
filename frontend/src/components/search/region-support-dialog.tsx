import { Eraser } from "lucide-react";
import { useEffect, useState } from "react";

import { fetchImageAsObjectUrl } from "../../api/client";
import type { Point } from "../../api/types";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { RegionPointCanvas } from "./region-point-canvas";

export type RegionSupport =
  | { kind: "image"; file: File; objectUrl: string }
  | { kind: "frame"; filePath: string };

interface RegionSupportDialogProps {
  open: boolean;
  support: RegionSupport | null;
  initialPoints: Point[];
  onClose: () => void;
  onConfirm: (points: Point[]) => void;
}

export function RegionSupportDialog({
  open,
  support,
  initialPoints,
  onClose,
  onConfirm,
}: RegionSupportDialogProps) {
  const [points, setPoints] = useState<Point[]>(initialPoints);
  const [frameUrl, setFrameUrl] = useState<string | null>(null);

  // Reset points whenever a new support is opened.
  useEffect(() => {
    setPoints(initialPoints);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [support]);

  // Promoted frames need an auth blob URL to display.
  useEffect(() => {
    if (support?.kind !== "frame") {
      setFrameUrl(null);
      return;
    }
    let url: string | null = null;
    let cancelled = false;
    fetchImageAsObjectUrl(support.filePath)
      .then((fetched) => {
        if (cancelled) {
          URL.revokeObjectURL(fetched);
          return;
        }
        url = fetched;
        setFrameUrl(fetched);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [support]);

  const src = support?.kind === "image" ? support.objectUrl : frameUrl;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Place region points</DialogTitle>
          <DialogDescription>
            Click the support image to mark the region(s) you want to find. Click a point to remove it.
          </DialogDescription>
        </DialogHeader>

        <div className="flex justify-center">
          {src ? (
            <RegionPointCanvas src={src} alt="Region support" points={points} onChange={setPoints} />
          ) : (
            <div className="flex h-48 w-full items-center justify-center text-sm text-[var(--ink-soft)]">
              Loading support image…
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-[var(--ink-soft)]">
            {points.length} point{points.length === 1 ? "" : "s"} placed
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setPoints([])}
              disabled={points.length === 0}
            >
              <Eraser className="mr-1.5 h-3.5 w-3.5" /> Clear
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={() => onConfirm(points)} disabled={points.length === 0}>
              Done
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
