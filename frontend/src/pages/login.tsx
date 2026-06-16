import { useState, type FormEvent } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { toast } from "sonner";

import { useAuth } from "../context/auth-context";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { MapLibreMap } from "../components/map/maplibre-map";
import { LoginSatellite } from "./login-satellite";

export function LoginPage() {
  const { login, accessToken, isLoading } = useAuth();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isLoading) return null; // top-level spinner is shown by ProtectedRoute / App
  if (accessToken) {
    const from = (location.state as { from?: string } | null)?.from ?? "/";
    return <Navigate to={from} replace />;
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(username, password);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Login failed";
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 overflow-hidden bg-[var(--canvas)] text-[var(--ink)]">
      {/* Blurred live satellite backdrop. scale-110 hides the transparent
          fringe that CSS blur leaves at the element edges. */}
      <div
        className="pointer-events-none absolute inset-0 scale-110 blur-md"
        aria-hidden="true"
      >
        <MapLibreMap interactive={false}>
          <LoginSatellite />
        </MapLibreMap>
      </div>

      {/* Dim overlay so the glass card reads against bright imagery. */}
      <div
        className="pointer-events-none absolute inset-0 bg-black/30"
        aria-hidden="true"
      />

      {/* Centered frosted-glass sign-in card. */}
      <div className="relative flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-sm rounded-2xl border border-[var(--line)] bg-[var(--glass)] p-6 shadow-2xl backdrop-blur-xl">
          <div className="mb-5 space-y-1">
            <h1 className="text-lg font-semibold tracking-tight text-[var(--ink)]">
              Sign in
            </h1>
            <p className="text-sm text-[var(--ink-soft)]">
              Use your Bag-GPT account credentials.
            </p>
          </div>
          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="space-y-1">
              <label htmlFor="username" className="text-sm font-medium">
                Username
              </label>
              <Input
                id="username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="password" className="text-sm font-medium">
                Password
              </label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error ? (
              <p className="text-sm text-red-600" role="alert">
                {error}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Signing in..." : "Sign in"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
