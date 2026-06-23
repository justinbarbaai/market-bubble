import crypto from "node:crypto";
import { loadDoc, saveDoc } from "./store.js";

// ---- Distribution Cockpit ----
// The internal command center for the show's paid-distribution operation (the
// "head of clipping" role). The clipping campaigns themselves run on Whop / Vyro
// / Discord servers / paid X placements — this DOESN'T rebuild those. It does the
// thing those platforms + a human can't do well: ONE ledger across every channel
// with the ROI math, bot-spike flags, and the weekly report the role has to
// defend to the founders.
//
// Each line item = one spend: a clipper campaign or a placement. The operator
// logs spend + the clip/placement link; views are entered (auto-pull via the
// platform APIs plugs in later). We compute reach-per-dollar, flag suspiciously
// cheap reach (the bot tell), and generate the week's report.

const COCKPIT_FILE = new URL("./.mb-cockpit.json", import.meta.url);

// id -> entry { id, ts, type, channel, label, platform, url, spend, views, followerDelta, removed, note }
let entries = Object.create(null);
// week-over-week trend points: [{ ts, spend, views, cpm, followers, count }]
let snapshots = [];
let dirty = false;

const TYPES = ["clipper", "placement"];

export async function loadCockpit() {
  const raw = await loadDoc("mb:cockpit", COCKPIT_FILE);
  if (raw && typeof raw === "object" && raw.entries) entries = raw.entries;
  if (Array.isArray(raw?.snapshots)) snapshots = raw.snapshots;
}
export function flushCockpit() {
  if (!dirty) return;
  dirty = false;
  saveDoc("mb:cockpit", COCKPIT_FILE, { entries, snapshots, savedAt: Date.now() }).catch((e) => {
    dirty = true;
    console.warn("[cockpit] save failed:", e.message);
  });
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : 0; };

export function addEntry(e = {}) {
  const id = crypto.randomBytes(6).toString("hex");
  const entry = {
    id,
    ts: Date.now(),
    type: TYPES.includes(e.type) ? e.type : "clipper",
    channel: String(e.channel || "").slice(0, 60),
    label: String(e.label || "").slice(0, 120),
    platform: String(e.platform || "").slice(0, 20),
    url: String(e.url || "").slice(0, 500),
    spend: num(e.spend),
    views: num(e.views),
    followerDelta: Math.round(Number(e.followerDelta) || 0),
    removed: false,
    note: String(e.note || "").slice(0, 280),
  };
  entries[id] = entry;
  dirty = true;
  return entry;
}

// Bulk add — used by CSV import (a Whop/Vyro campaign export). Returns the count.
export function addEntries(arr = []) {
  let n = 0;
  for (const e of arr) {
    if (!e) continue;
    // skip totally empty rows
    if (!String(e.channel || "").trim() && !String(e.label || "").trim() && !num(e.spend) && !num(e.views)) continue;
    addEntry(e);
    n++;
  }
  return n;
}

export function updateEntry(id, patch = {}) {
  const e = entries[id];
  if (!e) return null;
  if (patch.spend != null) e.spend = num(patch.spend);
  if (patch.views != null) e.views = num(patch.views);
  if (patch.followerDelta != null) e.followerDelta = Math.round(Number(patch.followerDelta) || 0);
  if (patch.note != null) e.note = String(patch.note).slice(0, 280);
  if (patch.removed != null) e.removed = !!patch.removed; // "caught a bot, pulled it"
  dirty = true;
  return e;
}

export function deleteEntry(id) {
  if (!entries[id]) return false;
  delete entries[id];
  dirty = true;
  return true;
}

const median = (arr) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const cpm = (spend, views) => (views > 0 ? (spend / views) * 1000 : null); // $ per 1k views
const round = (n, d = 0) => { const f = 10 ** d; return Math.round(n * f) / f; };

// Current rolled-up totals across active entries (shared by summary + snapshot).
function activeTotals() {
  const active = Object.values(entries).filter((e) => !e.removed);
  const spend = active.reduce((s, e) => s + e.spend, 0);
  const views = active.reduce((s, e) => s + e.views, 0);
  const followers = active.reduce((s, e) => s + (e.followerDelta || 0), 0);
  return {
    spend: round(spend, 2),
    views,
    followers,
    count: active.length,
    blendedCpm: views > 0 ? round((spend / views) * 1000, 2) : null,
  };
}

// Snapshot the current week's totals onto the trend, then (optionally) clear the
// ledger so next week starts fresh. The chart reads the snapshot history.
export function addSnapshot({ reset = false } = {}) {
  const t = activeTotals();
  snapshots.push({ ts: Date.now(), spend: t.spend, views: t.views, cpm: t.blendedCpm, followers: t.followers, count: t.count });
  if (snapshots.length > 52) snapshots = snapshots.slice(-52); // keep ~a year of weeks
  if (reset) entries = Object.create(null); // archive the week; start clean
  dirty = true;
  return snapshots[snapshots.length - 1];
}

