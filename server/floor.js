import { loadDoc, saveDoc } from "./store.js";

// ---- "The Floor" — the cross-platform engagement economy ----
// Viewers earn "Bubbles" just by taking part in the show, on WHATEVER platform
// they watch from (Twitch / Kick / X). The hub already sees every chat message
// from all three, tagged with the platform username — so this layer needs no new
// tracking: it reads the same chat stream the room runs on and keeps a running
// tally keyed by `source:username`.
//
// We reward ENGAGEMENT, not passive watchtime (per-user watchtime is invisible
// on the native platforms — we only get aggregate counts). "Active minutes"
// (minutes in which you chatted) stand in for watchtime, which also makes farming
// pointless: hammering chat is capped per minute.

const FLOOR_FILE = new URL("./.mb-floor.json", import.meta.url);

// Scoring — tuned so showing up + talking earns steadily, and spam can't farm.
const ACTIVE_MINUTE = 10; // first message in a clock-minute (the "I'm here" beat)
const PER_MESSAGE = 1; //    each additional message that minute...
const PER_MINUTE_EXTRA = 4; // ...up to this many (so max 14 Bubbles/min from chat)
const VOTE_BONUS = 25; //    voting in the live prediction poll (once per market)
const DAILY_BONUS = 50; //   first activity of a new day (rewards coming back)

// key -> { name, source, points, msgs, votes, days, firstSeen, lastSeen,
//          day, min, minCount, votePoll }
let users = Object.create(null);
let dirty = false;

function dayStr(ts) {
  return new Date(ts).toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}
function minuteOf(ts) {
  return Math.floor(ts / 60000);
}

export async function loadFloor() {
  const raw = await loadDoc("mb:floor", FLOOR_FILE);
  if (raw && typeof raw === "object" && raw.users) users = raw.users;
}

export function flushFloor() {
  if (!dirty) return;
  dirty = false;
  saveDoc("mb:floor", FLOOR_FILE, { users, savedAt: Date.now() }).catch((e) => {
    dirty = true; // retry on the next tick if the save failed
    console.warn("[floor] save failed:", e.message);
  });
}

function rec(key, source, name) {
  let u = users[key];
  if (!u) {
    u = {
      name,
      source,
      points: 0,
      msgs: 0,
      votes: 0,
      days: 0,
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      day: "",
      min: 0,
      minCount: 0,
      votePoll: "",
    };
    users[key] = u;
  }
  if (name) u.name = name; // names can change; keep the latest
  return u;
}

// Award points for a chat message. Returns true if any points changed (so the
// caller can schedule a leaderboard broadcast). Only real chat reaches here.
export function recordMessage(msg) {
  const username = String(msg.username || "").trim();
  if (!username) return false;
  const source = String(msg.source || "");
  if (source !== "twitch" && source !== "kick" && source !== "x") return false;
  const key = `${source}:${username.toLowerCase()}`;
  const now = Date.now();
  const u = rec(key, source, username);
  u.lastSeen = now;
  u.msgs++;

  let gained = 0;

  // Daily return bonus — first activity of a new day.
  const d = dayStr(now);
  if (u.day !== d) {
    u.day = d;
    u.days++;
    gained += DAILY_BONUS;
  }

  // Active-minute + capped chatting.
  const m = minuteOf(now);
  if (u.min !== m) {
    u.min = m;
    u.minCount = 0;
    gained += ACTIVE_MINUTE;
  } else if (u.minCount < PER_MINUTE_EXTRA) {
    u.minCount++;
    gained += PER_MESSAGE;
  }

  if (gained > 0) {
    u.points += gained;
    dirty = true;
    return true;
  }
  return false;
}

// Award the prediction-poll bonus, once per market (pollId). Called when a NEW
// vote is recorded in the poll tally.
export function recordVote(key, source, username, pollId) {
  if (!key || !pollId) return false;
  const u = rec(key, source, String(username || ""));
  if (u.votePoll === pollId) return false; // already paid for this market
  u.votePoll = pollId;
  u.votes++;
  u.points += VOTE_BONUS;
  u.lastSeen = Date.now();
  dirty = true;
  return true;
}

// Credit an arbitrary Bubble amount to a member — used by features outside chat
// (e.g. an approved clip in Clip-to-Earn). Idempotency is the caller's job; pass
// a positive amount. Returns the new balance.
export function awardBubbles(key, source, name, amount) {
  const amt = Math.round(Number(amount) || 0);
  if (!key || amt === 0) return null;
  const u = rec(key, source, String(name || ""));
  u.points += amt;
  u.lastSeen = Date.now();
  dirty = true;
  return u.points;
}

// Read a single member's balance (null if unknown).
export function balanceOf(key) {
  const u = users[key];
  return u ? u.points : null;
}

// A member's Floor standing for their public profile card: balance, live rank,
// tenure. Rank is computed on demand (same ordering as the leaderboard).
export function memberStats(key) {
  const u = users[key];
  if (!u) return null;
  let rank = 1;
  for (const k in users) {
    const o = users[k];
    if (o.points > u.points || (o.points === u.points && o.msgs > u.msgs)) rank++;
  }
  return {
    points: u.points,
    rank,
    msgs: u.msgs,
    days: u.days,
    firstSeen: u.firstSeen,
  };
}

// Leaderboard snapshot for the room panel: the top N + the totals.
export function floorPayload(n = 12) {
  const all = Object.values(users);
  let bubbles = 0;
  for (const u of all) bubbles += u.points;
  const top = all
    .sort((a, b) => b.points - a.points || b.msgs - a.msgs)
    .slice(0, n)
    .map((u, i) => ({
      rank: i + 1,
      name: u.name,
      source: u.source,
      points: u.points,
    }));
  return {
    type: "floor",
    floor: {
      top,
      users: all.length,
      bubbles,
    },
  };
}
