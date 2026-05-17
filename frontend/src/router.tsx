import { createBrowserRouter, Navigate } from "react-router-dom";

import { MainLayout } from "./components/layout/main-layout";
import { ProtectedRoute } from "./components/layout/protected-route";
import { DashboardPage } from "./pages/dashboard";
import { LoginPage } from "./pages/login";
import { SearchPage } from "./pages/search";
import { WorkspacePage } from "./pages/workspace";

function ComingSoon({ title }: { title: string }) {
  return (
    <div className="rounded-md border border-dashed border-[var(--border)] bg-[var(--surface)] p-10 text-center">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-[var(--ink-soft)]">
        This section isn't available yet.
      </p>
    </div>
  );
}

export const router = createBrowserRouter([
  {
    path: "/login",
    element: <LoginPage />,
  },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <MainLayout />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: "workspace", element: <WorkspacePage /> },
          { path: "search", element: <SearchPage /> },
          { path: "bags/*", element: <ComingSoon title="Bag Explorer" /> },
          { path: "datasets/*", element: <ComingSoon title="Datasets" /> },
          { path: "*", element: <Navigate to="/" replace /> },
        ],
      },
    ],
  },
]);
