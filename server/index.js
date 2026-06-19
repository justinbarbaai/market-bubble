import "dotenv/config";
import http from "node:http";
import fs from "node:fs";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { WebSocketServer } from "ws";
import { TwitchSource } from "./sources/twitch.js";
import { KickSource } from "./sources/kick.js";
import { SOURCE_COLORS, unifiedMessage } from "./sources/constants.js";
import { EmoteResolver } from "./sources/emoteResolver.js";
import { TwitchBadgeResolver } from "./sources/twitchBadges.js";
import { fetchViewerSnapshot, fetchXLive } from "./sources/viewers.js";
import { fetchContent } from "./sources/content.js";
import { fetchEmoteList } from "./sources/emoteList.js";
import { fetchKickContent } from "./sources/kickContent.js";
import { fetchTweets } from "./sources/tweets.js";
import { fetchMarkets } from "./sources/markets.js";
import { fetchProfile } from "./sources/profiles.js";
import { fetchSocials } from "./sources/socials.js";
import {
  kickConfigured,
  kickConnected,
  disconnectKick,
  buildKickLoginUrl,
  buildKickUserLoginUrl,
  handleKickCallback,
  kickSessionInfo,
  disconnectKickSession,
  kickBan,
  kickSend,
  kickSendAs,
} from "./sources/kickAuth.js";

const PORT = Number(process.env.PORT) || 8080;

