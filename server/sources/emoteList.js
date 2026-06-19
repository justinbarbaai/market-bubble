import { getTwitchToken } from "./viewers.js";
import { KICK_EMOTES } from "./kickEmotesStatic.js";

// Kick channel emotes (global + the show channels' sets). Kick fronts its emote
// API with Cloudflare, which blocks the Render hub's datacenter IP (and browser
// CORS), so we can't fetch them live — we serve a captured static snapshot
// instead (refresh: node scripts/refresh-kick-emotes.mjs locally).
function addKickEmotes(out) {
  for (const [name, url] of Object.entries(KICK_EMOTES)) {
    if (!out[name]) out[name] = { url, provider: "kick" };
  }
}

// Aggregates the emotes a viewer can TYPE in the composer into one
// { name: { url, provider } } map — for the autocomplete + picker on the site.
//
//  - 7TV / BTTV / FFZ (global + per-channel) come from the shared EmoteResolver,
//    which already caches them for rendering INCOMING chat, so this is cheap.
//  - Twitch native global + channel emotes are fetched here via Helix (same app
//    creds as the viewer counts / clips).
//
// Per-user Twitch sub emotes are intentionally omitted — they're per-account
// entitlements; globals + the channels' sets + the third-party sets cover what
// viewers actually reach for. Cached so the route doesn't refetch on every load.

async function helix(path, creds, token) {
  const res = await fetch(`https://api.twitch.tv/helix/${path}`, {
    headers: { "Client-ID": creds.clientId, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Helix ${path} (${res.status})`);
  return res.json();
}

async function userId(login, creds, token) {
  const j = await helix(`users?login=${encodeURIComponent(String(login).toLowerCase())}`, creds, token);
  return j.data?.[0]?.id || null;
}

let cache = { at: 0, data: null, key: "" };

export async function fetchEmoteList(channels, kickChannels, creds, resolver, { ttlMs = 10 * 60 * 1000 } = {}) {
  const list = (channels || []).map((c) => String(c).toLowerCase());
  const kickList = (kickChannels || []).map((c) => String(c).toLowerCase());
  const key = list.join(",") + "|" + kickList.join(",");
  if (cache.data && cache.key === key && Date.now() - cache.at < ttlMs) return cache.data;

  const out = {}; // name -> { url, provider }
  try {
    if (creds?.clientId && creds?.clientSecret) {
      const token = await getTwitchToken(creds.clientId, creds.clientSecret);

      // Twitch native global emotes (Kappa, etc.)
      try {
        const g = await helix("chat/emotes/global", creds, token);
        for (const e of g.data || []) {
          const url = e.images?.url_2x || e.images?.url_1x;
          if (e.name && url) out[e.name] = { url, provider: "twitch" };
        }
      } catch {}

      for (const login of list) {
        const id = await userId(login, creds, token).catch(() => null);
        if (!id) continue;
        // Twitch channel emotes (the broadcaster's own / sub emotes art)
        try {
          const ce = await helix(`chat/emotes?broadcaster_id=${id}`, creds, token);
          for (const e of ce.data || []) {
            const url = e.images?.url_2x || e.images?.url_1x;
            if (e.name && url) out[e.name] = { url, provider: "twitch" };
          }
        } catch {}
        // 7TV / BTTV / FFZ (global + this channel) via the shared resolver
        try {
          const m = await resolver.channelMap("twitch", id);
          for (const [name, url] of m) if (!out[name]) out[name] = { url, provider: "3p" };
        } catch {}
      }
    }
  } catch {}

  // Kick channel emotes (static snapshot — see note above).
  if (kickList.length) addKickEmotes(out);

  const data = { emotes: out, count: Object.keys(out).length, updatedAt: Date.now() };
  cache = { at: Date.now(), data, key };
  return data;
}
