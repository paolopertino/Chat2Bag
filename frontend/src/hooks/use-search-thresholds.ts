import { useCallback, useEffect, useState } from "react";

const TEXT_KEY = "bag_gpt_threshold_text";
const VISUAL_KEY = "bag_gpt_threshold_visual";
const TEXT_DEFAULT = 0.14;
const VISUAL_DEFAULT = 0.8;

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function load(key: string, fallback: number): number {
  const raw = window.localStorage.getItem(key);
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) ? clamp01(n) : fallback;
}

export interface SearchThresholds {
  text: number;
  visual: number;
  setText: (v: number) => void;
  setVisual: (v: number) => void;
}

export function useSearchThresholds(): SearchThresholds {
  const [text, setTextState] = useState(() => load(TEXT_KEY, TEXT_DEFAULT));
  const [visual, setVisualState] = useState(() => load(VISUAL_KEY, VISUAL_DEFAULT));

  useEffect(() => {
    window.localStorage.setItem(TEXT_KEY, String(text));
  }, [text]);
  useEffect(() => {
    window.localStorage.setItem(VISUAL_KEY, String(visual));
  }, [visual]);

  const setText = useCallback((v: number) => setTextState(clamp01(v)), []);
  const setVisual = useCallback((v: number) => setVisualState(clamp01(v)), []);

  return { text, visual, setText, setVisual };
}
