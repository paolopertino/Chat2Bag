import { X } from "lucide-react";
import { useRef, type MouseEvent } from "react";

import type { Point } from "../../api/types";

interface RegionPointCanvasProps {
  src: string;
  alt: string;
  points: Point[];
  onChange: (points: Point[]) => void;
}

export function RegionPointCanvas({ src, alt, points, onChange }: RegionPointCanvasProps) {
  const imgRef = useRef<HTMLImageElement | null>(null);

  const handleClick = (e: MouseEvent<HTMLImageElement>) => {
    const img = imgRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    onChange([...points, { x, y }]);
  };

  const removePoint = (index: number) => {
    onChange(points.filter((_, i) => i !== index));
  };

  return (
    <div className="relative inline-block select-none">
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        onClick={handleClick}
        draggable={false}
        className="block max-h-[60vh] max-w-full cursor-crosshair rounded-md"
      />
      {points.map((p, i) => (
        <button
          key={`${p.x.toFixed(4)}-${p.y.toFixed(4)}-${i}`}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            removePoint(i);
          }}
          title="Remove point"
          aria-label={`Remove point ${i + 1}`}
          className="absolute flex h-4 w-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-[var(--teal)] text-white shadow"
          style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
        >
          <X className="h-2.5 w-2.5" />
        </button>
      ))}
    </div>
  );
}
