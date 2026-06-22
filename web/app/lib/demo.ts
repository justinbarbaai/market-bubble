"use client";

// ─────────────────────────────────────────────────────────────────────────────
// PROMO / DEMO MODE — fakes a live show for screen recording.
//
// When DEMO_MODE is true the home page acts as if Banks is LIVE: the live room
// is shown, fake chat streams in, the viewer index ticks with believable numbers,
// and the stream panel rolls a VOD as if it were the live feed.
//
// TO REVERT after recording: set DEMO_MODE = false (everything below goes inert
// and the site uses the real hub feed again).
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from "react";
import type { ChatMessage, ViewerSnapshot, Channels, Floor } from "./useHub";
import type { SourceKey } from "../components/logos";

// Flip to `true` to re-enter promo/demo mode (fake live show for recording) —
// shows the live room + The Floor looking alive off-air, for local demos. OFF for
// the live site so it uses the real hub feed.
export const DEMO_MODE = false;

// A Twitch VOD to roll in the "live" stream panel during the promo. Swap this id
// for any clip/VOD you want featured.
export const DEMO_VOD_ID = "2788673017";

// The show feed the demo pretends to follow.
export const DEMO_CHANNELS: Channels = {
  twitch: ["fazebanks"],
  kick: ["ansem"],
  xQuery: "from:Banks OR from:blknoiz06",
  xLiveHandle: "banks",
};

const NAMES = [
  "degenharry", "solanaMax", "cryptoKnight", "paperhands_pete", "wagmiqueen",
  "ngmi_andy", "moonboy420", "ansemarmy", "banksbillions", "chartwizard",
  "liquidated_again", "diamondhandz", "shortsqueezed", "gm_degen", "tendies_only",
  "rugpull_survivor", "leverageLarry", "pumpfun_pam", "hodlfather", "exitliquidity",
  "satoshis_cousin", "greencandlesonly", "rektremy", "vibes_trader", "100xorbust",
];

const MSGS = [
  "LETS GOOO 🚀", "banks cooking rn", "ansem was RIGHT about SOL",
  "buy the dip 📉➡️📈", "im all in chat", "this is not financial advice 😂",
  "down 40% but vibing", "BTC to 100k EOY", "diamond hands 💎🙌",
  "he literally called the top", "GM degens ☕", "wen lambo",
  "Polymarket odds are insane", "ratio'd by the market again", "+EV",
  "chat is this real", "ANSEM PNL INSANE", "banks down catastrophic 💀",
  "leverage = freedom", "sold the bottom as usual 🤡", "to the moon 🌙",
  "this clip is going viral", "first time catching it live!", "W stream",
  "the alpha is unreal", "screenshotting this", "calling it: SOL 500",
  "my portfolio is a meme", "fade me for guaranteed gains", "🔥🔥🔥",
  "banks the goat", "actual financial wizardry", "hold the line 🫡",
];

// X (Twitter) handles + posts pulled from the live on @MarketBubble.
const X_NAMES = [
  "MacroMike", "onchain_amy", "solana_sage", "degenintern", "cryptoanalyst",
  "tradfi_refugee", "altcoinanna", "the_chartist", "liquidity_luke", "memecoinmolly",
];
const X_MSGS = [
  "watching @MarketBubble — ansem's $SOL read is wild",
  "banks + ansem cooking on @MarketBubble 🔥",
  "$BTC reclaiming 62k live on @MarketBubble 👀",
  "the @MarketBubble polymarket segment is elite",
  "tuned into @MarketBubble, this is must-watch",
  "$SOL into the close looking strong",
  "@MarketBubble best finance show on the internet",
  "ngl @MarketBubble changed how I trade",
  "this @MarketBubble clip is going viral",
  "ansem called it again on @MarketBubble",
];

// Chatters' personal name colors (used when nameColor = "chatter", like a real
// Twitch/Kick username color).
const USER_COLORS = [
  "#ff7f50", "#1e90ff", "#2ecc7a", "#ff69b4", "#9acd32",
  "#daa520", "#8a2be2", "#ff5c5c", "#46d1ff", "#ffd166",
];

// Platform tints — drive the logo + badge color (and the "platform" name mode),
// exactly like the real feed. These are the brand colors.
const PLATFORM_COLOR: Record<string, string> = {
  twitch: "#9146ff",
  kick: "#53fc18",
  x: "#ffffff",
};

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

const CHANNEL_FOR: Record<string, string> = {
  twitch: "fazebanks",
  kick: "ansem",
  x: "MarketBubble",
};

