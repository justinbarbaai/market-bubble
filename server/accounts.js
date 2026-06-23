import fs from "node:fs";
import crypto from "node:crypto";
import { detectPlatform } from "./clips.js";

// ---- Connected clip accounts (identity / "prove it's the same person") ----
// A Market Bubble member (their Twitch/Kick sign-in = mbKey "source:username") can
// link the OUTSIDE accounts they clip from — TikTok, YouTube, etc. Linking proves
// the same person owns both, WITHOUT waiting on any platform's OAuth dev review:
//
//   1. member enters their handle  -> we issue a one-time code (MB-XXXXXX)
//   2. member posts a clip whose CAPTION contains that code
//   3. we read the clip back via the platform's public oEmbed endpoint and confirm
//      the clip's AUTHOR == the claimed handle AND the caption contains the code
//   -> the handle is now verified-linked to that member.
//
// oEmbed also hands us the author + caption on every future submission, so a clip
// can be auto-attributed to its real creator (nobody submits someone else's clip).
// (View counts still need the platform APIs — that's the only thing gated on the
// dev-app approvals; ownership is fully solved here.)

const ACCOUNTS_FILE = new URL("./.mb-accounts.json", import.meta.url);

// Platforms whose public oEmbed returns author + caption (so we can auto-verify).
const OEMBED = {
  tiktok: (url) => `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`,
  youtube: (url) => `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
};
export const VERIFIABLE = Object.keys(OEMBED); // auto-verify via oEmbed
// X + Instagram have no usable public oEmbed → connect the handle, but ownership
// is confirmed by the operator when they review the clip (the approval queue is
// the real gate). YouTube also covers Shorts (same domain).
export const MANUAL = ["x", "instagram"];
export const CONNECTABLE = [...VERIFIABLE, ...MANUAL];

// mbKey -> { "platform:handle": { platform, handle, code, verified, createdAt, verifiedAt } }
let links = Object.create(null);
let dirty = false;

export function loadAccounts() {
  try {
    const raw = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, "utf8"));
    if (raw && typeof raw === "object" && raw.links) links = raw.links;
  } catch {
    /* none yet */
  }
}
export function flushAccounts() {
  if (!dirty) return;
  try {
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify({ links, savedAt: Date.now() }));
    dirty = false;
  } catch (e) {
    console.warn("[accounts] save failed:", e.message);
  }
}

const normHandle = (h) => String(h || "").trim().replace(/^@/, "").toLowerCase();

// Pull the @handle out of an oEmbed author_url (tiktok.com/@x, youtube.com/@x).
function handleFromAuthorUrl(url) {
  try {
    const m = new URL(url).pathname.match(/@([^/?#]+)/);
    return m ? m[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

// Fetch a clip's public oEmbed → { author, authorUrl, caption } (null on failure).
// Injectable fetcher keeps this testable without the network.
export async function oembed(platform, url, fetcher = fetch) {
  const build = OEMBED[platform];
  if (!build) return null;
  try {
    const r = await fetcher(build(url), {
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "Mozilla/5.0 (MarketBubble)" },
    });
    if (!r.ok) return null;
    const j = await r.json();
    return { author: handleFromAuthorUrl(j.author_url || ""), authorUrl: j.author_url || "", caption: String(j.title || "") };
  } catch {
    return null;
  }
}

const keyOf = (platform, handle) => `${platform}:${normHandle(handle)}`;

// Step 1: a member claims a handle → issue (or re-issue) a verification code.
export function issueCode(mbKey, platform, handle) {
  const h = normHandle(handle);
  if (!mbKey) return { ok: false, error: "Sign in first." };
  if (!CONNECTABLE.includes(platform)) return { ok: false, error: "Unsupported platform." };
  if (!h) return { ok: false, error: "Enter your handle." };
  const k = keyOf(platform, h);
  const mine = (links[mbKey] = links[mbKey] || Object.create(null));
  // taken (verified) by someone else?
  for (const owner in links) {
    if (owner !== mbKey && links[owner][k]?.verified) return { ok: false, error: "That account is already linked to someone else." };
  }
  const existing = mine[k];
  if (existing?.verified) return { ok: true, verified: true, manual: !VERIFIABLE.includes(platform) };
  // X / Instagram: no public oEmbed to read → register the handle; the operator
  // confirms ownership when reviewing the clip.
  if (!VERIFIABLE.includes(platform)) {
    mine[k] = { platform, handle: h, code: null, verified: false, manual: true, createdAt: existing?.createdAt || Date.now(), verifiedAt: null };
    dirty = true;
    return { ok: true, manual: true };
  }
  const code = existing?.code || "MB-" + crypto.randomBytes(3).toString("hex").toUpperCase();
  mine[k] = { platform, handle: h, code, verified: false, manual: false, createdAt: existing?.createdAt || Date.now(), verifiedAt: null };
  dirty = true;
  return { ok: true, code, verified: false };
}

// Step 3: confirm a clip whose caption carries the member's code, authored by the
// claimed handle → mark the link verified.
export async function verifyAccount(mbKey, platform, handle, clipUrl, fetcher = fetch) {
  const mine = links[mbKey];
  const k = keyOf(platform, handle);
  const link = mine?.[k];
  if (!link) return { ok: false, error: "Request a code for this account first." };
  if (link.verified) return { ok: true, verified: true };
  if (detectPlatform(clipUrl) !== platform) return { ok: false, error: `That link isn't a ${platform} clip.` };
  const data = await oembed(platform, clipUrl, fetcher);
  if (!data) return { ok: false, error: "Couldn't read that clip — check the link is public." };
  if (data.author !== normHandle(handle)) return { ok: false, error: `That clip is by @${data.author || "?"}, not @${normHandle(handle)}.` };
  if (!data.caption.toUpperCase().includes(link.code)) return { ok: false, error: `Add your code ${link.code} to the clip's caption, then verify.` };
  link.verified = true;
  link.verifiedAt = Date.now();
  dirty = true;
  return { ok: true, verified: true };
}

// A member's linked accounts (codes hidden once verified).
export function accountsFor(mbKey) {
  const mine = links[mbKey] || {};
  return Object.values(mine).map((l) => ({
    platform: l.platform,
    handle: l.handle,
    verified: l.verified,
    manual: !!l.manual,
    code: l.verified || l.manual ? null : l.code,
  }));
}

// Is this author handle a VERIFIED account of this member? (clip auto-attribution)
export function isVerifiedHandle(mbKey, platform, handle) {
  const l = links[mbKey]?.[keyOf(platform, handle)];
  return !!l?.verified;
}
