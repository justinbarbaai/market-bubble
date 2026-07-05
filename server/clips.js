import crypto from "node:crypto";
import { loadDoc, saveDoc } from "./store.js";

// ---- Clip-to-Earn ----
// Viewers turn the show into reach: they clip a moment, post it (TikTok / YouTube
// / X / Instagram, or a native Twitch/Kick clip), and submit the link here. The
// operator approves legit clips in Studio and sets a reach tier; approval pays
// out Bubbles to the clipper's balance on The Floor (one economy) and drops the
// clip into the public gallery, where the best get FEATURED on the show + Content
// page — the real incentive.
//
// This is the ORGANIC funnel (your own audience = free clip supply). The PAID
// clipper campaigns (Whop / Vyro / Discord servers / placements) are run by a
// human + the Distribution Cockpit, not here.
//
// View counts: operator-set tier for now; an auto-pull (YouTube/X APIs) plugs in
// later via setClipViews() without touching this contract.

const CLIPS_FILE = new URL("./.mb-clips.json", import.meta.url);

// Reward by reach tier (Bubbles). A good clip is worth far more than chatting, so
// these dwarf the per-message economy. Featured adds a bonus on top.
export const CLIP_TIERS = { B: 250, A: 1000, S: 4000 };
const FEATURE_BONUS = 5000;

