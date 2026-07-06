"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { MBLockup } from "./brand";
import { ThemeToggle } from "./ThemeToggle";
import { Ticker } from "./Ticker";
import { TermFooter } from "./TermFooter";
import { LoginMenu } from "./LoginMenu";
import {
  getAuth,
  startLogin,
  clearAuth,
  getClientId,
  setClientId,
  type TwitchAuth,
} from "../lib/twitchAuth";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/market", label: "Market" },
  { href: "/news", label: "News" },
  { href: "/content", label: "Content" },
  { href: "/clips", label: "Clips" },
  { href: "/quests", label: "Quests" },
];

/**
 * Shared terminal-room chrome for the public content pages (Market / News),
 * mirroring the layout of the home room: a terminal top bar, a dotted
 * workspace canvas, and the live ticker tape along the bottom.
 */
export function TermShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [auth, setAuth] = useState<TwitchAuth | null>(null);
  const [twitchReady, setTwitchReady] = useState(false);

  useEffect(() => {
    setAuth(getAuth());
    setTwitchReady(!!getClientId());
  }, []);

  return (
    <div className="term term-scroll">
      {/* ---- terminal top bar ---- */}
      <header className="term-bar">
        <Link href="/" className="term-logo" aria-label="Market Bubble">
          <MBLockup className="term-lockup" />
        </Link>
        <nav className="term-nav">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={path === n.href ? "active" : ""}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="term-bar-right">
          <ThemeToggle className="term-icon" />
          <a className="term-auth term-studio" href="/studio" title="Market Bubble Studio (admin)">
            Studio
          </a>
          <LoginMenu
            auth={auth}
            twitchReady={twitchReady}
            onTwitchLogin={() => startLogin(path)}
            onTwitchLogout={() => { clearAuth(); setAuth(null); }}
            onSaveClientId={(id) => { setClientId(id); setTwitchReady(true); startLogin(path); }}
          />
        </div>
      </header>

      {/* ---- dotted workspace canvas ---- */}
      <div className="work term-page">
        <div className="term-page-inner">{children}</div>
      </div>

      {/* ---- bottom tape: live market ticker + brand (above the footer, like home) ---- */}
      <div className="term-tape-slot">
        <footer className="term-tape">
          <span className="term-tape-cap left">Invest in yourself</span>
          <div className="term-tape-ticker"><Ticker /></div>
          <span className="term-tape-cap right">LIVE THURS 1PM · <b>Polymarket</b></span>
        </footer>
      </div>

      {/* ---- full site footer ---- */}
      <TermFooter />
    </div>
  );
}
