import {
  createContext,
  useContext,
  useEffect,
  useState,
  type DependencyList,
  type ReactNode,
} from "react";

interface SidebarSlotContextValue {
  content: ReactNode | null;
  setContent: (node: ReactNode | null) => void;
}

const SidebarSlotContext = createContext<SidebarSlotContextValue | null>(null);

export function SidebarSlotProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<ReactNode | null>(null);
  return (
    <SidebarSlotContext.Provider value={{ content, setContent }}>
      {children}
    </SidebarSlotContext.Provider>
  );
}

export function useSidebarSlotContent(): ReactNode | null {
  const ctx = useContext(SidebarSlotContext);
  if (!ctx) throw new Error("useSidebarSlotContent must be inside <SidebarSlotProvider>");
  return ctx.content;
}

export function useSidebar(
  render: () => ReactNode,
  deps: DependencyList,
): void {
  const ctx = useContext(SidebarSlotContext);
  if (!ctx) throw new Error("useSidebar must be inside <SidebarSlotProvider>");
  useEffect(() => {
    ctx.setContent(render());
    return () => ctx.setContent(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
