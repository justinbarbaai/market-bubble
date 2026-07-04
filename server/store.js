import fs from "node:fs";

// ---- Durable key/value store ----
// Render's filesystem is EPHEMERAL — it's wiped on every deploy / restart / idle
// spin-down, so the hub's JSON files (Bubbles, clips, accounts, cockpit) reset.
// This layer saves to Upstash Redis (free, durable, HTTP REST) when configured,
// and falls back to a local file for dev. Set in the hub env:
//   UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
const REST_URL = (process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/+$/, "");
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || "";
export const DURABLE = !!(REST_URL && REST_TOKEN);

const TIMEOUT = 8000;

// ---- health ----
// The July 2026 incident: the Upstash DB was deleted out from under us and the
// silent file fallback made "durable" storage quietly ephemeral for days —
// every deploy wiped prod. Never silent again: every Redis failure is tracked
// here, exposed on /status, and shown red on the Studio health strip.
const health = {
  lastOkAt: 0,
  lastErrorAt: 0,
  lastError: null,
  fails: 0, // consecutive failures
};
export function storeHealth() {
  return {
    durable: DURABLE,
    // ok=false means Redis is configured but its last operation FAILED —
    // writes are landing on the ephemeral disk and will die with the dyno.
    ok: DURABLE ? health.fails === 0 : null,
    lastOkAt: health.lastOkAt || null,
    lastError: health.lastError,
    lastErrorAt: health.lastErrorAt || null,
    consecutiveFails: health.fails,
  };
}
function markOk() {
  health.lastOkAt = Date.now();
  health.fails = 0;
}
function markFail(op, key, e) {
  health.fails++;
  health.lastErrorAt = Date.now();
  health.lastError = `${op} ${key}: ${e.message}`;
  // console.error (not warn) so it stands out in Render logs; every failure —
  // a dead store is an incident, not noise.
  console.error(`[store] REDIS ${op.toUpperCase()} FAILED for ${key}: ${e.message} — durable storage is DOWN, state is falling back to the ephemeral disk`);
}

async function redisGet(key) {
  const r = await fetch(`${REST_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${REST_TOKEN}` },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!r.ok) throw new Error(`get ${r.status}`);
  const j = await r.json();
  return j.result; // the stored string, or null
}

async function redisSet(key, value) {
  // Upstash REST: POST /set/<key> with the value as the request body.
  const r = await fetch(`${REST_URL}/set/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${REST_TOKEN}` },
    body: value,
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!r.ok) throw new Error(`set ${r.status}`);
}

// Load a JSON doc by key. Tries Redis (if configured), falls back to the local
// file. Returns the parsed object, or null if absent/unreadable.
export async function loadDoc(key, file) {
  if (DURABLE) {
    try {
      const s = await redisGet(key);
      markOk();
      if (s) return JSON.parse(s);
      return null;
    } catch (e) {
      markFail("load", key, e);
    }
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

// Save a JSON doc. Writes to Redis when configured (durable), else the local
// file. Returns a promise; callers may fire-and-forget on a timer.
// Even when Redis is configured, the file is ALSO written on failure so a
// restart-without-deploy at least keeps recent state — but that path is a
// degraded mode, and storeHealth() reports it.
export async function saveDoc(key, file, obj) {
  const s = JSON.stringify(obj);
  if (DURABLE) {
    try {
      await redisSet(key, s);
      markOk();
      return;
    } catch (e) {
      markFail("save", key, e);
    }
  }
  try {
    fs.writeFileSync(file, s);
  } catch (e) {
    console.warn(`[store] file save ${key} failed: ${e.message}`);
  }
}
