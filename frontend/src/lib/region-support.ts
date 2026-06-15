import type { SampleInfo } from "../api/types";

/** One camera's frame, offered as a candidate region-support image. */
export interface SupportFrame {
  camera: string;
  filePath: string;
}

/**
 * Build the per-camera candidate frames for a sample, plus the frame that
 * should be selected by default: the focus frame, else the anchor camera,
 * else the first camera.
 */
export function framesFromSample(
  cameras: string[],
  sample: SampleInfo,
): { frames: SupportFrame[]; defaultSelected: string } {
  const frames: SupportFrame[] = [];
  for (const camera of cameras) {
    const frame = sample.frames_by_camera[camera];
    if (frame) frames.push({ camera, filePath: frame.file_path });
  }
  const focus = Object.values(sample.frames_by_camera).find((f) => f.is_focus)?.file_path;
  const defaultSelected = focus ?? sample.anchor_frame?.file_path ?? frames[0]?.filePath ?? "";
  return { frames, defaultSelected };
}
