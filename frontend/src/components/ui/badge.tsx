import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        default: "border-transparent bg-[var(--ink)] text-white",
        done: "border-[#b6d8c6] bg-[#e6f4ec] text-[#1e5a3a]",
        indexing: "border-[#f2d59f] bg-[#fff4de] text-[#7a5208]",
        error: "border-[#efb1a6] bg-[#ffe8e2] text-[#8a2511]",
        idle: "border-[var(--line)] bg-white text-[var(--ink-soft)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
