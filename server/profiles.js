import { loadDoc, saveDoc } from "./store.js";

// ---- Member profiles: crypto payout addresses + social links ----
// A Market Bubble member (their sign-in = mbKey "source:username", the SAME key
// The Floor + clips use) can add:
//   • crypto addresses (SOL / ETH / BTC) — so the show can send GIVEAWAY winnings
//     and clip bounties. These are PUBLIC receive addresses only — never keys,
//     never wallet-connect/signing. Nothing here can move a member's funds.
//   • social links (X / TikTok / Instagram / Discord / website) — so Banks & Ansem
//     can find + tag the top fans and clippers.
// The operator (Studio Roster) reads these; they're not exposed to other viewers.

const PROFILES_FILE = new URL("./.mb-profiles.json", import.meta.url);

// mbKey -> { source, name, wallets:{sol,eth,btc}, socials:{x,tiktok,instagram,discord,website}, updatedAt }
let profiles = Object.create(null);
// aliasKey -> primaryKey. One person, two chat identities: when a viewer proves
// they own BOTH (signed into Twitch and Kick), the identities link — one
// profile, shown on both platforms' chat cards. Bubbles stay per-identity.
let aliases = Object.create(null);
let dirty = false;

export async function loadProfiles() {
  const raw = await loadDoc("mb:profiles", PROFILES_FILE);
  if (raw && typeof raw === "object" && raw.profiles) profiles = raw.profiles;
  if (raw?.aliases && typeof raw.aliases === "object") aliases = raw.aliases;
}
export function flushProfiles() {
  if (!dirty) return;
  dirty = false;
  saveDoc("mb:profiles", PROFILES_FILE, { profiles, aliases, savedAt: Date.now() }).catch((e) => {
    dirty = true;
    console.warn("[profiles] save failed:", e.message);
  });
}

// Follow an alias to the identity that actually holds the profile doc.
const resolveKey = (mbKey) => aliases[mbKey] || mbKey;

// Link `other` to `primary` (both PROVEN by the caller — never trust a claim).
// Any profile `other` already had merges into primary (primary's fields win).
export function linkProfiles(primary, other) {
  primary = resolveKey(primary);
  if (!primary || !other || other === primary) return;
  const po = profiles[other];
  if (po) {
    const pp = profiles[primary] || (profiles[primary] = { wallets: {}, socials: {} });
    pp.wallets = { ...(po.wallets || {}), ...(pp.wallets || {}) };
    pp.socials = { ...(po.socials || {}), ...(pp.socials || {}) };
    pp.updatedAt = Date.now();
    delete profiles[other];
  }
  aliases[other] = primary;
  // repoint anything that aliased to `other`
  for (const k in aliases) if (aliases[k] === other) aliases[k] = primary;
  delete aliases[primary]; // a primary must never itself be an alias
  dirty = true;
}

// --- validation ---------------------------------------------------------------
// Address formats (loose but enough to catch a typo'd giveaway address).
const WALLET_RE = {
  sol: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
  eth: /^0x[a-fA-F0-9]{40}$/,
  btc: /^(bc1[a-z0-9]{25,90}|[13][a-km-zA-HJ-NP-Z1-9]{25,39})$/,
};
const WALLET_CHAINS = Object.keys(WALLET_RE);

