import * as React from "react";

import { cn } from "../../lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm text-[var(--ink)] shadow-sm transition placeholder:text-[var(--ink-soft)]/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--teal)]",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
