import { createContext, useContext } from "react";
import type { ReactNode } from "react";

import { useBagsState } from "../hooks/use-bags";

type BagsState = ReturnType<typeof useBagsState>;

const BagsContext = createContext<BagsState | null>(null);

export function BagsProvider({ children }: { children: ReactNode }) {
  const value = useBagsState();
  return <BagsContext.Provider value={value}>{children}</BagsContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useBags(): BagsState {
  const ctx = useContext(BagsContext);
  if (ctx === null) {
    throw new Error("useBags must be used inside <BagsProvider>");
  }
  return ctx;
}