// Map a submitted URL to a platform (and reject anything that isn't a clip link).
const PLATFORM_PATTERNS = [
  ["tiktok", /^https?:\/\/(www\.|vm\.|m\.)?tiktok\.com\//i],
  ["youtube", /^https?:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//i],
  ["x", /^https?:\/\/(www\.|mobile\.)?(x|twitter)\.com\/\S+\/status\/\d+/i],
  ["instagram", /^https?:\/\/(www\.)?instagram\.com\/(reel|p|tv)\//i],
  ["twitch", /^https?:\/\/(clips\.twitch\.tv\/|(www\.)?twitch\.tv\/\S+\/clip\/)/i],
  ["kick", /^https?:\/\/(www\.)?kick\.com\/\S+(\/clips\/|\?clip=)/i],
];
export function detectPlatform(url) {
  const u = String(url || "").trim();
  for (const [name, re] of PLATFORM_PATTERNS) if (re.test(u)) return name;
  return null;
}

// id -> submission
let clips = Object.create(null);
let dirty = false;

export async function loadClips() {
  const raw = await loadDoc("mb:clips", CLIPS_FILE);
  if (raw && typeof raw === "object" && raw.clips) clips = raw.clips;
}
export function flushClips() {
  if (!dirty) return;
  dirty = false;
  saveDoc("mb:clips", CLIPS_FILE, { clips, savedAt: Date.now() }).catch((e) => {
    dirty = true;
    console.warn("[clips] save failed:", e.message);
  });
}

// Normalize a URL for dedupe: origin + path + meaningful query, minus trailing
// slash / fragment / tracking params. The query MUST be kept — YouTube (and
// others) put the video id in ?v=, so dropping it would collapse different
// videos into one and wrongly reject them as duplicates.
const TRACKING_PARAMS = new Set(["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "si", "feature", "fbclid", "igshid", "t"]);
function normUrl(url) {
  try {
    const u = new URL(String(url).trim());
    const kept = [...u.searchParams.entries()]
      .filter(([k]) => !TRACKING_PARAMS.has(k.toLowerCase()))
      .sort(([a], [b]) => a.localeCompare(b));
    const qs = kept.map(([k, v]) => `${k}=${v}`).join("&");
    const base = (u.origin + u.pathname).replace(/\/+$/, "").toLowerCase();
    return qs ? `${base}?${qs.toLowerCase()}` : base;
  } catch {
    return String(url || "").trim().toLowerCase();
  }
}

// A viewer submits a clip. `by` is their Floor identity key (source:username);
// bySource/byName are for display + the eventual payout. Returns { ok, clip|error }.
export function submitClip({ url, by, bySource, byName }) {
  const clean = String(url || "").trim();
  const platform = detectPlatform(clean);
  if (!platform) return { ok: false, error: "Link must be a TikTok, YouTube, X, Instagram, Twitch, or Kick clip." };
  if (!by) return { ok: false, error: "Sign in to submit a clip." };
  const norm = normUrl(clean);
  for (const id in clips) {
    if (clips[id].norm === norm) return { ok: false, error: "That clip's already been submitted." };
  }
  const id = crypto.randomBytes(8).toString("hex");
  const clip = {
    id,
    url: clean.slice(0, 500),
    norm,
    platform,
    by: String(by),
    bySource: String(bySource || ""),
    byName: String(byName || ""),
    status: "pending", // pending | approved | rejected
    featured: false,
    tier: null, // B | A | S once approved
    views: 0, // operator-set or auto-pulled later
    bubbles: 0, // total awarded for this clip
    // Attribution: the clip's real author (from oEmbed) + whether it matches a
    // VERIFIED linked handle of the submitter. attributed=true → provably theirs;
    // false → operator should eyeball it (could be someone else's clip).
    author: null,
    attributed: false,
    note: "",
    createdAt: Date.now(),
    decidedAt: null,
  };
  clips[id] = clip;
  dirty = true;
  return { ok: true, clip: publicClip(clip) };
}

// Operator decision. action: "approve" (with tier) | "reject". On approve, returns
// the Bubble award { key, source, name, amount } so the hub can credit The Floor.
export function decideClip(id, { action, tier, views, note } = {}) {
  const clip = clips[id];
  if (!clip) return { ok: false, error: "clip not found" };

  if (action === "reject") {
    clip.status = "rejected";
    clip.decidedAt = Date.now();
    if (note != null) clip.note = String(note).slice(0, 280);
    dirty = true;
    return { ok: true, clip: publicClip(clip) };
  }

  if (action === "approve") {
    const t = String(tier || "B").toUpperCase();
    if (!CLIP_TIERS[t]) return { ok: false, error: "tier must be S, A, or B" };
    const wasApproved = clip.status === "approved";
    const prevReward = wasApproved ? CLIP_TIERS[clip.tier] || 0 : 0;
    clip.status = "approved";
    clip.tier = t;
    if (Number.isFinite(Number(views))) clip.views = Math.max(0, Math.round(Number(views)));
    if (note != null) clip.note = String(note).slice(0, 280);
    clip.decidedAt = Date.now();
    // Pay only the DIFFERENCE if re-tiering an already-approved clip, so changing
    // a tier tops up (or claws back) instead of double-paying.
    const delta = CLIP_TIERS[t] - prevReward;
    clip.bubbles += delta;
    dirty = true;
    return {
      ok: true,
      clip: publicClip(clip),
      award: delta !== 0 ? { key: clip.by, source: clip.bySource, name: clip.byName, amount: delta } : null,
    };
  }

  return { ok: false, error: "unknown action" };
}

// Toggle the "featured on the show" flag; first feature pays a bonus once.
export function featureClip(id, on) {
  const clip = clips[id];
  if (!clip) return { ok: false, error: "clip not found" };
  const want = !!on;
  let award = null;
  if (want && !clip.featuredPaid) {
    clip.featuredPaid = true;
    clip.bubbles += FEATURE_BONUS;
    award = { key: clip.by, source: clip.bySource, name: clip.byName, amount: FEATURE_BONUS };
  }
  clip.featured = want;
  dirty = true;
  return { ok: true, clip: publicClip(clip), award };
}

// Record a submitted clip's resolved author + whether it's attributed to a
// verified handle of the submitter (set by the submit route after oEmbed).
export function setAttribution(id, { author, attributed }) {
  const c = clips[id];
  if (!c) return false;
  c.author = author || null;
  c.attributed = !!attributed;
  dirty = true;
  return true;
}

// Auto view-count plug-in point (YouTube/X pullers call this later).
export function setClipViews(id, views) {
  const clip = clips[id];
  if (!clip) return false;
  clip.views = Math.max(0, Math.round(Number(views) || 0));
  dirty = true;
  return true;
}

function publicClip(c) {
  return {
    id: c.id,
    url: c.url,
    platform: c.platform,
    by: c.byName || c.by,
    bySource: c.bySource,
    status: c.status,
    featured: c.featured,
    tier: c.tier,
    views: c.views,
    bubbles: c.bubbles,
    author: c.author ?? null,
    attributed: !!c.attributed,
    createdAt: c.createdAt,
  };
}

// A member's clip record for their public profile card (approved work only).
export function clipStatsFor(by) {
  let approved = 0, featured = 0, views = 0;
  for (const id in clips) {
    const c = clips[id];
    if (c.by !== by || c.status !== "approved") continue;
    approved++;
    views += c.views;
    if (c.featured) featured++;
  }
  return approved > 0 ? { approved, featured, views } : null;
}

// Clippers leaderboard — the campaign ranks PEOPLE, not posts: approved clips
// grouped by member, ranked by total views pulled. Clicking a clipper on the
// site opens the member profile they already built.
export function clippersLeaderboard(limit = 20) {
  const agg = Object.create(null);
  for (const id in clips) {
    const c = clips[id];
    if (c.status !== "approved") continue;
    const a =
      agg[c.by] ||
      (agg[c.by] = { name: c.byName || c.by, source: c.bySource, clips: 0, views: 0, bubbles: 0, featured: 0 });
    a.clips++;
    a.views += c.views;
    a.bubbles += c.bubbles;
    if (c.featured) a.featured++;
  }
  return Object.values(agg)
    .sort((x, y) => y.views - x.views || y.bubbles - x.bubbles)
    .slice(0, limit)
    .map((a, i) => ({ rank: i + 1, ...a }));
}

// The public wall is the campaign leaderboard: the TOP 10 approved clips RANKED
// BY VIEWS (most reach wins). `all` (operator) returns the full list incl.
// pending/rejected for the Studio review queue.
export const TOP_N = 10;
export function clipsPayload({ all = false, limit = all ? 200 : TOP_N } = {}) {
  const list = Object.values(clips);
  const visible = all ? list : list.filter((c) => c.status === "approved");
  // Ranking = pure views (the reach race). Featured is a badge, not a cheat to #1.
  visible.sort((a, b) => b.views - a.views || b.bubbles - a.bubbles || b.createdAt - a.createdAt);
  return {
    type: "clips",
    clips: visible.slice(0, limit).map(publicClip),
    clippers: clippersLeaderboard(),
    counts: {
      pending: list.filter((c) => c.status === "pending").length,
      approved: list.filter((c) => c.status === "approved").length,
    },
  };
}
