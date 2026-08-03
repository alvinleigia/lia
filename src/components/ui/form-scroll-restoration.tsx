"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

const STORAGE_KEY = "lia:form-scroll-position";
const MAX_AGE_MS = 30_000;
const SCROLL_JUMP_THRESHOLD = 24;

type ScrollSnapshot = {
  createdAt: number;
  pathname: string;
  x: number;
  y: number;
};

function clearSnapshot() {
  sessionStorage.removeItem(STORAGE_KEY);
}

function readSnapshot(): ScrollSnapshot | null {
  const value = sessionStorage.getItem(STORAGE_KEY);
  if (!value) {
    return null;
  }

  try {
    const snapshot = JSON.parse(value) as Partial<ScrollSnapshot>;
    if (
      typeof snapshot.createdAt !== "number" ||
      typeof snapshot.pathname !== "string" ||
      typeof snapshot.x !== "number" ||
      typeof snapshot.y !== "number"
    ) {
      clearSnapshot();
      return null;
    }

    if (Date.now() - snapshot.createdAt > MAX_AGE_MS) {
      clearSnapshot();
      return null;
    }

    return snapshot as ScrollSnapshot;
  } catch {
    clearSnapshot();
    return null;
  }
}

function restoreSnapshot(pathname: string) {
  const snapshot = readSnapshot();
  if (!snapshot) {
    return false;
  }

  if (snapshot.pathname !== pathname) {
    clearSnapshot();
    return false;
  }

  const didJump =
    Math.abs(window.scrollX - snapshot.x) > SCROLL_JUMP_THRESHOLD ||
    Math.abs(window.scrollY - snapshot.y) > SCROLL_JUMP_THRESHOLD;

  if (!didJump) {
    return false;
  }

  window.scrollTo({
    behavior: "auto",
    left: snapshot.x,
    top: snapshot.y,
  });
  clearSnapshot();
  return true;
}

export function FormScrollRestoration() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const navigationKey = `${pathname}?${searchParams.toString()}`;
  const observerRef = useRef<MutationObserver | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);

  const stopWatching = useCallback(() => {
    observerRef.current?.disconnect();
    observerRef.current = null;

    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  useEffect(() => {
    const handleSubmit = (event: SubmitEvent) => {
      const form = event.target;
      if (
        !(form instanceof HTMLFormElement) ||
        !form.hasAttribute("data-preserve-scroll")
      ) {
        return;
      }

      stopWatching();
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          createdAt: Date.now(),
          pathname: window.location.pathname,
          x: window.scrollX,
          y: window.scrollY,
        } satisfies ScrollSnapshot),
      );

      observerRef.current = new MutationObserver(() => {
        if (frameRef.current !== null) {
          window.cancelAnimationFrame(frameRef.current);
        }

        frameRef.current = window.requestAnimationFrame(() => {
          frameRef.current = window.requestAnimationFrame(() => {
            frameRef.current = null;
            if (restoreSnapshot(window.location.pathname)) {
              stopWatching();
            }
          });
        });
      });
      observerRef.current.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });

      timeoutRef.current = window.setTimeout(() => {
        clearSnapshot();
        stopWatching();
      }, MAX_AGE_MS);
    };

    document.addEventListener("submit", handleSubmit, true);
    return () => {
      document.removeEventListener("submit", handleSubmit, true);
      stopWatching();
    };
  }, [stopWatching]);

  useLayoutEffect(() => {
    const currentPathname = navigationKey.slice(0, navigationKey.indexOf("?"));
    const snapshot = readSnapshot();
    if (!snapshot) {
      return;
    }

    if (snapshot.pathname !== currentPathname) {
      clearSnapshot();
      stopWatching();
      return;
    }

    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
    }

    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        restoreSnapshot(currentPathname);
        clearSnapshot();
        stopWatching();
      });
    });
  }, [navigationKey, stopWatching]);

  return null;
}
