import { LogOut } from "lucide-react";
import { Link } from "react-router-dom";

import { useAuth } from "../../context/auth-context";
import { Button } from "../ui/button";
import { JobsDropdown } from "./jobs-dropdown";

export function TopBar() {
  const { username, logout } = useAuth();

  return (
    <header className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-6 py-3">
      <Link to="/" className="text-base font-semibold tracking-tight text-[var(--ink)]">
        Bag-GPT
      </Link>
      <div className="flex items-center gap-3">
        <JobsDropdown />
        {username ? (
          <span className="text-sm text-[var(--ink-soft)]">{username}</span>
        ) : null}
        <Button variant="outline" size="sm" onClick={() => void logout()}>
          <LogOut className="mr-1.5 h-3.5 w-3.5" />
          Log out
        </Button>
      </div>
    </header>
  );
}
