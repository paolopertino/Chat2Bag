import { Outlet } from "react-router-dom";

import { TopBar } from "./top-bar";

export function FullBleedLayout() {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[var(--canvas)] text-[var(--ink)]">
      <TopBar />
      <main className="relative min-h-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}
