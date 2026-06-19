import { execFile } from "node:child_process";

// Clips + VODs for a Kick channel (Ansem) via Kick's v2 API. Kick fronts the
// API with Cloudflare, so we fetch with a browser UA via curl (same approach as
// the chat source) and fall back to plain fetch. Cached like the Twitch fetcher.

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export function kickGet(url) {
  return new Promise((resolve, reject) => {
    execFile(
      "curl",
      ["-s", "--http1.1", "--max-time", "12", "-A", BROWSER_UA, "-H", "Accept: application/json", url],
      { maxBuffer: 10 * 1024 * 1024 },
      async (err, stdout) => {
        if (!err && stdout && stdout.trim()) {
          try {
            resolve(JSON.parse(stdout));
            return;
          } catch {}
        }
        try {
          const res = await fetch(url, {
            headers: { "User-Agent": BROWSER_UA, Accept: "application/json" },
          });
          if (!res.ok) return reject(new Error(`Kick ${res.status}`));
          resolve(await res.json());
        } catch (e) {
          reject(e);
        }
      }
    );
  });
}

function formatViews(n) {
  n = Number(n) || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + "K";
  return String(n);
}

// seconds -> "1H 02M" / "5M"
function prettyDuration(totalSec) {
  totalSec = Math.round(Number(totalSec) || 0);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h) return `${h}H ${String(m).padStart(2, "0")}M`;
  if (m) return `${m}M`;
  return `${totalSec}S`;
}

// Drop obvious junk clip titles (single char, "x", "efe", whitespace).
function isJunkTitle(title) {
  const t = String(title || "").trim();
  if (t.length <= 2) return true;
  return false;
}

let cache = { at: 0, data: null };

export async function fetchKickContent(slug, { ttlMs = 5 * 60 * 1000 } = {}) {
  if (cache.data && Date.now() - cache.at < ttlMs) return cache.data;
  slug = String(slug || "").trim();
  if (!slug) return { clips: [], streams: [], updatedAt: Date.now() };

  const clips = [];
  const streams = [];

  try {
    const cj = await kickGet(`https://kick.com/api/v2/channels/${slug}/clips?sort=date&time=month`);
    for (const c of cj?.clips ?? []) {
      if (isJunkTitle(c.title)) continue;
      clips.push({
        title: c.title,
        date: (c.created_at || "").slice(0, 10),
        thumb: c.thumbnail_url || "",
        url: `https://kick.com/${slug}/clips/${c.id}`,
        duration: prettyDuration(c.duration),
        views: formatViews(c.view_count ?? c.views),
        source: "kick",
        createdAt: c.created_at || "",
      });
    }
  } catch {}

  try {
    const vj = await kickGet(`https://kick.com/api/v2/channels/${slug}/videos`);
    for (const v of Array.isArray(vj) ? vj : []) {
      const uuid = v?.video?.uuid;
      streams.push({
        title: v.session_title || "Broadcast",
        date: (v.created_at || "").slice(0, 10),
        duration: prettyDuration((Number(v.duration) || 0) / 1000),
        views: formatViews(v.views ?? v.viewer_count),
        thumb: v?.thumbnail?.src || "",
        url: uuid ? `https://kick.com/video/${uuid}` : `https://kick.com/${slug}/videos`,
        source: "kick",
        createdAt: v.created_at || "",
      });
    }
  } catch {}

  clips.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  streams.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const data = { clips, streams, updatedAt: Date.now() };
  cache = { at: Date.now(), data };
  return data;
}