// Socials that are a bare @handle we turn into a link.
const HANDLE_SOCIALS = {
  x: (h) => `https://x.com/${h}`,
  tiktok: (h) => `https://www.tiktok.com/@${h}`,
  instagram: (h) => `https://www.instagram.com/${h}`,
};
const normHandle = (h) => String(h || "").trim().replace(/^@+/, "").replace(/\s+/g, "").slice(0, 40);
const isHandle = (h) => /^[A-Za-z0-9_.]{1,40}$/.test(h);
// Discord usernames: new (letters/digits/_/. ) or legacy name#1234.
const normDiscord = (h) => String(h || "").trim().replace(/\s+/g, "").slice(0, 40);
const isDiscord = (h) => /^[A-Za-z0-9_.#]{2,40}$/.test(h);

// A website: require a real http(s) URL. Prepend https:// if scheme-less. Reject
// javascript:/data:/etc so an operator-rendered link can never be an XSS vector.
function cleanWebsite(v) {
  const s = String(v || "").trim().slice(0, 200);
  if (!s) return { ok: true, value: null };
  let u;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`); } catch { return { ok: false }; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false };
  return { ok: true, value: u.href };
}

// Merge a patch into a member's profile. Returns { ok, profile, invalid:[fields] }.
// Invalid fields are reported (so the UI can flag them) and simply NOT stored —
// a member's other good fields still save.
export function setProfile(mbKey, { source, name, wallets = {}, socials = {} } = {}) {
  if (!mbKey) return { ok: false, error: "Sign in first." };
  mbKey = resolveKey(mbKey); // edits under a linked identity land on the one profile
  const p = profiles[mbKey] || { wallets: {}, socials: {} };
  p.source = String(source || p.source || "").slice(0, 20);
  if (name) p.name = String(name).trim().slice(0, 60);
  p.wallets = p.wallets || {};
  p.socials = p.socials || {};
  const invalid = [];

  for (const chain of WALLET_CHAINS) {
    if (!(chain in wallets)) continue;
    const raw = String(wallets[chain] || "").trim().slice(0, 120);
    if (!raw) { delete p.wallets[chain]; continue; }      // cleared
    if (WALLET_RE[chain].test(raw)) p.wallets[chain] = raw;
    else invalid.push(chain);                              // keep old, flag it
  }

  for (const net of Object.keys(HANDLE_SOCIALS)) {
    if (!(net in socials)) continue;
    const h = normHandle(socials[net]);
    if (!h) { delete p.socials[net]; continue; }
    if (isHandle(h)) p.socials[net] = h;
    else invalid.push(net);
  }
  if ("discord" in socials) {
    const d = normDiscord(socials.discord);
    if (!d) delete p.socials.discord;
    else if (isDiscord(d)) p.socials.discord = d;
    else invalid.push("discord");
  }
  if ("website" in socials) {
    const w = cleanWebsite(socials.website);
    if (!w.ok) invalid.push("website");
    else if (w.value === null) delete p.socials.website;
    else p.socials.website = w.value;
  }

  p.updatedAt = Date.now();
  profiles[mbKey] = p;
  dirty = true;
  return { ok: true, profile: publicProfile(p), invalid };
}

// Shape a stored profile for the client: addresses as-is, handle-socials expanded
// into { handle, url }, empties omitted.
export function publicProfile(p) {
  if (!p) return null;
  const wallets = {};
  for (const chain of WALLET_CHAINS) if (p.wallets?.[chain]) wallets[chain] = p.wallets[chain];
  const socials = {};
  for (const net of Object.keys(HANDLE_SOCIALS)) {
    if (p.socials?.[net]) socials[net] = { handle: p.socials[net], url: HANDLE_SOCIALS[net](p.socials[net]) };
  }
  if (p.socials?.discord) socials.discord = { handle: p.socials.discord };
  if (p.socials?.website) socials.website = { url: p.socials.website };
  return { source: p.source || null, name: p.name || null, wallets, socials, updatedAt: p.updatedAt || null };
}

export function getProfile(mbKey) {
  const k = resolveKey(mbKey);
  return profiles[k] ? publicProfile(profiles[k]) : null;
}

// Socials for the public member card in chat.
export function publicSocials(mbKey) {
  const pp = getProfile(mbKey);
  if (!pp || Object.keys(pp.socials).length === 0) return null;
  return pp.socials;
}

// Giveaway addresses for the public card too — receive-only addresses the member
// added precisely so the show (and the room) can see where to send winnings.
// Like putting your SOL address in your bio: public by intent, can't move funds.
export function publicWallets(mbKey) {
  const pp = getProfile(mbKey);
  if (!pp || Object.keys(pp.wallets).length === 0) return null;
  return pp.wallets;
}

// Whether a profile has anything worth showing an operator.
const hasContent = (pp) => pp && (Object.keys(pp.wallets).length > 0 || Object.keys(pp.socials).length > 0);

// Everyone who has filled in a profile → [{ key, profile }]. The route enriches
// with each member's current Bubble balance for the ranked Roster.
export function profileEntries() {
  return Object.entries(profiles)
    .map(([key, p]) => ({ key, profile: publicProfile(p) }))
    .filter((e) => hasContent(e.profile));
}
