"use client";

// Client-side Twitch OAuth (implicit flow) so a user can log in with their own
// Twitch account and send chat messages from a reader tab. The Client ID is
// public (not a secret); it comes from NEXT_PUBLIC_TWITCH_CLIENT_ID or a value
// the user pastes into the reader (stored in localStorage). The token never
// touches our server — sending happens directly from the browser to Twitch IRC.

const LS_CLIENT_ID = "mb_twitch_client_id";
const LS_AUTH = "mb_twitch_auth";
const LS_RETURN = "mb_twitch_return";
// The app's public Client ID (NOT a secret — it ships in every OAuth URL).
// Baked in as a fallback so login still works on deployments where the
// NEXT_PUBLIC_TWITCH_CLIENT_ID env var was never configured.
const PUBLIC_CLIENT_ID = "bt2g84siv1d9uu9bofyhvc0z8a3ynz";
// chat:* lets us send; moderator:manage:banned_users lets a logged-in mod time
// out / ban chatters in channels they moderate; user:read:emotes lets us pull
// the viewer's OWN emote set (everything they're subbed to, follower, bits,
// global) so the composer's picker matches their real Twitch emotes.
const SCOPES = "chat:read chat:edit moderator:manage:banned_users user:read:emotes";

export type TwitchAuth = { token: string; login: string; userId: string };

export function getClientId(): string {
  if (typeof window === "undefined") return "";
  return (
    localStorage.getItem(LS_CLIENT_ID) ||
    process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID ||
    PUBLIC_CLIENT_ID
  );
}

export function setClientId(id: string) {
  localStorage.setItem(LS_CLIENT_ID, id.trim());
}

export function getAuth(): TwitchAuth | null {
  if (typeof window === "undefined") return null;
  try {
    const v = localStorage.getItem(LS_AUTH);
    return v ? (JSON.parse(v) as TwitchAuth) : null;
  } catch {
    return null;
  }
}

export function clearAuth() {
  localStorage.removeItem(LS_AUTH);
  localStorage.removeItem(LS_AVATAR);
}

// The connected account's REAL Twitch profile picture, from Helix with the
// user's own token (unavatar is a third-party guesser and often misses).
// Cached for a day; falls back to null so callers can keep their placeholder.
const LS_AVATAR = "mb_twitch_avatar"; // { login, url, at }
export async function fetchTwitchAvatar(auth: TwitchAuth): Promise<string | null> {
  if (typeof window === "undefined" || !auth?.token) return null;
  try {
    const c = JSON.parse(localStorage.getItem(LS_AVATAR) || "null");
    if (c?.login === auth.login && c.url && Date.now() - c.at < 24 * 3600e3) return c.url;
  } catch {}
  try {
    const r = await fetch("https://api.twitch.tv/helix/users", {
      headers: { "Client-ID": getClientId(), Authorization: `Bearer ${auth.token}` },
    });
    if (!r.ok) return null;
    const j = await r.json();
    const url: string | null = j?.data?.[0]?.profile_image_url || null;
    if (url) localStorage.setItem(LS_AVATAR, JSON.stringify({ login: auth.login, url, at: Date.now() }));
    return url;
  } catch {
    return null;
  }
}

// Always returns to the public home (one canonical redirect URI to register in
// the Twitch app), then bounces to `returnPath` — so viewers never land on the
// operator reader/studio pages.
export function startLogin(returnPath = "/") {
  const clientId = getClientId();
  if (!clientId) return;
  // Embedded same-origin (the /classic theater): after auth, return to the
  // EMBEDDING page (e.g. /classic), not the site root — the classic site is
  // its own experience.
  let ret = returnPath || "/";
  try {
    if (window.top && window.top !== window) ret = window.top.location.pathname || ret;
  } catch {}
  try {
    localStorage.setItem(LS_RETURN, ret);
  } catch {}
  const redirect = `${window.location.origin}/`;
  const url =
    `https://id.twitch.tv/oauth2/authorize?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirect)}` +
    `&response_type=token&scope=${encodeURIComponent(SCOPES)}`;
  window.location.href = url;
}

// On reader load: if Twitch redirected back with a token in the URL fragment,
// validate it (which also gives us the login name needed for IRC) and store it.
export async function handleRedirect(): Promise<TwitchAuth | null> {
  if (typeof window === "undefined") return null;
  if (!window.location.hash.includes("access_token=")) return null;
  const params = new URLSearchParams(window.location.hash.slice(1));
  const token = params.get("access_token");
  history.replaceState(null, "", window.location.pathname + window.location.search);
  if (!token) return null;
  try {
    const res = await fetch("https://id.twitch.tv/oauth2/validate", {
      headers: { Authorization: `OAuth ${token}` },
    });
    if (!res.ok) return null;
    const j = await res.json();
    const auth: TwitchAuth = { token, login: j.login, userId: j.user_id };
    localStorage.setItem(LS_AUTH, JSON.stringify(auth));
    // bounce back to the page the user signed in from (public pages only)
    try {
      const ret = localStorage.getItem(LS_RETURN);
      localStorage.removeItem(LS_RETURN);
      if (ret && ret !== window.location.pathname) {
        window.location.replace(ret);
      }
    } catch {}
    return auth;
  } catch {
    return null;
  }
}