function splitChannels(value) {
  return String(value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Live config — seeded from env, mutable from the UI. Twitch/Kick each support
// multiple channels; X is a single search query/rule.
const config = {
  twitchChannels: splitChannels(process.env.TWITCH_CHANNEL),
  kickChannels: splitChannels(process.env.KICK_CHANNEL),
  xQuery: process.env.X_QUERY || "",
  // Handle whose native X "Live" broadcast we count concurrent viewers for.
  xLiveHandle: process.env.X_LIVE_HANDLE || "",
};

const kickOpts = {
  pusherKey: process.env.KICK_PUSHER_KEY || "32cbd69e4b950bf97679",
  cluster: process.env.KICK_PUSHER_CLUSTER || "us2",
  // Manual overrides for when Cloudflare blocks the kick.com channel lookup
  // from the host (datacenter IPs often are). Chatroom id feeds the Pusher
  // subscription; broadcaster id is what chat-send/moderation need.
  chatroomId: process.env.KICK_CHATROOM_ID || null,
  userId: process.env.KICK_BROADCASTER_ID || null,
};
// The env id overrides belong to the SHOW's kick channel only — any other
// channel (e.g. a viewer's own merge) must resolve its own ids.
function kickOptsFor(ch) {
  const show = (config.kickChannels[0] || "").trim().toLowerCase();
  return String(ch).trim().toLowerCase() === show
    ? kickOpts
    : { ...kickOpts, chatroomId: null, userId: null };
}
const xOpts = {
  bearerToken: process.env.X_BEARER_TOKEN || "",
};
// Twitch Helix app credentials (optional) — enable live viewer counts. Kick
// counts work without any credentials.
const twitchCreds = {
  clientId: process.env.TWITCH_CLIENT_ID || "",
  clientSecret: process.env.TWITCH_CLIENT_SECRET || "",
};
// Kick OAuth app (optional) — enables connecting a Kick account to send chat and
// moderate (timeout/ban). Reading Kick chat needs none of this.
const kickCreds = {
  clientId: process.env.KICK_CLIENT_ID || "",
  clientSecret: process.env.KICK_CLIENT_SECRET || "",
};
const KICK_REDIRECT_URI =
  process.env.KICK_REDIRECT_URI || `http://localhost:${PORT}/auth/kick/callback`;
const WEB_ORIGIN = process.env.WEB_ORIGIN || "http://localhost:3000";

// ---- access control ----
// Browser origins allowed to open a WebSocket to this hub. Defaults to the web
// origin; set ALLOWED_ORIGINS=https://a.com,https://b.com to allow more.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || WEB_ORIGIN)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
// Validate a post-OAuth return target: origin must be allowlisted; a clean
// path may ride along (no query/fragment). Returns "origin/path" or null.
function sanitizeReturn(ret) {
  if (!ret) return null;
  try {
    const u = new URL(ret);
    if (!ALLOWED_ORIGINS.includes(u.origin)) return null;
    if (u.search || u.hash) return null;
    return u.origin + (u.pathname === "/" || !u.pathname ? "/" : u.pathname);
  } catch {
    return null;
  }
}

// Secret that grants OPERATOR privileges over the WS (reconfigure channels, set
// the global chat look, send/moderate as the operator account, set the X token).
// Set a long random value in .env before deploying. If empty, operator actions
// are DISABLED entirely (safe default) — the studio just won't be able to push.
const OPERATOR_KEY = process.env.OPERATOR_KEY || "";
// A SEPARATE, limited secret for the X bookmarklet to push live numbers + X
// broadcast chat. If it leaks, the worst case is spoofed X data — never
// control of the show (that needs OPERATOR_KEY).
const INGEST_KEY = process.env.INGEST_KEY || "";
function ingestKeyOk(key) {
  if (!INGEST_KEY || !key) return false;
  const a = Buffer.from(String(key));
  const b = Buffer.from(INGEST_KEY);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
// X live-viewer counts pushed by the extension — ONE entry per broadcast tab
// (Banks / Ansem / Market Bubble), keyed by host. X killed the public endpoints,
// so these pushes are the only accurate source. Combined into one bar number +
// a who-it's-from breakdown by aggregateXLive().
let xLiveByHost = Object.create(null); // host -> { viewers, live, ts }
let lastXLiveAt = 0; // most recent xlive push from any host (health strip)
// A host's count is trusted this long after its last push. The extension pushes
// every 5s when its tab runs full-rate, but Chrome THROTTLES hidden/occluded
// background tabs (a broadcast window behind a fullscreen show, or just not in
// front) so their pushes slow to every 30-60s even with the worker timer. A
// short window made those hosts flicker out between throttled pushes. 90s keeps
// every still-open broadcast continuously "live" through the throttling; the
// only cost is an ended broadcast lingering up to ~90s before it drops.
const XLIVE_TTL = 90000;
function aggregateXLive() {
  const now = Date.now();
  const breakdown = [];
  for (const host in xLiveByHost) {
    const v = xLiveByHost[host];
    if (now - v.ts > XLIVE_TTL) continue; // drop hosts that stopped pushing
    breakdown.push({ host, viewers: v.viewers, live: v.live });
  }
  if (!breakdown.length) return null;
  breakdown.sort((a, b) => b.viewers - a.viewers);
  // bar number = sum of LIVE hosts' viewers (ended broadcasts contribute 0)
  const viewers = breakdown.reduce((s, b) => s + (b.live ? b.viewers : 0), 0);
  return {
    handle: config.xLiveHandle || "banks",
    live: breakdown.some((b) => b.live),
    viewers,
    views: 0,
    breakdown,
    updatedAt: now,
  };
}
let lastXchatAt = 0; // when X chat last arrived from EITHER source (health strip)
// X-chat failover: the browser EXTENSION (clean DOM scrape, emojis) is primary;
// the OCR bridge is the backup. While the extension is fresh we ignore OCR, and
// only let OCR through once the extension goes silent (it broke). So X chat
// never stops, and we never double up. Extension comes back → it takes over.
let lastExtAt = 0;
const EXT_FAILOVER_MS = 20000;
// Extension heartbeat — the extension pings /ingest/xhb every ~5s it's alive on
// a broadcast, INDEPENDENT of chat/count (a dead chat must not look like a dead
// extension). lastExtSent = its cumulative chat-sent counter, so a watcher can
// tell "alive but scraper stalled" (heartbeat fresh, sent not climbing) from a
// genuine crash (no heartbeat at all). The bridge panel watches this to alarm.
let lastExtHb = 0;
let lastExtSent = 0;
// ---- remote control of the local X-bridge agent (Studio → hub → agent) ----
// The agent (mbpanel on the operator's Mac) heartbeats here with the ingest
// key; Studio reads its status + queues commands with the operator key. This
// is a SELF-CONTAINED relay: it never touches the chat ingest/broadcast path,
// so a bug here cannot affect the live show feed.
let agentState = null; // last status the agent reported: { status, ts }
let agentCommands = []; // queue of commands awaiting the agent's next heartbeat
const AGENT_CMDS = new Set(["start", "stop", "open", "open_profiles", "auto_on", "auto_off"]);
const X_BROADCAST = /^https:\/\/(x|twitter)\.com\/\S+$/i;
// "The show is live" = any tracked Twitch/Kick channel is live (the show
// simulcasts, so this also means the X broadcast is live). The agent uses this
// in Auto mode to start/stop capture without anyone touching the switch.
function showIsLive() {
  return !!lastViewers?.channels?.some((c) => c.live);
}
// Dedupe ids for pushed X broadcast-chat messages.
const xChatSeen = new Set();
// Constant-time compare so the key can't be guessed by timing.
function operatorKeyOk(key) {
  if (!OPERATOR_KEY || !key) return false;
  const a = Buffer.from(String(key));
  const b = Buffer.from(OPERATOR_KEY);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---- per-IP HTTP rate limiting (refilling token bucket) ----
const rateBuckets = new Map();
function rateLimited(ip, max = 40, refillPerSec = 4) {
  const now = Date.now();
  let b = rateBuckets.get(ip);
  if (!b) {
    b = { tokens: max, last: now };
    rateBuckets.set(ip, b);
  }
  b.tokens = Math.min(max, b.tokens + ((now - b.last) / 1000) * refillPerSec);
  b.last = now;
  if (b.tokens < 1) return true;
  b.tokens -= 1;
  return false;
}
// Periodically drop idle buckets so the map can't grow unbounded.
setInterval(() => {
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const [ip, b] of rateBuckets) if (b.last < cutoff) rateBuckets.delete(ip);
}, 5 * 60 * 1000).unref?.();
function clientIp(req) {
  return (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "?";
}

// Shared emote resolver (7TV + BTTV + FFZ) — caches global + per-channel sets.
const emotes = new EmoteResolver();

// Shared Twitch badge resolver — turns the IRC badges tag into real badge art.
const twitchBadges = new TwitchBadgeResolver(twitchCreds);

// Latest overlay style pushed from the control panel. Remembered so overlays
// (e.g. an OBS browser source) reflect live style changes without re-copying
// the link, and so a freshly-connected overlay gets the current look.
let currentStyle = null;
// Admin-set chat appearance for the public room (separate from the overlay
// style). Broadcast to every visitor; remembered for new connections.
let siteLook = null;

// ---- durable settings: survive hub restarts (channels + chat look). Secrets
// (X token, OAuth) stay in .env / memory and are never written here. ----
const STATE_FILE = new URL("./.mb-state.json", import.meta.url);
function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (s.siteLook && typeof s.siteLook === "object") siteLook = s.siteLook;
    const c = s.config;
    if (c && typeof c === "object") {
      if (Array.isArray(c.twitchChannels)) config.twitchChannels = c.twitchChannels;
      if (Array.isArray(c.kickChannels)) config.kickChannels = c.kickChannels;
      if (typeof c.xQuery === "string") config.xQuery = c.xQuery;
      if (typeof c.xLiveHandle === "string") config.xLiveHandle = c.xLiveHandle;
    }
  } catch {
    /* no saved state yet */
  }
}
let saveTimer = null;
function saveState() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(
        STATE_FILE,
        JSON.stringify(
          {
            siteLook,
            config: {
              twitchChannels: config.twitchChannels,
              kickChannels: config.kickChannels,
              xQuery: config.xQuery,
              xLiveHandle: config.xLiveHandle,
            },
          },
          null,
          2
        )
      );
    } catch (e) {
      console.warn("[state] save failed:", e.message);
    }
  }, 300);
}
loadState();