let counter = 0;
function makeMsg(): ChatMessage {
  counter += 1;
  // believable platform mix: ~58% Twitch, 25% Kick, 17% X (from the live on X)
  const roll = Math.random();
  const source: SourceKey = roll < 0.58 ? "twitch" : roll < 0.83 ? "kick" : "x";
  const isX = source === "x";
  return {
    id: `demo-${counter}-${Math.floor(rand(0, 1e6))}`,
    source,
    username: isX ? pick(X_NAMES) : pick(NAMES),
    text: isX ? pick(X_MSGS) : pick(MSGS),
    timestamp: Date.now(),
    color: PLATFORM_COLOR[source], // platform tint → logo + badge + "platform" name mode
    // X posts carry no per-user color (matches the real feed); others get one.
    userColor: isX ? null : pick(USER_COLORS),
    channel: CHANNEL_FOR[source],
  };
}

// A message authored by the viewer typing from the site (the typing demo).
function makeYouMsg(text: string, source: "twitch" | "kick", username: string): ChatMessage {
  counter += 1;
  return {
    id: `demo-you-${counter}`,
    source,
    username,
    text,
    timestamp: Date.now(),
    color: PLATFORM_COLOR[source],
    userColor: "#ffd166", // gold so "you" stands out a touch
    channel: CHANNEL_FOR[source],
  };
}

function seed(n: number): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (let i = 0; i < n; i++) out.push(makeMsg());
  return out;
}

function makeViewers(tick: number): ViewerSnapshot {
  const tw = Math.round(8200 + tick * 13 + rand(-70, 70));
  const kk = Math.round(3100 + tick * 6 + rand(-35, 35));
  const xv = Math.round(1450 + tick * 4 + rand(-25, 25));
  const now = Date.now();
  return {
    channels: [
      { source: "twitch", channel: "fazebanks", live: true, viewers: tw },
      { source: "kick", channel: "ansem", live: true, viewers: kk },
    ],
    totals: { twitch: tw, kick: kk, total: tw + kk + xv },
    twitchEnabled: true,
    xLive: {
      handle: "banks", live: true, viewers: xv, views: xv * 7, updatedAt: now,
      // the X bar is the combined live count across all three show broadcasts
      breakdown: [
        { host: "Banks", viewers: Math.round(xv * 0.5), live: true },
        { host: "Ansem", viewers: Math.round(xv * 0.32), live: true },
        { host: "Market Bubble", viewers: xv - Math.round(xv * 0.5) - Math.round(xv * 0.32), live: true },
      ],
    },
    updatedAt: now,
  };
}

// A believable "The Floor" leaderboard for the promo — top chatters ranked by
// Bubbles, derived from the same fake names so it reads as live.
function makeFloor(): Floor {
  const srcs: SourceKey[] = ["twitch", "twitch", "kick", "twitch", "x", "kick", "twitch", "kick", "x", "twitch", "kick", "twitch"];
  const top = NAMES.slice(0, 12).map((name, i) => ({
    rank: i + 1,
    name,
    source: srcs[i % srcs.length],
    points: Math.round(9120 - i * 560 - i * i * 9),
  }));
  return { top, users: 1327, bubbles: 86430 };
}
const DEMO_FLOOR = makeFloor();

export type DemoFeed = {
  messages: ChatMessage[];
  viewers: ViewerSnapshot;
  channels: Channels;
  floor: Floor;
  // Post a message as the viewer (typing from the site) — for the promo demo.
  say: (text: string, source: "twitch" | "kick", username: string) => void;
};

// Returns a live-looking fake feed when DEMO_MODE is on, else null.
export function useDemoFeed(): DemoFeed | null {
  const [messages, setMessages] = useState<ChatMessage[]>(() => (DEMO_MODE ? seed(18) : []));
  const [viewers, setViewers] = useState<ViewerSnapshot>(() => makeViewers(0));
  const tick = useRef(0);

  useEffect(() => {
    if (!DEMO_MODE) return;
    let chatTimer: ReturnType<typeof setTimeout>;
    const pushChat = () => {
      setMessages((m) => [...m, makeMsg()].slice(-200));
      chatTimer = setTimeout(pushChat, rand(450, 1500)); // natural, uneven cadence
    };
    chatTimer = setTimeout(pushChat, 700);

    const viewTimer = setInterval(() => {
      tick.current += 1;
      setViewers(makeViewers(tick.current));
    }, 3500);

    return () => {
      clearTimeout(chatTimer);
      clearInterval(viewTimer);
    };
  }, []);

  const say = (text: string, source: "twitch" | "kick", username: string) => {
    const t = text.trim();
    if (!t) return;
    setMessages((m) => [...m, makeYouMsg(t, source, username || "you")].slice(-200));
  };

  if (!DEMO_MODE) return null;
  return { messages, viewers, channels: DEMO_CHANNELS, floor: DEMO_FLOOR, say };
}
