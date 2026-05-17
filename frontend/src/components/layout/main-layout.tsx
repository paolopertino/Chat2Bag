import { Outlet } from "react-router-dom";

import { SidebarSlotProvider, useSidebarSlotContent } from "./sidebar-slot";
import { TopBar } from "./top-bar";

function LayoutBody() {
  const sidebar = useSidebarSlotContent();
  const hasSidebar = sidebar !== null;

  return (
    <div
      className={
        "grid min-h-[calc(100vh-theme(spacing.14))] w-full gap-6 px-6 py-6 " +
        (hasSidebar ? "lg:grid-cols-[320px_1fr]" : "lg:grid-cols-1")
      }
    >
      {hasSidebar ? (
        <aside className="self-start lg:sticky lg:top-6">{sidebar}</aside>
      ) : null}
      <main className="min-w-0">
        <Outlet />
      </main>
    </div>
  );
}

export function MainLayout() {
  return (
    <SidebarSlotProvider>
      <div className="min-h-screen bg-[var(--canvas)] text-[var(--ink)]">
        <TopBar />
        <LayoutBody />
      </div>
    </SidebarSlotProvider>
  );
}

