import { kickGet } from "./kickContent.js";
import { getTwitchToken } from "./viewers.js";

// ---- Clip stat scrapers (Clip-to-Earn automation) ----
// Pull {views, likes, comments} for a submitted clip STRAIGHT FROM THE PLATFORM,
// server-side, no browser, no API keys where possible (X-bridge philosophy: the
// numbers are on the public page — go read the page).
//
//   youtube  → watch/shorts page HTML (viewCount + likeCount in embedded JSON)
//   x        → the syndication endpoint (likes + replies; X hides views)
//   twitch   → Helix clips API (creds we already run chat with)
//   kick     → v2 API via the Cloudflare-safe curl fetcher
//   tiktok / instagram → null (review lane: both demand real-browser JS)
//
// Every fetcher returns { views, likes, comments } (fields null when the
// platform doesn't expose them) or null when the platform can't be scanned —
// null routes the clip to the human-review lane, never blocks it.

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const num = (v) => {
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

async function pageText(url) {
  const r = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "en", Accept: "text/html" },
    signal: AbortSignal.timeout(15000),
    redirect: "follow",
  });
  if (!r.ok) throw new Error(`page ${r.status}`);
  return r.text();
}

// --- YouTube (incl. Shorts): stats live in the page's embedded player JSON ---
function youtubeId(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) return u.pathname.slice(1).split("/")[0] || null;
    const short = u.pathname.match(/\/shorts\/([\w-]{6,})/);
    if (short) return short[1];
    return u.searchParams.get("v");
  } catch {
    return null;
  }
}
async function youtubeStats(url) {
  const id = youtubeId(url);
  if (!id) return null;
  const t = await pageText(`https://www.youtube.com/watch?v=${encodeURIComponent(id)}`);
  const views = t.match(/"viewCount":"(\d+)"/)?.[1];
  if (views == null) return null; // consent wall / region shell — review lane
  const likes =
    t.match(/"likeCount":"?(\d+)/)?.[1] ?? t.match(/like this video along with ([\d,]+)/)?.[1];
  const comments = t.match(/"commentCount":\{"simpleText":"([\d,]+)/)?.[1];
  return { views: num(views), likes: num(likes), comments: num(comments) };
}

// --- X: cdn.syndication.twimg.com serves public tweet metrics tokenlessly
// (the "token" derives from the id). No view counts — X keeps those close.
function xStatusId(url) {
  return String(url).match(/status(?:es)?\/(\d{8,25})/)?.[1] ?? null;
}
async function xStats(url) {
  const id = xStatusId(url);
  if (!id) return null;
  const token = ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
  const r = await fetch(
    `https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${token}`,
    { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) }
  );
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  if (!j || !j.id_str) return null;
  return { views: null, likes: num(j.favorite_count), comments: num(j.conversation_count) };
}

// --- Twitch clips: Helix (app creds; view_count only) ---
function twitchClipSlug(url) {
  const m =
    String(url).match(/clips\.twitch\.tv\/([\w-]+)/) ||
    String(url).match(/twitch\.tv\/[^/]+\/clip\/([\w-]+)/);
  return m?.[1] ?? null;
}
async function twitchStats(url, creds) {
  const slug = twitchClipSlug(url);
  if (!slug || !creds?.clientId || !creds?.clientSecret) return null;
  const token = await getTwitchToken(creds.clientId, creds.clientSecret);
  const r = await fetch(`https://api.twitch.tv/helix/clips?id=${encodeURIComponent(slug)}`, {
    headers: { "Client-Id": creds.clientId, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) return null;
  const c = (await r.json())?.data?.[0];
  if (!c) return null;
  return { views: num(c.view_count), likes: null, comments: null };
}

// --- Kick clips: v2 API through the Cloudflare-safe fetcher ---
function kickClipId(url) {
  const m = String(url).match(/[?&]clip=(clip_[\w]+)/) || String(url).match(/\/clips\/(clip_[\w]+)/);
  return m?.[1] ?? null;
}
async function kickStats(url) {
  const id = kickClipId(url);
  if (!id) return null;
  const j = await kickGet(`https://kick.com/api/v2/clips/${encodeURIComponent(id)}`);
  const c = j?.clip;
  if (!c) return null;
  return { views: num(c.view_count ?? c.views), likes: num(c.likes_count ?? c.likes), comments: null };
}

// One entry point. Returns stats or null (null = this platform needs a human).
export async function fetchClipStats(platform, url, { twitchCreds } = {}) {
  try {
    if (platform === "youtube") return await youtubeStats(url);
    if (platform === "x") return await xStats(url);
    if (platform === "twitch") return await twitchStats(url, twitchCreds);
    if (platform === "kick") return await kickStats(url);
    return null; // tiktok / instagram → review lane
  } catch {
    return null; // scrape failure is never fatal — human lane catches it
  }
}

// Which platforms the scanner can actually read (drives UI copy + scan skips).
export const SCANNABLE = ["youtube", "x", "twitch", "kick"];
