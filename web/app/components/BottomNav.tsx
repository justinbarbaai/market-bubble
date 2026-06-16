"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { requestView, readView, type MBView } from "../lib/liveView";

// App-style bottom tab bar — mobile only (hidden ≥769px via CSS). "Live" is the
// emphasized center tab; the rest are the site's main sections. Home + Live both
// live on "/" (the live room is a view-state there), so they flip the view via
// requestView instead of routing. This is what makes the site feel like an app.
const TABS = [
  { href: "/", label: "Home", icon: HomeIcon, view: "lobby" as MBView },
  { href: "/market", label: "Market", icon: MarketIcon },
  { href: "/", label: "Live", icon: LiveIcon, hero: true, view: "live" as MBView },
  { href: "/news", label: "News", icon: NewsIcon },
  { href: "/content", label: "Content", icon: ContentIcon },
];

export function BottomNav() {
  const path = usePathname();
  const [view, setView] = useState<MBView | null>(null);

  useEffect(() => {
    setView(readView());
    const onView = (e: Event) => setView((e as CustomEvent<MBView>).detail);
    window.addEventListener("mb:view", onView);
    return () => window.removeEventListener("mb:view", onView);
  }, []);

  // hide on operator/overlay surfaces — those aren't part of the public app
  if (path.startsWith("/studio") || path.startsWith("/overlay") || path.startsWith("/reader")) {
    return null;
  }
  return (
    <nav className="bottomnav" aria-label="Primary">
      {TABS.map((tab) => {
        const { href, label, icon: Icon, hero } = tab;
        const tv = tab.view; // "lobby" | "live" | undefined
        const active = tv
          ? path === "/" && (tv === "live" ? view === "live" : view !== "live")
          : href === "/"
          ? path === "/"
          : path.startsWith(href);
        return (
          <Link
            key={label}
            href={href}
            onClick={tv ? () => requestView(tv) : undefined}
            className={`bottomnav-tab ${active ? "active" : ""} ${hero ? "hero" : ""}`}
            aria-current={active ? "page" : undefined}
          >
            <span className="bottomnav-ico">
              <Icon />
              {hero && <span className="bottomnav-livedot" aria-hidden="true" />}
            </span>
            <span className="bottomnav-label">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/* ── line icons (currentColor, 24px, match the editorial line weight) ── */
const P = {
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function HomeIcon() {
  return (
    <svg {...P}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" />
      <path d="M9.5 21v-6h5v6" />
    </svg>
  );
}
function MarketIcon() {
  return (
    <svg {...P}>
      <path d="M3 17l5-5 3.5 3.5L21 5" />
      <path d="M21 9V5h-4" />
    </svg>
  );
}
function LiveIcon() {
  // broadcast / speech-bubble — the room is live chat
  return (
    <svg {...P}>
      <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4.5a1 1 0 0 1-.86-1.5L5 16.2A8.5 8.5 0 1 1 21 11.5Z" />
      <circle cx="12" cy="11.5" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
function NewsIcon() {
  return (
    <svg {...P}>
      <path d="M4 5h13a1 1 0 0 1 1 1v13a1 1 0 0 0 1 1 1 1 0 0 0 1-1V8" />
      <path d="M4 5v14a1 1 0 0 0 1 1h13" />
      <path d="M7.5 9h6M7.5 12.5h6M7.5 16h3.5" />
    </svg>
  );
}
function ContentIcon() {
  return (
    <svg {...P}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M10.5 9.2v5.6l4.5-2.8z" fill="currentColor" stroke="none" />
    </svg>
  );
}
