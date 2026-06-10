// Compatibility shim for react-grid-layout's CJS `export =` module.
// verbatimModuleSyntax + no esModuleInterop means we can't use
// `import X from "react-grid-layout"` directly when the module uses
// `export = Foo`. This shim re-exports only what we need with proper
// TypeScript types, letting Vite handle the CJS interop at bundle time.

import type { ComponentType } from "react";

// At runtime Vite resolves the CJS default export correctly.
// We declare the shapes we need inline.
export interface RglLayout {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
  static?: boolean;
  isDraggable?: boolean;
  isResizable?: boolean;
}

export interface RglGridProps {
  layout?: RglLayout[];
  cols?: number;
  rowHeight?: number;
  margin?: [number, number];
  compactType?: "vertical" | "horizontal" | null;
  preventCollision?: boolean;
  allowOverlap?: boolean;
  isDraggable?: boolean;
  isResizable?: boolean;
  onLayoutChange?: (next: RglLayout[]) => void;
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  width?: number;
}

// Vite bundles this as an ESM default import from the CJS module.
// The `as unknown as` cast sidesteps the TS `export =` restriction.
import _rgl from "react-grid-layout";
const _rglAny = _rgl as unknown as {
  (props: RglGridProps): React.ReactElement;
  WidthProvider: <P extends object>(C: ComponentType<P>) => ComponentType<P & { measureBeforeMount?: boolean }>;
};

export const ReactGridLayout: ComponentType<RglGridProps> = _rglAny as unknown as ComponentType<RglGridProps>;
export const WidthProvider = _rglAny.WidthProvider;
