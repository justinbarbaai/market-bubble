import { fetchClipStats, SCANNABLE } from "./sources/clipStats.js";
import {
  clipsForScan,
  recordClipScan,
  setClipTrust,
  setClipViews,
  markAutoApproved,
  authorMedianViews,
  decideClip,
} from "./clips.js";

// ---- Clip-to-Earn automation ----
// The "agent that sorts the clips": every cycle it reads each active clip's real
// numbers off the platform, scores them for bot smell, and routes:
//   clean + enough views  → auto-approve (tier by reach) → leaderboard + Bubbles
//   suspicious            → stays for HUMAN review, evidence attached
//   unscannable platform  → human lane untouched (TikTok / IG / blocked)
// Approved clips keep getting re-scanned while young, so views stay live on the
// leaderboard and post-approval botting gets caught and re-flagged.

const SCAN_EVERY_MS = 6 * 3600e3; // full sweep cadence
const RESCAN_MIN_MS = 5 * 3600e3; // don't re-hit a clip more often than this
const AUTO_MIN_VIEWS = 1000; // below this a clip just waits (or a human decides)
const FLAG_AT = 40; // suspicion score that demands a human

// Reach → tier (matches the manual brackets the operator has been using).
export function tierForViews(views) {
  if (views >= 500000) return "S";
  if (views >= 100000) return "A";
  return "B";
}

// Pure scoring — returns { score, reasons } from the clip's snapshots + the
// author's track record. Signals bots can't fake cheaply:
//   1. views without engagement   2. step-function velocity   3. author outlier
export function scoreClip({ history = [], createdAt = Date.now(), authorMedian = null }) {
  const reasons = [];
  let score = 0;
  const last = history[history.length - 1];
  if (!last || last.views == null) return { score, reasons };

  // 1) engagement ratio — organic clips run ~1%+ likes/views; bots run ~0.
  if (last.likes != null && last.views >= 10000) {
    const eng = (last.likes + (last.comments || 0)) / last.views;
    if (eng < 0.001) {
      score += 45;
      reasons.push(`engagement ${(eng * 100).toFixed(2)}% on ${last.views.toLocaleString("en-US")} views — organic clips run ~1%+`);
    } else if (eng < 0.004 && last.views >= 50000) {
      score += 25;
      reasons.push(`thin engagement ${(eng * 100).toFixed(2)}% for ${last.views.toLocaleString("en-US")} views`);
    }
  }

  // 2) velocity — organic curves decay; bought views arrive as a vertical step.
  const withViews = history.filter((h) => h.views != null);
  if (withViews.length >= 3) {
    const deltas = [];
    for (let i = 1; i < withViews.length; i++) deltas.push(withViews[i].views - withViews[i - 1].views);
    const lastDelta = deltas[deltas.length - 1];
    const priorMax = Math.max(1, ...deltas.slice(0, -1));
    const ageDays = (Date.now() - createdAt) / 86400e3;
    if (ageDays > 2 && lastDelta > 50000 && lastDelta > 3 * priorMax) {
      score += 35;
      reasons.push(`+${lastDelta.toLocaleString("en-US")} views in one scan window on a ${Math.round(ageDays)}-day-old clip (prior peak ${priorMax.toLocaleString("en-US")})`);
    }
  }

  // 3) author outlier — 30× their own median reach is a signal, not a miracle.
  if (authorMedian != null && authorMedian > 0 && last.views > 30 * authorMedian) {
    score += 20;
    reasons.push(`${Math.round(last.views / authorMedian)}× this member's median reach (${Math.round(authorMedian).toLocaleString("en-US")})`);
  }

  return { score, reasons };
}

// One sweep over everything scannable. deps: { twitchCreds, onAward, onChange }.
export async function scanClips(deps = {}) {
  const list = clipsForScan();
  let changed = 0;
  for (const clip of list) {
    if (!SCANNABLE.includes(clip.platform)) continue;
    if (clip.scannedAt && Date.now() - clip.scannedAt < RESCAN_MIN_MS) continue;
    const did = await scanOneClip(clip.id, clip, deps);
    if (did) changed++;
  }
  if (changed > 0) deps.onChange?.();
  return changed;
}

// Scan a single clip (also called right after submit for instant feedback).
export async function scanOneClip(id, clip, { twitchCreds, onAward } = {}) {
  const stats = await fetchClipStats(clip.platform, clip.url, { twitchCreds });
  if (!stats) return false; // blocked/unscannable → human lane, untouched
  const c = recordClipScan(id, stats);
  if (!c) return false;

  const { score, reasons } = scoreClip({
    history: c.history,
    createdAt: c.createdAt,
    authorMedian: authorMedianViews(c.by, id),
  });
  const flagged = score >= FLAG_AT;
  setClipTrust(id, { score, reasons, flaggedAt: flagged ? Date.now() : null });

  if (c.status === "pending") {
    // clean + real reach → straight onto the leaderboard, Bubbles paid.
    if (!flagged && stats.views != null && stats.views >= AUTO_MIN_VIEWS) {
      const out = decideClip(id, { action: "approve", tier: tierForViews(stats.views), views: stats.views });
      if (out.ok) {
        markAutoApproved(id);
        if (out.award) onAward?.(out.award);
      }
    }
    // flagged or too small → stays pending; the Studio queue shows the evidence.
  } else if (c.status === "approved" && stats.views != null) {
    // keep the leaderboard live; the flag (if any) is already recorded above and
    // shows in Studio — a human decides whether to pull it.
    setClipViews(id, Math.max(c.views, stats.views));
  }
  return true;
}

let timer = null;
export function startClipScanner(deps) {
  if (timer) return;
  // first sweep shortly after boot (let sources settle), then the slow cadence
  setTimeout(() => scanClips(deps).catch(() => {}), 30e3);
  timer = setInterval(() => scanClips(deps).catch(() => {}), SCAN_EVERY_MS);
  timer.unref?.();
}
