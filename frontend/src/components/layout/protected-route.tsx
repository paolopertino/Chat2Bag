import { LoaderCircle } from "lucide-react";
import { Navigate, Outlet, useLocation } from "react-router-dom";

import { useAuth } from "../../context/auth-context";
import { BagsProvider } from "../../context/bags-context";
import { JobsProvider } from "../../context/jobs-context";

export function ProtectedRoute() {
  const { accessToken, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoaderCircle className="h-6 w-6 animate-spin text-[var(--ink-soft)]" />
      </div>
    );
  }

  if (!accessToken) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return (
    <BagsProvider>
      <JobsProvider>
        <Outlet />
      </JobsProvider>
    </BagsProvider>
  );
}
