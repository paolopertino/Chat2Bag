import { Eraser } from "lucide-react";
import { useEffect, useState } from "react";

import { fetchImageAsObjectUrl } from "../../api/client";
import type { Point } from "../../api/types";
import type { SupportFrame } from "../../lib/region-support";
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
  | { kind: "frame"; frames: SupportFrame[]; selectedFilePath: string };

interface RegionSupportDialogProps {
  open: boolean;
  support: RegionSupport | null;
  initialPoints: Point[];
  onClose: () => void;
  /** Points placed, plus the chosen frame's file path (undefined for uploads). */
  onConfirm: (points: Point[], selectedFilePath?: string) => void;
}

/** Distinguishing label for a camera topic, e.g. ".../lucid_cam_front_center/..." -> "front_center". */
function shortCameraLabel(camera: string): string {
  const segments = camera.split("/").filter(Boolean);
  const camSegment = segments.find((s) => /cam/i.test(s)) ?? segments[segments.length - 1] ?? camera;
  return camSegment.replace(/^.*?cam[_-]?/i, "") || camSegment;
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
  const [selected, setSelected] = useState<string | null>(
    support?.kind === "frame" ? support.selectedFilePath : null,
  );

  // Reset points and the selected camera whenever a new support is opened.
  useEffect(() => {
    setPoints(initialPoints);
    setSelected(support?.kind === "frame" ? support.selectedFilePath : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [support]);

  // Promoted frames need an auth blob URL to display; reload when the camera changes.
  useEffect(() => {
    if (!selected) {
      setFrameUrl(null);
      return;
    }
    let url: string | null = null;
    let cancelled = false;
    fetchImageAsObjectUrl(selected)
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
  }, [selected]);

  const src = support?.kind === "image" ? support.objectUrl : frameUrl;
  const frames = support?.kind === "frame" ? support.frames : [];

  function selectCamera(filePath: string) {
    if (filePath === selected) return;
    setSelected(filePath);
    // Points are pixel coordinates on a specific frame, so they don't carry over.
    setPoints([]);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Place region points</DialogTitle>
          <DialogDescription>
            {frames.length > 1
              ? "Pick the camera, then click its image to mark the region(s) you want to find. Click a point to remove it."
              : "Click the support image to mark the region(s) you want to find. Click a point to remove it."}
          </DialogDescription>
        </DialogHeader>

        {frames.length > 1 ? (
          <div className="flex flex-wrap gap-1">
            {frames.map((frame) => (
              <button
                key={frame.filePath}
                type="button"
                onClick={() => selectCamera(frame.filePath)}
                title={frame.camera}
                className={
                  "rounded-full border px-2.5 py-0.5 text-xs " +
                  (frame.filePath === selected
                    ? "border-sky-400 bg-sky-400/15 text-[var(--ink)]"
                    : "border-[var(--line)] text-[var(--ink-soft)] hover:bg-[var(--surface)]")
                }
              >
                {shortCameraLabel(frame.camera)}
              </button>
            ))}
          </div>
        ) : null}

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
            <Button
              type="button"
              size="sm"
              onClick={() => onConfirm(points, selected ?? undefined)}
            >
              {points.length === 0 ? "Global search" : "Region search"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
