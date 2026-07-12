"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

type NavigationShellProps = {
  children: ReactNode;
};

export function NavigationShell({ children }: NavigationShellProps) {
  const pathname = usePathname();

  if (pathname === "/account-disabled") {
    return null;
  }

  return <>{children}</>;
}
