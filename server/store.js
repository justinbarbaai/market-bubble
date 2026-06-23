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
      if (s) return JSON.parse(s);
      return null;
    } catch (e) {
      console.warn(`[store] redis load ${key} failed (${e.message}) — falling back to file`);
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
export async function saveDoc(key, file, obj) {
  const s = JSON.stringify(obj);
  if (DURABLE) {
    try {
      await redisSet(key, s);
      return;
    } catch (e) {
      console.warn(`[store] redis save ${key} failed (${e.message}) — falling back to file`);
    }
  }
  try {
    fs.writeFileSync(file, s);
  } catch (e) {
    console.warn(`[store] file save ${key} failed: ${e.message}`);
  }
}
