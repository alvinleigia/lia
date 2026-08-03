"use client";

import { useEffect } from "react";
import { toast } from "sonner";

type FlashToastProps = {
  clearParams?: string;
  id: string;
  message: string;
};

export function FlashToast({ clearParams = "", id, message }: FlashToastProps) {
  useEffect(() => {
    toast.success(message, { id });

    if (!clearParams) {
      return;
    }

    const url = new URL(window.location.href);
    for (const param of clearParams.split(",")) {
      url.searchParams.delete(param);
    }

    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }, [clearParams, id, message]);

  return null;
}