// Latest combined viewer-count snapshot, refreshed on an interval and sent to
// each newly-connected client so the dashboard shows a number immediately.
let lastViewers = null;
let lastViewersAt = 0; // last successful viewer-count poll (health strip)
let lastXViews = null;
let lastXLive = null;
let viewersTimer = null;
let viewersTick = 0;
const VIEWERS_INTERVAL = 20000;
// X views uses a paid recent-search endpoint, so refresh it far less often than
// the free Twitch/Kick counts — every 6th tick (~2 min).
const X_VIEWS_EVERY = 6;

async function pollViewers() {
  // X "views" used to sum paid recent-search impression_count, but impressions
  // aren't viewers — the site now shows ONLY the live broadcast count pushed by
  // the X Bridge (aggregateXLive below). So we no longer pay for that read.
  lastXViews = null;
  viewersTick++;

  // X live concurrent viewers. X removed every public endpoint, so the only
  // accurate source is the bookmarklet's pushed count — prefer it while fresh
  // (< 90s). Fall back to the (now mostly-dead) guest path otherwise.
  const aggX = aggregateXLive();
  if (aggX) {
    lastXLive = aggX;
  } else if (config.xLiveHandle) {
    try {
      lastXLive = await fetchXLive(config.xLiveHandle);
    } catch (err) {
      console.warn("[xlive]", err.message);
    }
  } else {
    lastXLive = null;
  }

  try {
    const snap = await fetchViewerSnapshot(config, twitchCreds);
    snap.x = lastXViews;
    snap.xLive = lastXLive;
    // X numbers live on their own bar (reach OR live count) — never merged
    // into the Twitch+Kick concurrent total.
    lastViewers = snap;
    lastViewersAt = Date.now();
    broadcast({ type: "viewers", viewers: lastViewers });
  } catch (err) {
    console.warn("[viewers]", err.message);
  }
}

function startViewersPolling() {
  if (viewersTimer) clearInterval(viewersTimer);
  viewersTick = 0;
  lastXViews = null;
  lastXLive = null;
  pollViewers();
  viewersTimer = setInterval(pollViewers, VIEWERS_INTERVAL);
}

// ---- Browser clients ----
const clients = new Set();

