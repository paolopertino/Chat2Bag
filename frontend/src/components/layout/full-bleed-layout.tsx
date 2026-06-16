import { Outlet } from "react-router-dom";

import { UtilityChip } from "./utility-chip";

export function FullBleedLayout() {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[var(--canvas)] text-[var(--ink)]">
      <main className="relative min-h-0 flex-1">
        <Outlet />
      </main>
      <UtilityChip />
    </div>
  );
}
