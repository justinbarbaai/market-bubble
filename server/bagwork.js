import { loadDoc, saveDoc } from "./store.js";
import { xTweetData, xStatusId } from "./sources/clipStats.js";
import { isVerifiedHandle } from "./accounts.js";

// ---- Bagwork: who's creating $ANSEM content on X ----
// Ansem: "will prioritize airdropping $SOL to best bagworkers on socials."
// Members submit their own $ANSEM posts (like clips); the hub verifies the
// AUTHOR is their VERIFIED X handle and the text actually mentions the ticker,
// then tracks public engagement (likes + replies — bot-honest metrics; X keeps
// impressions author-only behind OAuth). Totals show on their profile + the
// Top Bagworkers board, and feed airdrop weight on the quest roster.

const BAGWORK_FILE = new URL("./.mb-bagwork.json", import.meta.url);

// tweetId -> post
let posts = Object.create(null);
let dirty = false;

export async function loadBagwork() {
  const raw = await loadDoc("mb:bagwork", BAGWORK_FILE);
  if (raw && typeof raw === "object" && raw.posts) posts = raw.posts;
}
export function flushBagwork() {
  if (!dirty) return;
  dirty = false;
  saveDoc("mb:bagwork", BAGWORK_FILE, { posts, savedAt: Date.now() }).catch((e) => {
    dirty = true;
    console.warn("[bagwork] save failed:", e.message);
  });
}

// What counts as bagwork — the ticker, the man, or the show.
const TOPIC = /\$?ansem|blknoiz06|market\s?bubble/i;

export async function submitBagwork({ url, mbKey, byName, bySource }, fetcher = fetch) {
  const id = xStatusId(url);
  if (!id) return { ok: false, error: "Drop a link to an X post (x.com/…/status/…)." };
  if (posts[id]) return { ok: false, error: "That post's already been submitted." };
  const t = await xTweetData(url, fetcher);
  if (!t) return { ok: false, error: "Couldn't read that post — is it public?" };
  if (!t.author || !isVerifiedHandle(mbKey, "x", t.author))
    return { ok: false, error: `That post is by @${t.author || "?"} — verify that X handle on your profile first (post your code, 30 seconds).` };
  if (!TOPIC.test(t.text))
    return { ok: false, error: "That post doesn't mention $ANSEM / the show — bagwork has to be on topic." };
  posts[id] = {
    id,
    url: String(url).slice(0, 300),
    by: mbKey,
    byName: String(byName || ""),
    bySource: String(bySource || ""),
    handle: t.author,
    text: t.text.slice(0, 200),
    likes: t.likes,
    replies: t.replies,
    postedAt: t.createdAt || Date.now(),
    submittedAt: Date.now(),
    scannedAt: Date.now(),
  };
  dirty = true;
  return { ok: true, post: publicPost(posts[id]) };
}

function publicPost(p) {
  return {
    id: p.id, url: p.url, by: p.byName || p.by, handle: p.handle,
    text: p.text, likes: p.likes, replies: p.replies, postedAt: p.postedAt,
  };
}

// Refresh engagement on young posts (sweep every 6h, posts < 14 days old).
export async function rescanBagwork(fetcher = fetch) {
  const cutoff = Date.now() - 14 * 86400e3;
  let changed = 0;
  for (const id in posts) {
    const p = posts[id];
    if (p.postedAt < cutoff) continue;
    if (Date.now() - (p.scannedAt || 0) < 5 * 3600e3) continue;
    try {
      const t = await xTweetData(p.url, fetcher);
      if (t) {
        p.likes = t.likes;
        p.replies = t.replies;
        p.scannedAt = Date.now();
        dirty = true;
        changed++;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 800)); // gentle
  }
  return changed;
}

const score = (p) => p.likes + p.replies;

// A member's bagwork (their $ANSEM posts + totals) — profile display.
export function bagworkFor(mbKey) {
  const mine = Object.values(posts).filter((p) => p.by === mbKey);
  if (!mine.length) return null;
  return {
    posts: mine.sort((a, b) => score(b) - score(a)).slice(0, 20).map(publicPost),
    count: mine.length,
    likes: mine.reduce((s, p) => s + p.likes, 0),
    replies: mine.reduce((s, p) => s + p.replies, 0),
    score: mine.reduce((s, p) => s + score(p), 0),
  };
}

// Top Bagworkers — people ranked by total engagement on their $ANSEM posts.
export function bagworkLeaderboard(limit = 20) {
  const agg = Object.create(null);
  for (const id in posts) {
    const p = posts[id];
    const a = agg[p.by] || (agg[p.by] = { key: p.by, name: p.byName || p.by, source: p.bySource, handle: p.handle, posts: 0, likes: 0, replies: 0, score: 0 });
    a.posts++;
    a.likes += p.likes;
    a.replies += p.replies;
    a.score += score(p);
  }
  return Object.values(agg)
    .sort((x, y) => y.score - x.score)
    .slice(0, limit)
    .map((a, i) => ({ rank: i + 1, ...a }));
}

// Bagwork's contribution to airdrop weight (quest roster): 1 weight per 500
// engagement — tune freely, it's display math, not stored.
export function bagworkWeightFor(mbKey) {
  const b = bagworkFor(mbKey);
  return b ? Math.floor(b.score / 500) : 0;
}
