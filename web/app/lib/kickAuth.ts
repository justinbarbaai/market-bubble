"use client";

import { useEffect, useState } from "react";

// Per-viewer Kick sign-in. The OAuth round-trip happens on the hub (Kick's token
// exchange needs the client secret); the hub hands back an opaque session id that
// we store here and send with each Kick chat message so the viewer chats as
// themselves.

const HUB_HTTP = (process.env.NEXT_PUBLIC_HUB_URL || "ws://localhost:8080").replace(/^ws/, "http");
const KEY_ID = "mb.kickSession";
const KEY_USER = "mb.kickUser";
const EVT = "mb:kicksession";

export type KickSession = { id: string; username: string | null } | null;

export function getKickSession(): KickSession {
  if (typeof window === "undefined") return null;
  const id = localStorage.getItem(KEY_ID);
  if (!id) return null;
  return { id, username: localStorage.getItem(KEY_USER) };
}

function setKickSession(id: string, username: string | null) {
  localStorage.setItem(KEY_ID, id);
  if (username) localStorage.setItem(KEY_USER, username);
  else localStorage.removeItem(KEY_USER);
  window.dispatchEvent(new Event(EVT));
}

export function clearKickSession() {
  const id = typeof window !== "undefined" ? localStorage.getItem(KEY_ID) : null;
  if (id) {
    // best-effort: tell the hub to drop the token
    fetch(`${HUB_HTTP}/auth/kick/session/disconnect?id=${encodeURIComponent(id)}`).catch(() => {});
  }
  localStorage.removeItem(KEY_ID);
  localStorage.removeItem(KEY_USER);
  window.dispatchEvent(new Event(EVT));
}

// The Kick account's real pfp, resolved by the hub (Kick's API is Cloudflare-
// fronted — browsers can't ask it directly). Day-cached per username.
const KEY_AV = "mb.kickAvatar"; // { user, url, at }
export async function fetchKickAvatar(username: string | null): Promise<string | null> {
  if (!username || typeof window === "undefined") return null;
  try {
    const c = JSON.parse(localStorage.getItem(KEY_AV) || "null");
    if (c?.user === username && c.url && Date.now() - c.at < 24 * 3600e3) return c.url;
  } catch {}
  try {
    const r = await fetch(`${HUB_HTTP}/member?source=kick&username=${encodeURIComponent(username)}`);
    const j = await r.json();
    const url: string | null = j?.avatar || null;
    if (url) localStorage.setItem(KEY_AV, JSON.stringify({ user: username, url, at: Date.now() }));
    return url;
  } catch {
    return null;
  }
}

export function startKickLogin() {
  // When the site is embedded same-origin (the /classic theater), break out to
  // the top window — Kick's OAuth pages refuse to render inside iframes.
  const nav = (() => { try { return window.top ?? window; } catch { return window; } })();
  // Tell the hub where to send the user back after Kick approves: the SAME
  // origin that started the login (allowlisted hub-side), and — when embedded —
  // the embedding page's path (e.g. /classic), so the classic site stays the
  // classic site.
  let path = "";
  try {
    if (window.top && window.top !== window) path = window.top.location.pathname || "";
  } catch {}
  const ret = encodeURIComponent(window.location.origin + (path === "/" ? "" : path));
  nav.location.href = `${HUB_HTTP}/auth/kick/user/login?return=${ret}`;
}

// Capture the session from the OAuth redirect FRAGMENT (#kick_session=…) — the
// hub returns it in the fragment so the credential never lands in a server log
// or Referer header. Falls back to the legacy ?query form. Then strips it.
export function captureKickSessionFromUrl() {
  captureFromUrl();
}

function captureFromUrl() {
  if (typeof window === "undefined") return;
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const query = new URLSearchParams(window.location.search);
  const id = hash.get("kick_session") || query.get("kick_session");
  if (!id) return;
  setKickSession(id, hash.get("kick_user") || query.get("kick_user"));
  query.delete("kick_session");
  query.delete("kick_user");
  const qs = query.toString();
  const url = window.location.pathname + (qs ? `?${qs}` : "");
  window.history.replaceState(null, "", url);
}

// Reactive Kick session (shared across components via a window event).
export function useKickSession() {
  const [session, setSession] = useState<KickSession>(null);
  useEffect(() => {
    captureFromUrl();
    setSession(getKickSession());
    const onChange = () => setSession(getKickSession());
    window.addEventListener(EVT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(EVT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);
  return { session, signOut: clearKickSession, signIn: startKickLogin };
}
