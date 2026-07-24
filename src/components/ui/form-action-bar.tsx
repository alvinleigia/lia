import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type FormActionBarProps = {
  className?: string;
  primaryAction?: ReactNode;
  secondaryActions?: ReactNode;
};

export function FormActionBar({
  className,
  primaryAction,
  secondaryActions,
}: FormActionBarProps) {
  return (
    <div
      className={cn(
        "flex min-h-14 items-center justify-between gap-3 overflow-x-auto border-t pt-4 pb-1",
        className,
      )}
    >
      <div className="flex shrink-0 items-center gap-2">{primaryAction}</div>
      <div className="flex shrink-0 items-center justify-end gap-2">
        {secondaryActions}
      </div>
    </div>
  );
}
