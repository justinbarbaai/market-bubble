import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---- Durable key/value store ----
// Render's DEFAULT filesystem is EPHEMERAL — wiped on every deploy / restart /
// idle spin-down, so the hub's JSON files (Bubbles, clips, accounts, cockpit)
// reset. Two ways to be durable, either works:
//   • STATE_DIR=/data — a Render persistent disk mounted there (paid instance).
//     Files land on the disk and survive deploys. Simplest, no external deps.
//   • UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN — Upstash Redis REST.
// With neither, files sit next to the code (fine for local dev only).
const REST_URL = (process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/+$/, "");
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || "";
const STATE_DIR = (process.env.STATE_DIR || "").trim();
if (STATE_DIR) {
  try { fs.mkdirSync(STATE_DIR, { recursive: true }); } catch {}
}
export const DURABLE = !!(REST_URL && REST_TOKEN) || !!STATE_DIR;

// Modules pass their default file location (a URL beside the code); when
// STATE_DIR is set we redirect the SAME basename onto the persistent disk.
function resolveFile(file) {
  if (!STATE_DIR) return file;
  const p = typeof file === "string" ? file : fileURLToPath(file);
  return path.join(STATE_DIR, path.basename(p));
}

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
    mode: REST_URL && REST_TOKEN ? "redis" : STATE_DIR ? "disk" : "none",
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

const REDIS = !!(REST_URL && REST_TOKEN);

// Load a JSON doc by key. Tries Redis (if configured), falls back to the file —
// which lives on the persistent disk when STATE_DIR is set.
export async function loadDoc(key, file) {
  if (REDIS) {
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
    return JSON.parse(fs.readFileSync(resolveFile(file), "utf8"));
  } catch {
    return null;
  }
}

// Save a JSON doc. Redis when configured; otherwise (or on Redis failure) the
// file — durable if it's on the STATE_DIR disk, ephemeral scratch if not.
// A failed write to the persistent disk is a durability incident too.
export async function saveDoc(key, file, obj) {
  const s = JSON.stringify(obj);
  if (REDIS) {
    try {
      await redisSet(key, s);
      markOk();
      return;
    } catch (e) {
      markFail("save", key, e);
    }
  }
  try {
    fs.writeFileSync(resolveFile(file), s);
    if (!REDIS && STATE_DIR) markOk();
  } catch (e) {
    if (STATE_DIR) markFail("save-file", key, e);
    else console.warn(`[store] file save ${key} failed: ${e.message}`);
  }
}