function broadcast(obj) {
  const data = JSON.stringify(obj);
  for (const ws of clients) {
    // Private clients (the pop-out reader) only get their own sources' feed.
    if (ws._private) continue;
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

// ---- Source manager ----
// twitch/kick hold an array of sources (one per channel); x holds one source.
let sources = { twitch: [], kick: [], x: null };

const status = {
  twitch: { connected: false, channel: config.twitchChannels.join(", ") },
  kick: { connected: false, channel: config.kickChannels.join(", ") },
  x: { connected: false, channel: config.xQuery },
};

// A platform is "connected" if any of its channels are; channel shows the list.
function platformStatus(platform) {
  if (platform === "x") {
    return { connected: Boolean(sources.x && sources.x.connected), channel: config.xQuery };
  }
  const list = sources[platform] || [];
  const channels = platform === "twitch" ? config.twitchChannels : config.kickChannels;
  return { connected: list.some((s) => s.connected), channel: channels.join(", ") };
}

function emitStatus(platform) {
  const st = platformStatus(platform);
  status[platform] = st;
  broadcast({ type: "status", source: platform, connected: st.connected, channel: st.channel });
}

function wireSource(source, platform) {
  source.on("message", (msg) => broadcast(msg));
  source.on("status", () => emitStatus(platform));
  source.on("error", (err) => {
    console.warn(`[${source.constructor.name}]`, err.message);
  });
}

function startSources() {
  stopSources();

  sources.twitch = config.twitchChannels.map((ch) => {
    const s = new TwitchSource(ch, { emotes, badges: twitchBadges });
    wireSource(s, "twitch");
    return s;
  });
  sources.kick = config.kickChannels.map((ch) => {
    const s = new KickSource(ch, { ...kickOptsFor(ch), emotes });
    wireSource(s, "kick");
    return s;
  });
  // X chat comes ONLY from the X Bridge (/ingest/xchat) — the old posts/mentions
  // stream (paid filtered search) is gone; it was never the real broadcast chat.
  sources.x = null;

  for (const s of sources.twitch) s.start();
  for (const s of sources.kick) s.start();
  if (sources.x) sources.x.start();

  for (const platform of ["twitch", "kick", "x"]) {
    status[platform] = platformStatus(platform);
  }
  broadcastStatusSnapshot();
  // Channels may have changed — refresh viewer counts right away.
  startViewersPolling();
}

function stopSources() {
  for (const platform of ["twitch", "kick"]) {
    for (const s of sources[platform]) {
      s.removeAllListeners();
      s.stop();
    }
    sources[platform] = [];
  }
  if (sources.x) {
    sources.x.removeAllListeners();
    sources.x.stop();
    sources.x = null;
  }
}

// ---- Private per-connection subscriptions ----
// The pop-out reader gets its own dedicated Twitch/Kick sources routed only to
// its socket, independent of the shared overlay feed. X is excluded (one
// connection per token), so private readers are Twitch + Kick only.
function teardownPrivate(ws) {
  if (ws._sources) {
    for (const s of ws._sources) {
      s.removeAllListeners();
      s.stop();
    }
  }
  ws._sources = [];
}

function setupPrivate(ws, twitchChannels, kickChannels, xQuery = "", xToken = "") {
  teardownPrivate(ws);
  ws._private = true;
  const send = (obj) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
  };
  const build = (platform, channels, makeSource) =>
    channels.map((ch) => {
      const s = makeSource(ch);
      s._platform = platform;
      s.on("message", (msg) => send(msg));
      s.on("status", () => {
        const list = ws._sources.filter((x) => x._platform === platform);
        send({
          type: "status",
          source: platform,
          connected: list.some((x) => x.connected),
          channel: channels.join(", "),
        });
      });
      s.on("error", () => {});
      return s;
    });
  ws._sources = [
    ...build("twitch", twitchChannels, (ch) => new TwitchSource(ch, { emotes, badges: twitchBadges })),
    ...build("kick", kickChannels, (ch) => new KickSource(ch, { ...kickOptsFor(ch), emotes })),
  ];
  // (The old per-viewer X stream — bring-your-own bearer token — is gone too;
  // X live chat has no API and comes only from the bridge.)
  for (const s of ws._sources) s.start();
}

function broadcastStatusSnapshot() {
  for (const source of ["twitch", "kick", "x"]) {
    broadcast({
      type: "status",
      source,
      connected: status[source].connected,
      channel: status[source].channel,
    });
  }
}

function configPayload() {
  return {
    type: "config",
    config,
    colors: SOURCE_COLORS,
    xEnabled: Boolean(xOpts.bearerToken),
    // Whether a Kick OAuth app is configured, and whether an account is linked.
    kickEnabled: kickConfigured(kickCreds),
    kickConnected: kickConnected(),
  };
}

function sendConfig(ws) {
  ws.send(JSON.stringify(configPayload()));
  for (const source of ["twitch", "kick", "x"]) {
    ws.send(
      JSON.stringify({
        type: "status",
        source,
        connected: status[source].connected,
        channel: status[source].channel,
      })
    );
  }
  if (currentStyle) {
    ws.send(JSON.stringify({ type: "style", style: currentStyle }));
  }
  if (siteLook) {
    ws.send(JSON.stringify({ type: "siteLook", look: siteLook }));
  }
  if (lastViewers) {
    ws.send(JSON.stringify({ type: "viewers", viewers: lastViewers }));
  }
}

// ---- HTTP + WebSocket server ----
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Liveness probe for the host's health checks. Cheap, unauthenticated, and
  // exempt from rate limiting so the platform can poll it freely.
  if (url.pathname === "/health" || url.pathname === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain", "Access-Control-Allow-Origin": "*" });
    res.end("ok");
    return;
  }

  // One-glance pre-show health: is everything wired and fresh? Read-only and
  // contains nothing secret (channel names are already public via config).
  if (url.pathname === "/status") {
    const now = Date.now();
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(
      JSON.stringify({
        ok: true,
        uptimeSec: Math.round(process.uptime()),
        wsClients: wss ? wss.clients.size : 0,
        channels: {
          twitch: config.twitchChannels,
          kick: config.kickChannels,
          xLiveHandle: config.xLiveHandle,
        },
        sources: {
          twitch: status.twitch?.connected ?? false,
          kick: status.kick?.connected ?? false,
        },
        bridge: {
          // seconds since the X Bridge last pushed chat; null = never (this boot)
          xchatAgoSec: lastXchatAt ? Math.round((now - lastXchatAt) / 1000) : null,
          xLiveAgoSec: lastXLiveAt ? Math.round((now - lastXLiveAt) / 1000) : null,
          // extension dead-man's switch: seconds since its last heartbeat (null =
          // never this boot) + its cumulative chat-sent counter. The bridge panel
          // alarms when this goes stale while broadcasts are live.
          extHbAgoSec: lastExtHb ? Math.round((now - lastExtHb) / 1000) : null,
          extSent: lastExtSent,
        },
        viewersUpdatedAgoSec: lastViewersAt ? Math.round((now - lastViewersAt) / 1000) : null,
      })
    );
    return;
  }

  // Throttle abuse / API-cost burn. OAuth redirects are exempt (low volume,
  // user-driven); everything else shares a generous per-IP bucket.
  if (!url.pathname.startsWith("/auth/kick/") && rateLimited(clientIp(req))) {
    res.writeHead(429, { "Content-Type": "text/plain", "Access-Control-Allow-Origin": "*" });
    res.end("rate limited");
    return;
  }

  // Kick OAuth: start the authorize flow (redirect the browser to Kick).
  if (url.pathname === "/auth/kick/login") {
    if (!kickConfigured(kickCreds)) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Kick OAuth is not configured (set KICK_CLIENT_ID/SECRET).");
      return;
    }
    res.writeHead(302, { Location: buildKickLoginUrl(kickCreds, KICK_REDIRECT_URI) });
    res.end();
    return;
  }

  // Kick OAuth: per-viewer login — each visitor signs into their OWN Kick.
  if (url.pathname === "/auth/kick/user/login") {
    if (!kickConfigured(kickCreds)) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Kick OAuth is not configured (set KICK_CLIENT_ID/SECRET).");
      return;
    }
    // Which page to return the viewer to afterwards — the ORIGIN must be on
    // the allowlist (else we fall back to WEB_ORIGIN, never an open redirect);
    // a path is allowed so embedded experiences (/classic) return to themselves.
    const returnOrigin = sanitizeReturn(url.searchParams.get("return"));
    res.writeHead(302, { Location: buildKickUserLoginUrl(kickCreds, KICK_REDIRECT_URI, returnOrigin) });
    res.end();
    return;
  }

  // Kick OAuth: per-viewer session status (browser checks on load). CORS-open.
  if (url.pathname === "/auth/kick/session") {
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    const info = kickSessionInfo(url.searchParams.get("id") || "");
    res.end(JSON.stringify(info));
    return;
  }

  // Operator gate: the studio validates its key here before it's trusted for
  // privileged WS actions. Constant-time compare; never reflects the key.
  if (url.pathname === "/auth/operator") {
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify({ ok: operatorKeyOk(url.searchParams.get("key")) }));
    return;
  }

  // Operator-gated download of the bridge agent bundle (the show machine's
  // capture app). Kept off any public URL so the capture technique isn't just
  // sitting there for anyone — only a logged-in operator can pull it.
  if (url.pathname === "/op/bridge.zip") {
    const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "x-op-key" };
    if (req.method === "OPTIONS") { res.writeHead(204, cors); res.end(); return; }
    if (!operatorKeyOk(url.searchParams.get("key") || req.headers["x-op-key"])) {
      res.writeHead(401, { ...cors, "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "bad operator key" }));
      return;
    }
    const zipPath = new URL("./assets/mb-bridge.zip", import.meta.url);
    fs.readFile(zipPath, (err, data) => {
      if (err) {
        res.writeHead(404, { ...cors, "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "bundle not found" }));
        return;
      }
      res.writeHead(200, {
        ...cors,
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="market-bubble-bridge.zip"',
        "Content-Length": data.length,
      });
      res.end(data);
    });
    return;
  }

  // ---- remote bridge control (Studio ↔ agent relay) ----
  // CORS-open so Studio (different origin) can call these; every call is
  // authenticated (operator key for Studio, ingest key for the agent).
  if (url.pathname === "/op/state" || url.pathname === "/op/command" || url.pathname === "/agent/heartbeat") {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, x-ingest-key, x-op-key",
    };
    if (req.method === "OPTIONS") { res.writeHead(204, cors); res.end(); return; }
    const json = (code, obj) => {
      res.writeHead(code, { ...cors, "Content-Type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    const now = Date.now();
    const agentOnline = !!agentState && now - agentState.ts < 10000;

    // Studio reads the agent's current status (operator-gated).
    if (url.pathname === "/op/state") {
      if (!operatorKeyOk(url.searchParams.get("key") || req.headers["x-op-key"]))
        return json(401, { ok: false, error: "bad operator key" });
      return json(200, {
        ok: true,
        online: agentOnline,
        agoSec: agentState ? Math.round((now - agentState.ts) / 1000) : null,
        status: agentOnline ? agentState.status : null,
        queued: agentCommands.length,
      });
    }

    // Studio queues a command for the agent (operator-gated, validated).
    if (url.pathname === "/op/command") {
      let body = "";
      req.on("data", (c) => { body += c; if (body.length > 1e5) req.destroy(); });
      req.on("end", () => {
        let j = {};
        try { j = JSON.parse(body || "{}"); } catch {}
        if (!operatorKeyOk(j.key || req.headers["x-op-key"]))
          return json(401, { ok: false, error: "bad operator key" });
        const action = String(j.action || "");
        if (!AGENT_CMDS.has(action)) return json(400, { ok: false, error: "unknown action" });
        const cmd = { action };
        if (action === "open") {
          const u = String(j.url || "").trim();
          if (!X_BROADCAST.test(u)) return json(400, { ok: false, error: "url must be an x.com link" });
          cmd.url = u;
        }
        agentCommands.push(cmd);
        if (agentCommands.length > 20) agentCommands = agentCommands.slice(-20);
        return json(200, { ok: true, online: agentOnline });
      });
      return;
    }

    // Agent heartbeats: posts status, drains its command queue (ingest-gated).
    if (url.pathname === "/agent/heartbeat") {
      let body = "";
      req.on("data", (c) => { body += c; if (body.length > 1e5) req.destroy(); });
      req.on("end", () => {
        if (!ingestKeyOk(req.headers["x-ingest-key"]))
          return json(401, { ok: false, error: "bad ingest key" });
        let j = {};
        try { j = JSON.parse(body || "{}"); } catch {}
        agentState = { status: j.status || {}, ts: now };
        const commands = agentCommands;
        agentCommands = [];
        return json(200, { ok: true, commands, showLive: showIsLive() });
      });
      return;
    }
  }

  // ---- X bookmarklet ingest (CORS-open so it can POST from x.com) ----
  if (url.pathname.startsWith("/ingest/")) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, x-ingest-key",
    };
    if (req.method === "OPTIONS") { res.writeHead(204, cors); res.end(); return; }
    const key = req.headers["x-ingest-key"] || url.searchParams.get("key");
    if (!ingestKeyOk(key)) {
      res.writeHead(401, { ...cors, "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "bad ingest key" }));
      return;
    }
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on("end", () => {
      let j = {};
      try { j = JSON.parse(body || "{}"); } catch {}
      if (url.pathname === "/ingest/xhb") {
        // extension liveness ping — fresh = the scraper is alive on a broadcast
        lastExtHb = Date.now();
        lastExtSent = Number(j.sent) || 0;
        res.writeHead(200, { ...cors, "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (url.pathname === "/ingest/xlive") {
        // one push per broadcast tab — key by host so the 3 accounts don't
        // overwrite each other; the bar sums them, the hover lists them.
        // host MUST be the broadcaster (Banks / Ansem / …). Don't fall back to
        // config.xLiveHandle — a hostless push (old client) would masquerade as
        // "banks"; show it as the neutral "X" catch-all instead.
        const host = String(j.host || j.channel || "X")
          .slice(0, 80)
          .replace(/^@/, "");
        xLiveByHost[host] = { viewers: Number(j.viewers) || 0, live: !!j.live, ts: Date.now() };
        lastXLiveAt = Date.now();
        // forget hosts that have gone stale so the breakdown drops ended streams
        for (const k in xLiveByHost) if (lastXLiveAt - xLiveByHost[k].ts > XLIVE_TTL) delete xLiveByHost[k];
        // reflect immediately into the latest snapshot + rebroadcast
        if (lastViewers) {
          lastViewers.xLive = aggregateXLive();
          broadcast({ type: "viewers", viewers: lastViewers });
        }
        res.writeHead(200, { ...cors, "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (url.pathname === "/ingest/xchat") {
        const msgs = Array.isArray(j.messages) ? j.messages : [];
        const now2 = Date.now();
        const source = j.source === "ext" ? "ext" : "ocr";
        if (source === "ext") lastExtAt = now2;
        // Suppress OCR chat while the extension is ALIVE (heartbeat fresh) — NOT
        // merely while it's actively sending chat. A dead/quiet X chat means the
        // live extension has nothing to push, but it still OWNS the chat; keying
        // on chat freshness (lastExtAt) wrongly let the OCR's noise through on a
        // silent chat. The heartbeat is the true "extension is covering it" signal.
        else if (now2 - lastExtHb < EXT_FAILOVER_MS) {
          res.writeHead(200, { ...cors, "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, pushed: 0, suppressed: "extension alive" }));
          return;
        }
        lastXchatAt = now2;
        let pushed = 0;
        for (const m of msgs) {
          const id = String(m.id || `${m.username}:${m.text}`).slice(0, 200);
          if (xChatSeen.has(id)) continue;
          xChatSeen.add(id);
          if (xChatSeen.size > 5000) xChatSeen.delete(xChatSeen.values().next().value);
          const username = String(m.username || "x").slice(0, 80).replace(/^@/, "");
          const text = String(m.text || "").slice(0, 500);
          if (!text) continue;
          // channel = which broadcast it came from (Banks / Ansem / Market
          // Bubble), set by the bridge; falls back to the author's handle.
          const channel = String(m.channel || username).slice(0, 80).replace(/^@/, "");
          // Drip the batch out one message at a time (OCR reads arrive in
          // clumps; a real chat flows). Spread stays under the bridge's read
          // cycle so batches never pile up.
          const delay = Math.min(pushed * 350, 5000);
          setTimeout(() => {
            broadcast(unifiedMessage("x", username, text, Date.now(), undefined, undefined, channel));
          }, delay);
          pushed++;
        }
        res.writeHead(200, { ...cors, "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, pushed }));
        return;
      }
      res.writeHead(404, { ...cors, "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "unknown ingest route" }));
    });
    return;
  }

  // Kick OAuth: per-viewer disconnect.
  if (url.pathname === "/auth/kick/session/disconnect") {
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    disconnectKickSession(url.searchParams.get("id") || "");
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // Kick OAuth: callback — handles both operator connect + per-viewer login.
  if (url.pathname === "/auth/kick/callback") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    try {
      if (!code || !state) throw new Error("missing code/state");
      const result = await handleKickCallback(kickCreds, KICK_REDIRECT_URI, code, state);
      if (result?.sessionId) {
        // Deliver the session id in the URL FRAGMENT — fragments are never sent
        // to servers or in the Referer, so the credential can't leak that way.
        // Return to the (allowlisted) page that started the login, so the
        // session lands in the right site's storage.
        const back = sanitizeReturn(result.returnOrigin) || `${WEB_ORIGIN}/`;
        const u = result.username ? `&kick_user=${encodeURIComponent(result.username)}` : "";
        res.writeHead(302, { Location: `${back}#kick_session=${encodeURIComponent(result.sessionId)}${u}` });
      } else {
        broadcast(configPayload());
        res.writeHead(302, { Location: `${WEB_ORIGIN}/?kick=connected` });
      }
    } catch (err) {
      console.warn("[kick oauth]", err.message);
      res.writeHead(302, { Location: `${WEB_ORIGIN}/?kick=error` });
    }
    res.end();
    return;
  }

  // Clips + VODs for the Content page (Twitch Helix, reusing the viewer-count
  // app credentials). Cached in the fetcher.
  if (url.pathname === "/content") {
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    try {
      const byDate = (a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
      const [tw, kick, x] = await Promise.all([
        fetchContent(config.twitchChannels, twitchCreds).catch(() => ({ clips: [], streams: [] })),
        fetchKickContent(config.kickChannels?.[0]).catch(() => ({ clips: [], streams: [] })),
        fetchTweets(undefined, xOpts.bearerToken).catch(() => ({ tweets: [] })),
      ]);
      const clips = [...(tw.clips || []), ...(kick.clips || [])].sort(byDate).slice(0, 14);
      const streams = [...(tw.streams || []), ...(kick.streams || [])].sort(byDate).slice(0, 10);
      res.end(JSON.stringify({ clips, streams, tweets: x.tweets || [], updatedAt: Date.now() }));
    } catch (err) {
      res.end(JSON.stringify({ clips: [], streams: [], tweets: [], error: String(err?.message || err) }));
    }
    return;
  }

  // Emote map for the composer's autocomplete + picker (Twitch globals/channel
  // + 7TV/BTTV/FFZ global+channel), reusing the shared resolver's cache.
  if (url.pathname === "/emotes") {
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    try {
      const data = await fetchEmoteList(config.twitchChannels, twitchCreds, emotes);
      res.end(JSON.stringify(data));
    } catch (err) {
      res.end(JSON.stringify({ emotes: {}, count: 0, error: String(err?.message || err) }));
    }
    return;
  }

  // "The Tape" for the Market page: live equities + crypto + commodities.
  if (url.pathname === "/markets") {
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    try {
      const data = await fetchMarkets(process.env.FINNHUB_API_KEY);
      res.end(JSON.stringify(data));
    } catch (err) {
      res.end(JSON.stringify({ equities: [], crypto: [], commodities: [], error: String(err?.message || err) }));
    }
    return;
  }

  // Live host follower counts (Twitch + X). Heavily cached server-side.
  if (url.pathname === "/socials") {
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    try {
      const data = await fetchSocials(
        { twitch: ["fazebanks"], x: ["Banks", "blknoiz06"] },
        twitchCreds,
        xOpts.bearerToken
      );
      res.end(JSON.stringify(data));
    } catch (err) {
      res.end(JSON.stringify({ twitch: {}, x: {}, error: String(err?.message || err) }));
    }
    return;
  }

  // Proxy X (twimg) video so the browser loads it same-origin — twimg blocks
  // cross-origin <video> requests otherwise. Range requests are forwarded so
  // seeking + progressive buffering work.
  if (url.pathname === "/vid") {
    const u = url.searchParams.get("u") || "";
    if (!/^https:\/\/video\.twimg\.com\/[\w./-]+\.mp4/.test(u)) {
      res.writeHead(400, { "Access-Control-Allow-Origin": "*" });
      res.end("bad url");
      return;
    }
    try {
      const headers = {};
      if (req.headers.range) headers.Range = req.headers.range;
      // No redirect-following (prevents SSRF via an upstream redirect) + a hard
      // timeout so the proxy can't be held open.
      const upstream = await fetch(u, { headers, redirect: "error", signal: AbortSignal.timeout(15000) });
      const out = {
        "Content-Type": upstream.headers.get("content-type") || "video/mp4",
        "Accept-Ranges": "bytes",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=86400",
      };
      const cl = upstream.headers.get("content-length");
      const cr = upstream.headers.get("content-range");
      if (cl) out["Content-Length"] = cl;
      if (cr) out["Content-Range"] = cr;
      res.writeHead(upstream.status, out);
      if (upstream.body) Readable.fromWeb(upstream.body).pipe(res);
      else res.end();
    } catch {
      res.writeHead(502, { "Access-Control-Allow-Origin": "*" });
      res.end("proxy error");
    }
    return;
  }

  if (url.pathname === "/health" || url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, status, kick: kickConnected() }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({
  server,
  // Reject cross-site WebSocket connections (CSWSH). Same-origin tools (curl,
  // OBS browser source, native apps) send no Origin and are allowed; browsers
  // must match the allowlist.
  verifyClient: ({ origin }) => !origin || ALLOWED_ORIGINS.includes(origin),
});

wss.on("connection", (ws, req) => {
  clients.add(ws);
  // Operator privilege is granted only with the right key on the connect URL.
  try {
    const u = new URL(req.url, `http://localhost:${PORT}`);
    ws.isOperator = operatorKeyOk(u.searchParams.get("key"));
  } catch {
    ws.isOperator = false;
  }
  // Simple per-socket flood guard: a refilling token bucket.
  ws.msgTokens = 60;
  const refill = setInterval(() => {
    ws.msgTokens = Math.min(60, ws.msgTokens + 20);
  }, 1000);
  ws.on("close", () => clearInterval(refill));

  sendConfig(ws);

  ws.on("message", (raw) => {
    // rate-limit: drop messages once the bucket is empty
    if ((ws.msgTokens -= 1) < 0) return;
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.type === "profile" && typeof msg.source === "string" && typeof msg.name === "string") {
      // Lazy hover-card lookup for a single chatter; reply only to this socket.
      const name = msg.name.trim();
      const source = msg.source;
      if (!name) return;
      fetchProfile(source, name, twitchCreds)
        .then((data) => {
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: "profile", source, name, data }));
          }
        })
        .catch(() => {});
      return;
    }
    if (msg.type === "kickModerate" && typeof msg.slug === "string" && msg.targetUserId) {
      // Timeout/ban a Kick chatter using the connected Kick account's token.
      const reply = (ok, error) => {
        if (ws.readyState === ws.OPEN)
          ws.send(JSON.stringify({ type: "modResult", platform: "kick", action: msg.action, ok, error: error || null }));
      };
      if (!ws.isOperator) return reply(false, "Not authorized.");
      if (!kickConnected()) return reply(false, "Connect Kick first.");
      const slug = String(msg.slug).toLowerCase();
      const ksrc = sources.kick.find((s) => s.slug === slug);
      const broadcasterUserId = ksrc?.kickUserId;
      if (!broadcasterUserId) return reply(false, `#${slug} isn't being aggregated.`);
      const duration = msg.action === "timeout" ? Number(msg.duration) || 10 : undefined;
      kickBan(kickCreds, { broadcasterUserId, targetUserId: msg.targetUserId, duration })
        .then(() => reply(true))
        .catch((e) => reply(false, e.message));
      return;
    }
    if (msg.type === "kickSend" && typeof msg.slug === "string" && typeof msg.content === "string") {
      const reply = (ok, error) => {
        if (ws.readyState === ws.OPEN)
          ws.send(JSON.stringify({ type: "sendResult", platform: "kick", ok, error: error || null }));
      };
      const session = typeof msg.kickSession === "string" && msg.kickSession ? msg.kickSession : null;
      // Viewers send with their own session; only the operator may fall back to
      // the show's connected Kick account.
      if (!session && (!ws.isOperator || !kickConnected())) return reply(false, "Sign in to Kick first.");
      const content = msg.content.trim();
      if (!content) return;
      const slug = String(msg.slug).toLowerCase();
      const ksrc = sources.kick.find((s) => s.slug === slug);
      const broadcasterUserId = ksrc?.kickUserId;
      if (!broadcasterUserId) return reply(false, `#${slug} isn't being aggregated.`);
      // Per-viewer send when signed in; otherwise the operator account (studio).
      const sending = session
        ? kickSendAs(kickCreds, session, { broadcasterUserId, content })
        : kickSend(kickCreds, { broadcasterUserId, content });
      sending.then(() => reply(true)).catch((e) => reply(false, e.message));
      return;
    }
    if (msg.type === "kickDisconnect") {
      if (!ws.isOperator) return;
      disconnectKick();
      broadcast(configPayload());
      return;
    }
    if (msg.type === "siteLook" && msg.look && typeof msg.look === "object") {
      if (!ws.isOperator) return;
      // Admin-controlled chat appearance for the public room; applies to all
      // visitors. Remembered so newly-connected clients get the current look.
      siteLook = msg.look;
      broadcast({ type: "siteLook", look: siteLook });
      saveState();
      return;
    }
    if (msg.type === "style" && msg.style && typeof msg.style === "object") {
      if (!ws.isOperator) return;
      // Live overlay style from the control panel — remember it and relay to
      // overlays so they update without re-copying the link.
      currentStyle = msg.style;
      broadcast({ type: "style", style: currentStyle });
      return;
    }
    if (msg.type === "config") {
      // Private reader: build dedicated sources for this socket only.
      if (msg.scope === "private") {
        const tw = Array.isArray(msg.twitchChannels)
          ? msg.twitchChannels.map((c) => String(c).trim()).filter(Boolean)
          : [];
        const kk = Array.isArray(msg.kickChannels)
          ? msg.kickChannels.map((c) => String(c).trim()).filter(Boolean)
          : [];
        const xq = typeof msg.xQuery === "string" ? msg.xQuery.trim() : "";
        const xt = typeof msg.xToken === "string" ? msg.xToken.trim() : "";
        setupPrivate(ws, tw, kk, xq, xt);
        return;
      }
      // Live reconfigure of the public feed is operator-only.
      if (!ws.isOperator) return;
      if (Array.isArray(msg.twitchChannels))
        config.twitchChannels = msg.twitchChannels.map((c) => String(c).trim()).filter(Boolean);
      if (Array.isArray(msg.kickChannels))
        config.kickChannels = msg.kickChannels.map((c) => String(c).trim()).filter(Boolean);
      if (typeof msg.xQuery === "string") config.xQuery = msg.xQuery.trim();
      if (typeof msg.xLiveHandle === "string")
        config.xLiveHandle = msg.xLiveHandle.trim().replace(/^@/, "");
      // Bring-your-own X token: a user can supply their own bearer token from
      // the control panel to enable X with their own credentials/cost. Kept
      // server-side only (never echoed back or put in the overlay link).
      if (typeof msg.xToken === "string" && msg.xToken.trim())
        xOpts.bearerToken = msg.xToken.trim();
      console.log("Reconfiguring sources:", config);
      startSources();
      broadcast(configPayload());
      saveState();
    }
  });

  ws.on("close", () => {
    teardownPrivate(ws);
    clients.delete(ws);
  });
  ws.on("error", () => {
    teardownPrivate(ws);
    clients.delete(ws);
  });
});

server.listen(PORT, () => {
  console.log(`Aggregator hub listening on :${PORT}`);
  console.log("Config:", config);
  if (!xOpts.bearerToken) console.log("X source disabled (no X_BEARER_TOKEN).");
  startSources();
});

// Graceful shutdown.
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    console.log(`\n${sig} received, shutting down.`);
    stopSources();
    wss.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000);
  });
}
