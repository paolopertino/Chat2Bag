import { LogOut } from "lucide-react";
import { Link } from "react-router-dom";

import { useAuth } from "../../context/auth-context";

export function UtilityChip() {
  const { username, logout } = useAuth();

  return (
    <div className="fixed right-3 top-3 z-40 flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--glass)] px-3 py-1.5 shadow-lg backdrop-blur">
      <Link
        to="/"
        className="text-sm font-semibold tracking-tight text-[var(--ink)]"
      >
        Bag-GPT
      </Link>
      {username ? (
        <span className="text-sm text-[var(--ink-soft)]">{username}</span>
      ) : null}
      <button
        type="button"
        onClick={() => void logout()}
        aria-label="Log out"
        className="flex h-6 w-6 items-center justify-center rounded-full text-[var(--ink-soft)] transition-colors hover:text-[var(--ink)]"
      >
        <LogOut className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
