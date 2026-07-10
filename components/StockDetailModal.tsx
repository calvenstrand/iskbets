"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Modal shell for in-app card taps (the intercepting route). Owns every
 * interaction — Esc, backdrop click, close button, scroll lock, focus
 * trap — and dismisses via router.back() so the URL returns to the
 * dashboard and the intercepted route unmounts. Data stays server-side:
 * the server-rendered <StockDetail> arrives as `children`, already HTML.
 *
 * Day-mood skin: the modal renders in the @modal slot OUTSIDE <main>,
 * so it does NOT inherit the skin's re-pointed --mood-* tokens from
 * <main data-daymood> — globals.css extends them explicitly via
 * `body:has(main[data-daymood]) .sd-modal`. The skinned dashboard
 * remains visible through the translucent backdrop either way.
 * On <=640px the shell presents as a full-screen sheet (a centered
 * dialog is unusable at 320px); the header pins and the body scrolls.
 * prefers-reduced-motion collapses the entrance to a plain appearance
 * (handled in CSS).
 */
export function StockDetailModal({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDivElement>(null);
  // Where focus was before the modal opened, so we can restore it on close.
  const restoreRef = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    router.back();
  }, [router]);

  // Scroll lock + focus management + Esc + focus trap.
  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement | null;

    const { body } = document;
    const prevOverflow = body.style.overflow;
    body.style.overflow = "hidden";

    // Move focus into the dialog for keyboard + screen-reader users.
    dialogRef.current?.focus();

    function focusables(): HTMLElement[] {
      const root = dialogRef.current;
      if (!root) return [];
      return Array.from(
        root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input, textarea, select, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === dialogRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      body.style.overflow = prevOverflow;
      restoreRef.current?.focus?.();
    };
  }, [close]);

  return (
    <div
      className="sd-modal-backdrop"
      onClick={(e) => {
        // Backdrop-only: ignore clicks that bubble from the dialog.
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className="sd-modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Stock detail"
        tabIndex={-1}
      >
        <button
          type="button"
          className="sd-modal-close"
          onClick={close}
          aria-label="Close"
        >
          ✕ ESC
        </button>
        <div className="sd-modal-body">{children}</div>
      </div>
    </div>
  );
}
