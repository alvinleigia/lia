"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";

type FlashRule = {
  matches?: (params: URLSearchParams) => boolean;
  message: string | ((params: URLSearchParams) => string);
  param: string;
  path: RegExp | string;
  tone?: "info" | "success";
};

const FLASH_RULES: FlashRule[] = [
  {
    path: "/forgot-password",
    param: "sent",
    message: "If that email exists, a reset link has been sent.",
    tone: "info",
  },
  {
    path: "/sign-in",
    param: "registered",
    message: "Account created successfully. Please sign in.",
  },
  {
    path: "/sign-in",
    param: "inviteAccepted",
    message: "Invitation accepted. Please sign in.",
  },
  {
    path: "/sign-in",
    param: "reset",
    message: "Password updated successfully. Please sign in.",
  },
  {
    path: "/platform",
    param: "updated",
    message: "Tenant updated.",
  },
  {
    path: "/profile",
    param: "profileUpdated",
    message: "Profile updated.",
  },
  {
    path: "/team",
    param: "inviteAccepted",
    message: "Invitation accepted.",
  },
  {
    path: "/team",
    param: "inviteCancelled",
    message: "Invitation cancelled.",
  },
  {
    path: "/team",
    param: "memberUpdated",
    message: "Member updated.",
  },
  {
    path: "/projects",
    param: "created",
    message: "Project created.",
  },
  {
    path: "/projects",
    param: "archived",
    message: "Project archived and widget disabled.",
  },
  {
    path: "/projects",
    param: "unarchived",
    message: "Project unarchived.",
  },
  {
    path: /^\/projects\/\d+$/,
    param: "created",
    message: "Project created.",
  },
  {
    path: /^\/projects\/\d+$/,
    param: "renamed",
    message: "Project renamed.",
  },
  {
    path: /^\/projects\/\d+\/settings$/,
    param: "renamed",
    message: "Project renamed.",
  },
  {
    path: /^\/projects\/\d+\/settings$/,
    param: "archived",
    message: "Project archived and widget disabled.",
  },
  {
    path: /^\/projects\/\d+\/settings$/,
    param: "unarchived",
    message: "Project unarchived.",
  },
  {
    path: /^\/projects\/\d+\/settings$/,
    param: "aiSettings",
    message: "AI behavior settings saved.",
  },
  {
    path: "/projects/actions",
    param: "deleted",
    message: "Action deleted.",
  },
  {
    path: "/projects/catalog",
    param: "catalogCreated",
    message: "Catalog created.",
  },
  {
    path: "/projects/catalog",
    param: "productCreated",
    message: "Product created.",
  },
  {
    path: "/projects/catalog",
    param: "catalogDeleted",
    message: "Catalog permanently deleted.",
  },
  {
    path: "/projects/channels/whatsapp",
    param: "updated",
    message: "WhatsApp settings saved.",
  },
  {
    path: "/projects/channels/whatsapp",
    param: "testSent",
    message: "Test message sent through WhatsApp Cloud API.",
  },
  {
    path: "/projects/channels/telnyx",
    param: "updated",
    message: "Telnyx Voice settings saved.",
  },
  {
    path: "/projects/documents",
    param: "deleted",
    message: "Document deleted.",
  },
  {
    path: "/projects/documents",
    param: "deletedAll",
    message: "All documents deleted for the selected project.",
  },
  {
    path: "/projects/handoffs",
    param: "updated",
    message: (params) => `Updated ${params.get("updated") ?? "0"} handoff(s).`,
  },
  {
    path: "/projects/media",
    param: "uploaded",
    message: "Media asset uploaded.",
  },
  {
    path: "/projects/media",
    param: "archived",
    message: "Media asset archived.",
  },
  {
    path: "/projects/tasks",
    param: "archived",
    message: "Task archived.",
  },
  {
    path: /^\/projects\/tasks\/\d+\/configure\/review\/runtime$/,
    param: "event",
    matches: (params) =>
      ["field_saved", "field_corrected"].includes(params.get("event") ?? ""),
    message: (params) =>
      params.get("event") === "field_corrected"
        ? "The value was corrected and dependent fields were checked."
        : "The test value was validated and saved.",
  },
];

export function UrlFlashToasts() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const lastSignature = useRef("");

  const showFlashToasts = useCallback(
    (currentPathname: string, currentSearch: string) => {
      const params = new URLSearchParams(currentSearch);
      const activeRules = FLASH_RULES.filter(
        (rule) =>
          (typeof rule.path === "string"
            ? rule.path === currentPathname
            : rule.path.test(currentPathname)) &&
          params.has(rule.param) &&
          (!rule.matches || rule.matches(params)),
      );

      if (activeRules.length === 0) {
        lastSignature.current = "";
        return;
      }

      const signature = `${currentPathname}?${currentSearch}`;
      if (lastSignature.current === signature) {
        return;
      }
      lastSignature.current = signature;

      for (const rule of activeRules) {
        const message =
          typeof rule.message === "function"
            ? rule.message(params)
            : rule.message;
        const showToast = rule.tone === "info" ? toast.info : toast.success;
        showToast(message, {
          id: `url-flash:${String(rule.path)}:${rule.param}`,
        });
      }

      const url = new URL(window.location.href);
      for (const rule of activeRules) {
        url.searchParams.delete(rule.param);
      }
      window.history.replaceState(
        window.history.state,
        "",
        `${url.pathname}${url.search}${url.hash}`,
      );
    },
    [],
  );

  useEffect(() => {
    showFlashToasts(pathname, search);
  }, [pathname, search, showFlashToasts]);

  useEffect(() => {
    let frame: number | null = null;
    const observer = new MutationObserver(() => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }

      frame = window.requestAnimationFrame(() => {
        frame = null;
        const url = new URL(window.location.href);
        showFlashToasts(url.pathname, url.searchParams.toString());
      });
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    return () => {
      observer.disconnect();
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [showFlashToasts]);

  return null;
}