// The cockpit's computed view: per-entry ROI, totals, spend split, bot flags, and
// the generated weekly report.
export function cockpitSummary() {
  const all = Object.values(entries).sort((a, b) => b.ts - a.ts);
  const active = all.filter((e) => !e.removed);

  // bot tell: reach far CHEAPER than the field (bought views are cheap). Flag
  // entries whose CPM is well below the median of entries that have real numbers.
  const cpms = active.filter((e) => e.spend > 0 && e.views > 0).map((e) => cpm(e.spend, e.views));
  const medCpm = median(cpms);
  const flagThresh = medCpm > 0 ? medCpm * 0.3 : 0;

  const rows = all.map((e) => {
    const c = cpm(e.spend, e.views);
    const vpd = e.spend > 0 ? round(e.views / e.spend, 1) : null; // views per $
    const flagged = !e.removed && flagThresh > 0 && c != null && c < flagThresh && e.views > 0;
    return {
      ...e,
      cpm: c == null ? null : round(c, 2),
      viewsPerDollar: vpd,
      flagged,
      flagReason: flagged ? `CPM $${round(c, 2)} vs median $${round(medCpm, 2)} — abnormally cheap, check for bot views` : null,
    };
  });

  const totalSpend = active.reduce((s, e) => s + e.spend, 0);
  const totalViews = active.reduce((s, e) => s + e.views, 0);
  const totalFollowers = active.reduce((s, e) => s + (e.followerDelta || 0), 0);
  const spendByType = TYPES.map((t) => ({
    type: t,
    spend: round(active.filter((e) => e.type === t).reduce((s, e) => s + e.spend, 0), 2),
  }));
  const byChannelMap = Object.create(null);
  for (const e of active) {
    const k = e.channel || "—";
    byChannelMap[k] = byChannelMap[k] || { channel: k, spend: 0, views: 0 };
    byChannelMap[k].spend += e.spend;
    byChannelMap[k].views += e.views;
  }
  const byChannel = Object.values(byChannelMap)
    .map((c) => ({ ...c, spend: round(c.spend, 2), cpm: c.views > 0 ? round((c.spend / c.views) * 1000, 2) : null }))
    .sort((a, b) => b.spend - a.spend);

  const flags = rows.filter((r) => r.flagged).map((r) => ({ id: r.id, label: r.label || r.channel, reason: r.flagReason }));
  const blendedCpm = totalViews > 0 ? round((totalSpend / totalViews) * 1000, 2) : null;

  // ROI leaderboard — every active line ranked by reach-per-dollar (best first).
  const leaderboard = rows
    .filter((r) => !r.removed && r.viewsPerDollar != null)
    .sort((a, b) => b.viewsPerDollar - a.viewsPerDollar)
    .map((r, i) => ({
      rank: i + 1, id: r.id, label: r.label || r.channel, channel: r.channel, type: r.type,
      spend: r.spend, views: r.views, cpm: r.cpm, viewsPerDollar: r.viewsPerDollar, flagged: r.flagged,
    }));
  const best = leaderboard[0] || null;
  const worst = leaderboard.length > 1 ? leaderboard[leaderboard.length - 1] : null;

  return {
    type: "cockpit",
    rows,
    totals: {
      spend: round(totalSpend, 2),
      views: totalViews,
      blendedCpm,
      followers: totalFollowers,
      costPerFollower: totalFollowers > 0 ? round(totalSpend / totalFollowers, 2) : null,
      count: active.length,
    },
    spendByType,
    byChannel,
    leaderboard,
    snapshots,
    flags,
    report: buildReport({
      totalSpend, totalViews, blendedCpm, totalFollowers, spendByType, flags, byChannel,
      best: best && { label: best.label, views: best.views, spend: best.spend },
      worst: worst && { label: worst.label, views: worst.views, spend: worst.spend },
    }),
  };
}

function buildReport({ totalSpend, totalViews, blendedCpm, totalFollowers, spendByType, best, worst, flags, byChannel }) {
  const fmt = (n) => Number(n || 0).toLocaleString("en-US");
  const clip = spendByType.find((s) => s.type === "clipper")?.spend || 0;
  const place = spendByType.find((s) => s.type === "placement")?.spend || 0;
  const split = totalSpend > 0 ? `${Math.round((clip / totalSpend) * 100)}% clippers / ${Math.round((place / totalSpend) * 100)}% placements` : "—";
  const lines = [
    "MARKET BUBBLE — DISTRIBUTION REPORT",
    "",
    `Spend: $${fmt(round(totalSpend, 2))}  ·  Views: ${fmt(totalViews)}  ·  Blended CPM: ${blendedCpm != null ? "$" + blendedCpm : "—"}`,
    `Follower change: ${totalFollowers >= 0 ? "+" : ""}${fmt(totalFollowers)}`,
    `Spend split: ${split}`,
    "",
    "Top channels by spend:",
    ...byChannel.slice(0, 5).map((c) => `  • ${c.channel}: $${fmt(c.spend)} → ${fmt(c.views)} views${c.cpm != null ? ` ($${c.cpm} CPM)` : ""}`),
    "",
    best ? `Best ROI: ${best.label || best.channel} — ${fmt(best.views)} views for $${fmt(best.spend)} ($${round((best.spend / best.views) * 1000, 2)} CPM)` : "Best ROI: —",
    worst ? `Worst ROI: ${worst.label || worst.channel} — ${fmt(worst.views)} views for $${fmt(worst.spend)} ($${round((worst.spend / worst.views) * 1000, 2)} CPM)` : "",
    "",
    flags.length ? `⚠ ${flags.length} flagged for bot-cheap reach: ${flags.map((f) => f.label).join(", ")}` : "No bot-spike flags.",
  ].filter((l) => l !== "");
  return lines.join("\n");
}
