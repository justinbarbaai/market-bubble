"use client";

import { useEffect, useId, useState } from "react";

// A crafted sun that morphs into a crescent moon (the mask "bite" slides over
// and the rays retract). Pure CSS transitions on the SVG — smooth and tactile.
function ThemeIcon({ icon }: { icon: "sun" | "moon" }) {
  const raw = useId().replace(/[^a-zA-Z0-9]/g, "");
  const maskId = `mb-moon-${raw}`;
  return (
    <svg className="theme-ico" data-icon={icon} viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
      <mask id={maskId}>
        <rect x="0" y="0" width="24" height="24" fill="white" />
        <circle className="ico-bite" cx="24" cy="4" r="6" fill="black" />
      </mask>
      <circle className="ico-body" cx="12" cy="12" r="6" fill="currentColor" mask={`url(#${maskId})`} />
      <g className="ico-rays" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
        <line x1="12" y1="1.5" x2="12" y2="3.7" />
        <line x1="12" y1="20.3" x2="12" y2="22.5" />
        <line x1="1.5" y1="12" x2="3.7" y2="12" />
        <line x1="20.3" y1="12" x2="22.5" y2="12" />
        <line x1="4.2" y1="4.2" x2="5.8" y2="5.8" />
        <line x1="18.2" y1="18.2" x2="19.8" y2="19.8" />
        <line x1="4.2" y1="19.8" x2="5.8" y2="18.2" />
        <line x1="18.2" y1="5.8" x2="19.8" y2="4.2" />
      </g>
    </svg>
  );
}

// Flips <html data-theme> between dark/light and remembers the choice. The new
// theme is revealed with a circular wipe expanding from the toggle button (View
// Transitions API); falls back to an instant swap when the API/motion is off.
export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<"dark" | "light">("light");

  useEffect(() => {
    const t = (document.documentElement.getAttribute("data-theme") as "dark" | "light") || "light";
    setTheme(t);
  }, []);

  const apply = (next: "dark" | "light") => {
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("mb-theme", next);
    } catch {}
    // keep the mobile status-bar colour matched to the page (no dark line up top)
    const m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute("content", next === "dark" ? "#1a1917" : "#f3ebda");
  };

  const toggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    const next = theme === "dark" ? "light" : "dark";
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    // @ts-ignore - View Transitions API
    if (reduce || typeof document.startViewTransition !== "function") {
      apply(next);
      return;
    }
    // origin = centre of the toggle button, so the wipe grows from it
    const rect = e.currentTarget.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    // @ts-ignore
    const transition = document.startViewTransition(() => apply(next));
    transition.ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
        {
          duration: 540,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
          pseudoElement: "::view-transition-new(root)",
        }
      );
    });
  };

  return (
    <button
      className={`theme-toggle ${className || ""}`}
      onClick={toggle}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      suppressHydrationWarning
    >
      <ThemeIcon icon={theme === "dark" ? "sun" : "moon"} />
    </button>
  );
}
