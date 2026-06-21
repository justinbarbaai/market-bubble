"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChatFeed, type Moderation } from "./components/ChatFeed";
import { EmoteInput } from "./components/EmoteInput";
import { useComposerEmotes } from "./lib/useComposerEmotes";
import { PredictionCard } from "./components/PredictionCard";
import { ThemeToggle } from "./components/ThemeToggle";
import { MBLockup } from "./components/brand";
import { Ticker } from "./components/Ticker";
import { CinemaMode } from "./components/CinemaMode";
import { TwitchEmbed } from "./components/TwitchEmbed";
import { OffAir } from "./components/OffAir";
import { LoginMenu } from "./components/LoginMenu";
import { ChatCustomizer } from "./components/ChatCustomizer";
import { useKickSession } from "./lib/kickAuth";
import { useChatPrefs } from "./lib/chatPrefs";
import { DEMO_MODE, DEMO_VOD_ID, useDemoFeed } from "./lib/demo";
import { TermFooter } from "./components/TermFooter";
import { LiveNumber } from "./components/LiveNumber";
import { Panel, type Rect } from "./components/Panel";
import { useHub, type ChatMessage } from "./lib/useHub";
import { readView } from "./lib/liveView";
import { SITE_DEFAULT_LOOK, type OverlayOptions, type LookOptions } from "./lib/overlay";
import { SourceLogo, type SourceKey } from "./components/logos";
import {
  getAuth,
  getClientId,
  setClientId,
  startLogin,
  handleRedirect,
  clearAuth,
  type TwitchAuth,
} from "./lib/twitchAuth";
import { TwitchSender } from "./lib/twitchSender";
import { twitchBan } from "./lib/twitchMod";

type Stream = { source: Exclude<SourceKey, "x">; channel: string };

const LAYOUT_KEY = "mb.workspace.v2";

// Top barrier under the floating header — panels can't go above this line.
const HK_TOP = 132;

// Keep a panel inside the workspace bounds (so a layout saved at a different
// size never overflows under the ticker tape) and below the top barrier.
function clampRect(r: Rect, W: number, H: number, minY = HK_TOP): Rect {
  const w = Math.min(Math.max(280, r.w), W);
  const h = Math.min(Math.max(180, r.h), Math.max(180, H - minY));
  const x = Math.min(Math.max(0, r.x), Math.max(0, W - w));
  const y = Math.min(Math.max(minY, r.y), Math.max(minY, H - h));
  return { ...r, x, y, w, h };
}
type PanelId = "chat" | "stream" | "index";
type Workspace = Record<PanelId, Rect>;

function fmt(n: number): string {
  return n.toLocaleString();
}
function fmtK(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`;
  return String(n);
}

export default function Home() {
  const {
    messages: _messages,
    totalMessages: _totalMessages,
    serverChannels: _serverChannels,
    hubConnected,
    viewers: _viewers,
    profiles,
    requestProfile,
    kickConnected,
    modResult,
    sendResult,
    moderateKick,
    sendKick,
    hubHttpUrl,
    poll,
  } = useHub();
  const { session: kickSession } = useKickSession();

  // PROMO/DEMO MODE — when on, override the hub feed with a live-looking fake
  // (fake chat, viewer numbers, channels). Inert when DEMO_MODE is false.
  const demo = useDemoFeed();
  const messages = demo?.messages ?? _messages;
  const viewers = demo?.viewers ?? _viewers;
  const serverChannels = demo?.channels ?? _serverChannels;
  const totalMessages = demo ? demo.messages.length : _totalMessages;

  const [parent, setParent] = useState("");
  const [selected, setSelected] = useState<Stream | null>(null);
  // Latest broadcast VOD (same source as the lobby's replay theater) — the
  // cinema plays it whenever nothing is live, and swaps to the live feed the
  // moment a host goes live (selected fills in automatically).
  const [vod, setVod] = useState<{ id: string; title: string } | null>(null);
  useEffect(() => {
    if (!hubHttpUrl) return;
    let alive = true;
    fetch(`${hubHttpUrl}/content`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        const s = (d.streams || []).find(
          (v: { source?: string; url?: string }) => v.source !== "kick" && /videos\/(\d+)/.test(v.url || "")
        );
        if (s) setVod({ id: (s.url.match(/videos\/(\d+)/) || [])[1], title: s.title });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [hubHttpUrl]);
  // Cinema mode: premium rounded-TV overlay (stream / chat / views, scenes).
  const [cinema, setCinema] = useState(false);
  // the workspace player's rect at the moment cinema opens — the stage FLIPs
  // out of (and back into) this exact spot
  const cinemaFrom = useRef<DOMRect | null>(null);
  const playerRect = () =>
    (document.querySelector(".sp") ?? document.querySelector(".oa-player") ?? document.querySelector(".term-room-stage"))
      ?.getBoundingClientRect() ?? null;
  const toggleCinema = () => {
    cinemaFrom.current = playerRect();
    setCinema((c) => !c);
  };
  // house lights: the page behind recedes while cinema is up
  useEffect(() => {
    document.documentElement.classList.toggle("cinema-on", cinema);
    return () => document.documentElement.classList.remove("cinema-on");
  }, [cinema]);
  // The show ships a fixed default look; each viewer personalizes their own copy
  // on their device only (no global/Studio override — that's intentionally gone).
  const { prefs: chatPrefs, patch: patchChatPrefs, reset: resetChatPrefs, customized } = useChatPrefs();
  const [editChat, setEditChat] = useState(false);
  // The viewer's effective look (ship default + their own prefs).
  const myLook = useMemo<LookOptions>(
    () => ({ ...SITE_DEFAULT_LOOK, ...chatPrefs }),
    [chatPrefs]
  );
  const feedOptions = useMemo<OverlayOptions>(
    () => ({ ...myLook, twitch: [], kick: [], xQuery: "" }),
    [myLook]
  );
  // The viewer's overlay = their look + the show's channels (so it renders the
  // real show chat, styled their way).
  const myOverlayOptions = useMemo<OverlayOptions>(
    () => ({
      ...myLook,
      twitch: serverChannels?.twitch ?? [],
      kick: serverChannels?.kick ?? [],
      xQuery: serverChannels?.xQuery ?? "",
    }),
    [myLook, serverChannels]
  );

  // Is the show on air? Any host channel reporting live. Until viewers load we
  // treat it as off air (so we don't flash the live workspace).
  const isLive =
    (!!viewers && (viewers.channels || []).some((c) => c.live)) ||
    !!viewers?.xLive?.live;

  // Off air / on air view. Default follows live status automatically; the viewer
  // can manually peek the other view. A real live↔offline transition snaps back
  // to auto, so going live always shows the live room without anyone switching.
  const [manualView, setManualView] = useState<null | "offair" | "live">(null);
  const prevLiveRef = useRef(isLive);
  useEffect(() => {
    if (prevLiveRef.current === isLive) return;
    // Only follow a live-status change that HOLDS — momentary flickers in the
    // viewer data must not yank someone out of the room they chose.
    const t = setTimeout(() => {
      prevLiveRef.current = isLive;
      setManualView(null);
    }, 15000);
    return () => clearTimeout(t);
  }, [isLive]);
  const showLive = manualView ? manualView === "live" : isLive;

  // The bottom nav + top button flip the view through requestView(); apply that
  // intent here. On mount it also picks up a cross-page request (e.g. tapping
  // "Live" from /market navigates to "/" and lands straight in the live room).
  useEffect(() => {
    const apply = () => {
      const v = readView();
      if (v === "live") setManualView("live");
      else if (v === "lobby") setManualView(null); // null → follow the real live status
    };
    apply();
    const onView = () => apply();
    window.addEventListener("mb:view", onView);
    return () => window.removeEventListener("mb:view", onView);
  }, []);

  // Publish the live state for chrome-level FX (favicon dot + "● LIVE" title).
  useEffect(() => {
    document.documentElement.dataset.live = isLive ? "1" : "0";
    return () => {
      delete document.documentElement.dataset.live;
    };
  }, [isLive]);


  // Fullscreen "focus" mode: hide the header + footer so the whole screen is the
  // chat / stream / views, and free the panels to move anywhere (barrier -> 0).
  const [focusMode, setFocusMode] = useState(false);
  // Locked room: panels are fixed in a grid; viewers show/hide them, not drag.
  const [show, setShow] = useState({ stream: true, chat: true, index: true });
  useEffect(() => {
    try { const r = localStorage.getItem("mb.roomShow"); if (r) setShow((v) => ({ ...v, ...JSON.parse(r) })); } catch {}
  }, []);
  const toggleShow = (k: "stream" | "chat" | "index") =>
    setShow((v) => {
      const next = { ...v, [k]: !v[k] };
      try { localStorage.setItem("mb.roomShow", JSON.stringify(next)); } catch {}
      return next;
    });
  const barrier = focusMode ? 0 : HK_TOP;

  // Real browser fullscreen for the live room. Entering focus mode also requests
  // OS-level fullscreen (hides Chrome's address bar / tabs) so the aggregated chat
  // can be featured edge-to-edge on stream; exiting (button, Esc, or the native
  // OS gesture) restores the browser chrome. requestFullscreen must run inside the
  // click gesture, so it lives in the toggle handler, not an effect.
  const roomRef = useRef<HTMLDivElement>(null);
  // Entering/leaving focus mode resizes the player and Twitch pauses through it.
  // Fire a gesture-bound signal so the player can resume from WITHIN this click —
  // the only way an UNMUTED video is allowed to resume (autoplay policy).
  const signalFocus = () => {
    try { window.dispatchEvent(new Event("mb:roomfocus")); } catch {}
  };
  const exitFocus = () => {
    setFocusMode(false);
    signalFocus();
    try { if (document.fullscreenElement) document.exitFullscreen?.(); } catch {}
  };
  const toggleFocus = () => {
    if (focusMode) return exitFocus();
    setFocusMode(true);
    signalFocus();
    try {
      const el = roomRef.current;
      if (el && !document.fullscreenElement) el.requestFullscreen?.()?.catch?.(() => {});
    } catch {}
  };
  // The Stream / Chat / Views / ⤢ controls — rendered in the header normally, and
  // floated over the room in fullscreen (so panels stay toggleable on-stream and
  // ⤢ doubles as the exit). Same buttons in both spots.
  const togButtons = (
    <>
      <button className={`room-tog ${show.stream ? "on" : ""}`} onClick={() => toggleShow("stream")} aria-pressed={show.stream} title="Show / hide the stream">Stream</button>
      <button className={`room-tog ${show.chat ? "on" : ""}`} onClick={() => toggleShow("chat")} aria-pressed={show.chat} title="Show / hide chat">Chat</button>
      <button className={`room-tog ${show.index ? "on" : ""}`} onClick={() => toggleShow("index")} aria-pressed={show.index} title="Show / hide live views">Views</button>
      <button className={`term-icon room-fs ${focusMode ? "on" : ""}`} onClick={toggleFocus} aria-pressed={focusMode} aria-label="Fullscreen" title={focusMode ? "Exit fullscreen (Esc)" : "True fullscreen — hides the browser bar too (Esc to exit)"}>⤢</button>
    </>
  );

  // ---- arrangeable workspace (draggable / resizable panels) ----
  const workRef = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ w: 0, h: 0 });
  const [layout, setLayout] = useState<Workspace | null>(null);
  const zRef = useRef(3);

  // Snap guides + drop-ghost are positioned imperatively (no React re-render
  // during a gesture, so dragging stays buttery).
  const vGuideRef = useRef<HTMLSpanElement>(null);
  const hGuideRef = useRef<HTMLSpanElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const showGuides = (x: number | null, y: number | null) => {
    const v = vGuideRef.current;
    const h = hGuideRef.current;
    if (v) {
      v.style.display = x != null ? "block" : "none";
      if (x != null) v.style.left = `${x}px`;
    }
    if (h) {
      h.style.display = y != null ? "block" : "none";
      if (y != null) h.style.top = `${y}px`;
    }
  };
  const showGhost = (b: { x: number; y: number; w: number; h: number } | null) => {
    const g = ghostRef.current;
    if (!g) return;
    if (!b) {
      g.style.display = "none";
      return;
    }
    g.style.display = "block";
    g.style.left = `${b.x}px`;
    g.style.top = `${b.y}px`;
    g.style.width = `${b.w}px`;
    g.style.height = `${b.h}px`;
  };

  useEffect(() => {
    const el = workRef.current;
    const measure = () => {
      if (el && el.clientWidth) setBounds({ w: el.clientWidth, h: el.clientHeight });
    };
    // Re-run when the live room becomes visible — the workspace only mounts then,
    // so measuring on mount alone leaves bounds at 0 and the panels never lay out.
    measure();
    const raf = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    // Observe the workspace so entering/leaving fullscreen (header + tape collapse)
    // re-measures the freed space and the panels can use it.
    let ro: ResizeObserver | undefined;
    if (el && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(measure);
      ro.observe(el);
    }
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
      ro?.disconnect();
    };
  }, [showLive]);

  // Keep panels valid as the workspace size or barrier changes (fullscreen,
  // resize) — only rewrites a panel if it actually fell out of bounds.
  useEffect(() => {
    if (bounds.w === 0) return;
    setLayout((l) => {
      if (!l) return l;
      const next: Workspace = {
        chat: clampRect(l.chat, bounds.w, bounds.h, barrier),
        stream: clampRect(l.stream, bounds.w, bounds.h, barrier),
        index: clampRect(l.index, bounds.w, bounds.h, barrier),
      };
      const same = (Object.keys(next) as PanelId[]).every(
        (k) => l[k].x === next[k].x && l[k].y === next[k].y && l[k].w === next[k].w && l[k].h === next[k].h
      );
      return same ? l : next;
    });
  }, [bounds, barrier]);

  // Load a saved arrangement, or lay out sensible defaults once we know the size.
  useEffect(() => {
    if (layout || bounds.w === 0) return;
    try {
      const raw = localStorage.getItem(LAYOUT_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Workspace;
        zRef.current = Math.max(3, ...Object.values(saved).map((r) => r.z));
        const { w: W, h: H } = bounds;
        setLayout({
          chat: clampRect(saved.chat, W, H),
          stream: clampRect(saved.stream, W, H),
          index: clampRect(saved.index, W, H),
        });
        return;
      }
    } catch {}
    const { w: W, h: H } = bounds;
    const g = 14;
    const top = HK_TOP; // 132 — chat + right rail both start here
    const chatW = Math.min(580, Math.max(360, Math.round(W * 0.4)));
    const railX = chatW + 16;
    const railW = Math.max(280, W - railX - g);
    const availH = Math.max(360, H - top - g);
    const streamH = Math.round(availH * 0.7);
    // Matches the hand-tuned arrangement: chat flush-left full-height, stream over
    // the audience in the right rail — all topping out at the barrier.
    setLayout({
      chat: { x: 0, y: top, w: chatW, h: H - top - g, z: 3 },
      stream: { x: railX, y: top, w: railW, h: streamH, z: 2 },
      index: { x: railX, y: top + streamH, w: railW, h: Math.max(180, availH - streamH), z: 1 },
    });
  }, [bounds, layout]);

  useEffect(() => {
    if (layout) {
      try {
        localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
      } catch {}
    }
  }, [layout]);

  const moveRect = (id: PanelId, r: Rect) => setLayout((l) => (l ? { ...l, [id]: r } : l));
  const focusPanel = (id: PanelId) =>
    setLayout((l) => {
      if (!l) return l;
      const z = ++zRef.current;
      return l[id].z === z ? l : { ...l, [id]: { ...l[id], z } };
    });
  // Leave fullscreen when the live room closes; Esc also exits.
  useEffect(() => {
    if (!showLive && focusMode) exitFocus();
  }, [showLive, focusMode]);
  useEffect(() => {
    if (!focusMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") exitFocus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusMode]);
  // If the user leaves browser fullscreen via the native gesture (Esc / OS chrome),
  // keep focus mode in sync so the site UI comes back with the address bar.
  useEffect(() => {
    const onFs = () => { if (!document.fullscreenElement) setFocusMode(false); };
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const [auth, setAuth] = useState<TwitchAuth | null>(null);
  const [clientId, setClientIdState] = useState("");
  const [draft, setDraft] = useState("");
  const senderRef = useRef<TwitchSender | null>(null);

  useEffect(() => {
    setParent(window.location.hostname);
    setClientIdState(getClientId());
    handleRedirect().then((a) => setAuth(a || getAuth()));
  }, []);

  useEffect(() => {
    if (!auth) return;
    const s = new TwitchSender(auth.token, auth.login);
    s.connect();
    senderRef.current = s;
    return () => {
      s.close();
      senderRef.current = null;
    };
  }, [auth]);

  const streams = useMemo<Stream[]>(() => {
    if (!serverChannels) return [];
    return [
      ...serverChannels.twitch.map((channel) => ({ source: "twitch" as const, channel })),
      ...serverChannels.kick.map((channel) => ({ source: "kick" as const, channel })),
    ];
  }, [serverChannels]);

  useEffect(() => {
    if (!selected && streams.length) setSelected(streams[0]);
  }, [streams, selected]);

  const playerSrc = useMemo(() => {
    if (!parent) return "";
    // PROMO/DEMO: roll a VOD in the live panel as if it were the live feed.
    if (DEMO_MODE) {
      return `https://player.twitch.tv/?video=${DEMO_VOD_ID}&parent=${encodeURIComponent(parent)}&muted=true&autoplay=true`;
    }
    if (!selected) return "";
    return selected.source === "twitch"
      ? `https://player.twitch.tv/?channel=${encodeURIComponent(selected.channel)}&parent=${encodeURIComponent(parent)}&muted=true&autoplay=true`
      : `https://player.kick.com/${encodeURIComponent(selected.channel)}?muted=true&autoplay=true`;
  }, [selected, parent]);

  // ---- live audience "index" ----
  const total = viewers?.totals.total ?? 0;
  const tw = viewers?.totals.twitch ?? 0;
  const kk = viewers?.totals.kick ?? 0;
  // X bar: ONLY the live broadcast viewer count pushed by the X Bridge (the tool
  // we built that reads the real concurrent count off the live X page). We no
  // longer fall back to post reach / impressions — that number isn't "viewers".
  // Its own metric, never merged into the Twitch+Kick watching-now total.
  const xIsLive = !!viewers?.xLive?.live;
  const xViews = xIsLive ? viewers!.xLive!.viewers : 0;
  const xLabel = xIsLive ? "X" : "X views";
  const breakdown = Math.max(1, tw + kk);

  // viewer history → sparkline + delta
  const [history, setHistory] = useState<number[]>([]);
  const lastUpdated = viewers?.updatedAt;
  useEffect(() => {
    if (!viewers) return;
    setHistory((h) => (h[h.length - 1] === total ? h : [...h, total].slice(-40)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastUpdated]);
  const delta = history.length > 1 ? total - history[history.length - 2] : 0;

  const { perMin, chatters } = useMemo(() => {
    const now = messages.length ? messages[messages.length - 1].timestamp : Date.now();
    const recent = messages.filter((m) => now - m.timestamp < 60000).length;
    const uniq = new Set(messages.map((m) => `${m.source}:${m.username.toLowerCase()}`));
    return { perMin: recent, chatters: uniq.size };
  }, [messages]);

  // ---- chat send ----
  const { map: emotes, sections: emoteSections } = useComposerEmotes(hubHttpUrl, auth, clientId);
  const twitchChannels = serverChannels?.twitch ?? [];
  const kickChannels = serverChannels?.kick ?? [];
  // In demo mode the composer is always usable (so the promo can show typing).
  const canTwitch = !!demo || (!!auth && twitchChannels.length > 0);
  const canKick = !!demo || ((!!kickSession || kickConnected) && kickChannels.length > 0);
  const canChat = canTwitch || canKick;
  const [targets, setTargets] = useState<{ twitch: boolean; kick: boolean }>({ twitch: true, kick: true });
  const sendTwitch = targets.twitch && canTwitch;
  const sendKickTarget = targets.kick && canKick;

  const submit = () => {
    const text = draft.trim();
    if (!text || (!sendTwitch && !sendKickTarget)) return;
    // Demo: post the typed message into the fake feed as the viewer.
    if (demo) {
      demo.say(text, sendTwitch ? "twitch" : "kick", auth?.login || "you");
      setDraft("");
      return;
    }
    if (sendTwitch) for (const ch of twitchChannels) senderRef.current?.send(ch, text);
    if (sendKickTarget) for (const ch of kickChannels) sendKick(ch, text, kickSession?.id);
    setDraft("");
  };


  // ---- moderation + toast ----
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);
  const [toastIn, setToastIn] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = (text: string, ok: boolean) => {
    setToast({ text, ok });
    setToastIn(false);
    requestAnimationFrame(() => setToastIn(true)); // slide up on the next frame
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastIn(false), 3200); // then slide out
  };
  // once the slide-out has played, unmount the toast
  useEffect(() => {
    if (toast && !toastIn) {
      const t = setTimeout(() => setToast(null), 320);
      return () => clearTimeout(t);
    }
  }, [toast, toastIn]);
  const moderate = async (m: ChatMessage, minutes?: number) => {
    if (!m.channel) return;
    const label = minutes ? `Timed out ${m.username} (${minutes}m)` : `Banned ${m.username}`;
    if (m.source === "twitch") {
      if (!auth?.userId || !clientId) return;
      try {
        await twitchBan({
          token: auth.token,
          clientId,
          moderatorId: auth.userId,
          broadcasterLogin: m.channel,
          targetLogin: m.username,
          targetUserId: m.userId ?? undefined,
          duration: minutes ? minutes * 60 : undefined,
        });
        showToast(`${label} in #${m.channel}`, true);
      } catch (e: any) {
        showToast(e?.message || "Action failed", false);
      }
    } else if (m.source === "kick") {
      if (!kickConnected || !m.userId) return;
      moderateKick(m.channel, minutes ? "timeout" : "ban", m.userId, minutes);
    }
  };
  useEffect(() => {
    if (modResult) showToast(modResult.ok ? "Action applied" : modResult.error || "Action failed", modResult.ok);
  }, [modResult]);
  useEffect(() => {
    if (sendResult && !sendResult.ok) showToast(sendResult.error || "Kick send failed", false);
  }, [sendResult]);
  const moderation: Moderation = {
    // Public viewer site: no mod controls in the hover card. Being logged in to
    // chat does NOT make you a mod, and a fan can't action anyone — so the
    // Ban/Timeout buttons just confused people. (Wiring kept; flip this to a real
    // mod-status check if we ever surface mod tools for actual broadcasters/mods.)
    canModerate: () => false,
    onTimeout: (m, minutes) => moderate(m, minutes),
    onBan: (m) => moderate(m),
  };

  // the chat composer — one node, rendered in the workspace chat panel AND the
  // cinema chat rail so the two can never drift
  const composerNode = canChat ? (
    <div className="term-composer">
      <div className="term-pushrow">
        {canTwitch && (
          <button
            type="button"
            className={`watch-pushpill ${targets.twitch ? "on" : ""}`}
            data-source="twitch"
            onClick={() => setTargets((t) => ({ ...t, twitch: !t.twitch }))}
          >
            <SourceLogo source="twitch" size={12} /> Twitch
          </button>
        )}
        {canKick && (
          <button
            type="button"
            className={`watch-pushpill ${targets.kick ? "on" : ""}`}
            data-source="kick"
            onClick={() => setTargets((t) => ({ ...t, kick: !t.kick }))}
          >
            <SourceLogo source="kick" size={12} /> Kick
          </button>
        )}
      </div>
      <EmoteInput
        value={draft}
        onChange={setDraft}
        onSubmit={submit}
        disabled={!sendTwitch && !sendKickTarget}
        placeholder={!sendTwitch && !sendKickTarget ? "Pick a platform…" : "Say something to the room…"}
        emotes={emotes}
        sections={emoteSections}
      />
    </div>
  ) : (
    <div className="term-composer-hint">
      Log in with Twitch or connect Kick in the <Link href="/studio">studio</Link> to talk.
    </div>
  );

  return (
    <div ref={roomRef} className={`term term-room${!showLive ? " offair" : ""}${showLive && focusMode ? " focus" : ""}`}>
      <h1 className="sr-only">Market Bubble — live trading show with FaZe Banks & Ansem</h1>
      <div className="term-room-stage">
      {/* ---- terminal top bar ---- */}
      <div className="term-bar-slot">
      <header className="term-bar">
        <Link href="/" className="term-logo" aria-label="Market Bubble">
          <MBLockup className="term-lockup" />
        </Link>
        <nav className="term-nav">
          <Link href="/" className="active">Home</Link>
          <Link href="/market">Market</Link>
          <Link href="/news">News</Link>
          <Link href="/content">Content</Link>
        </nav>
        <div className="term-bar-right">
          <button
            className="term-cine term-viewswitch"
            onClick={() => setManualView(showLive ? "offair" : "live")}
            title={showLive ? "Back to the lobby" : "Open the live room"}
          >
            {showLive ? "Lobby" : "Live room"}
            {isLive && !showLive && <span className="term-viewswitch-dot" />}
          </button>
          <ThemeToggle className="term-icon" />
          <button
            className={`term-cine ${cinema ? "on" : ""}`}
            onClick={toggleCinema}
            aria-pressed={cinema}
            title="Cinema mode — fullscreen TV view"
          >
            Cinema
          </button>
          {showLive && (
            <div className="room-toggles" role="group" aria-label="Show / hide panels">
              {togButtons}
            </div>
          )}
          <a className="term-auth term-studio" href="/studio" title="Market Bubble Studio (admin)">
            Studio
          </a>
          <LoginMenu
            auth={auth}
            twitchReady={!!clientId}
            onTwitchLogin={() => startLogin("/")}
            onTwitchLogout={() => { clearAuth(); setAuth(null); }}
            onSaveClientId={(id) => { setClientId(id); setClientIdState(id); startLogin("/"); }}
          />
        </div>
      </header>
      </div>

      {/* ---- off air: replay theater · on air: arrangeable workspace ---- */}
      {!showLive ? (
        <OffAir />
      ) : (
      <div className="work">
        <div className="room-grid" data-stream={show.stream ? "1" : "0"} data-chat={show.chat ? "1" : "0"} data-index={show.index ? "1" : "0"}>
          {(show.stream || show.index || poll) && (
            <div className="room-left">
              {show.stream && (
                <section className="rp rp-stream">
                  <div className="rp-head">
                    <span className="rp-title">Stream</span>
                    <div className="panel-switch">
                      {streams.length > 1 &&
                        streams.map((st) => {
                          const on = selected?.source === st.source && selected?.channel === st.channel;
                          return (
                            <button key={`${st.source}:${st.channel}`} className={`term-switch-pill ${on ? "on" : ""}`} data-source={st.source} onClick={() => setSelected(st)}>
                              <SourceLogo source={st.source} size={11} /> {st.channel}
                            </button>
                          );
                        })}
                      <button
                        className="panel-fs-btn"
                        aria-label="Fullscreen"
                        title="Fullscreen (won't pause the stream)"
                        onClick={(e) => {
                          const panel = (e.currentTarget as HTMLElement).closest(".rp") as HTMLElement | null;
                          try {
                            if (document.fullscreenElement) document.exitFullscreen()?.catch?.(() => {});
                            else panel?.requestFullscreen?.()?.catch?.(() => {});
                          } catch {}
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M16 21h3a2 2 0 0 0 2-2v-3M8 21H5a2 2 0 0 1-2-2v-3" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  <div className="rp-body rp-body-stream">
                    {parent && !DEMO_MODE && !isLive && vod ? (
                      <div className="sp"><TwitchEmbed key={vod.id} video={vod.id} parent={parent} muted /></div>
                    ) : parent && !DEMO_MODE && selected?.source === "twitch" ? (
                      <div className="sp"><TwitchEmbed key={selected.channel} channel={selected.channel} parent={parent} muted /></div>
                    ) : playerSrc ? (
                      <div className="sp">
                        <iframe className="sp-frame" key={playerSrc} src={playerSrc} title={selected ? `${selected.source} — ${selected.channel}` : "stream"} allowFullScreen allow="autoplay; fullscreen; encrypted-media; picture-in-picture" frameBorder="0" />
                      </div>
                    ) : (
                      <div className="term-pip-empty"><span className="muted small">stream offline</span></div>
                    )}
                  </div>
                </section>
              )}
              <div className="room-substack">
              {poll && <PredictionCard poll={poll} />}
              {show.index && (
                <section className="rp rp-index">
                  <div className="rp-head">
                    <span className="rp-title">Live Audience</span>
                    <span className="panel-meta">Twitch · Kick · X</span>
                  </div>
                  <div className="rp-body rp-body-index">
                    <div className="term-index-quote">
                      {viewers ? (
                        <span className="views-pop-wrap">
                          <LiveNumber className="term-index-num" value={total} format={fmt} />
                          <span className="views-pop" role="tooltip">
                            <span className="views-pop-head">Audience · by source</span>
                            <ViewsPopRow source="twitch" label="Twitch" count={tw} channels={serverChannels?.twitch} />
                            <ViewsPopRow source="kick" label="Kick" count={kk} channels={serverChannels?.kick} />
                            <ViewsPopRow source="x" label={xLabel} count={xViews} breakdown={viewers?.xLive?.breakdown} channels={serverChannels?.xQuery ? [serverChannels.xQuery] : []} />
                            <span className="views-pop-foot">{fmt(total)} watching now</span>
                          </span>
                        </span>
                      ) : (
                        <span className="term-index-num">—</span>
                      )}
                      <span className={`term-index-delta ${delta >= 0 ? "up" : "down"}`}>
                        {delta >= 0 ? "▲" : "▼"} {fmtK(Math.abs(delta))}
                      </span>
                    </div>
                    <Sparkline data={history} up={delta >= 0} />
                    <div className="term-rows">
                      <IndexRow label="TWITCH" cls="tw" value={tw} pct={(tw / breakdown) * 100} />
                      <IndexRow label="KICK" cls="kk" value={kk} pct={(kk / breakdown) * 100} />
                      <IndexRow label={xIsLive ? "X LIVE" : "X VIEWS"} cls="x" value={xViews} pct={xViews > 0 ? 100 : 0} />
                    </div>
                    <div className="term-vol">
                      <div className="term-vol-cell"><LiveNumber className="term-vol-num" value={perMin} format={fmtK} flash={false} /><span className="term-vol-label">msgs / min</span></div>
                      <div className="term-vol-cell"><LiveNumber className="term-vol-num" value={chatters} format={fmtK} flash={false} /><span className="term-vol-label">chatters</span></div>
                      <div className="term-vol-cell"><LiveNumber className="term-vol-num" value={totalMessages} format={fmtK} /><span className="term-vol-label">messages</span></div>
                    </div>
                  </div>
                </section>
              )}
              </div>
            </div>
          )}
          {show.chat && (
            <section className="rp rp-chat">
              <div className="rp-head">
                <span className="rp-title">The Room</span>
                <span className="panel-meta panel-meta-row">
                  <span>{fmtK(chatters)} talking · {fmtK(perMin)}/min</span>
                  <button className={`chat-edit-btn ${editChat ? "on" : ""}`} onClick={() => setEditChat((v) => !v)} title="Customize your chat">{customized ? "Edit ✦" : "Edit"}</button>
                </span>
              </div>
              <div className="rp-body">
                <div className="panel-chat">
                  <div className="panel-chat-feed">
                    <ChatFeed messages={messages} options={feedOptions} profiles={profiles} onHoverUser={requestProfile} moderation={moderation} placeholder={<span>Waiting for the show to go live…</span>} />
                  </div>
                  {composerNode}
                </div>
              </div>
            </section>
          )}
          {!show.stream && !show.chat && !show.index && (
            <div className="room-allhidden"><span className="muted">Everything's hidden — use the Stream / Chat / Views buttons up top to bring panels back.</span></div>
          )}
        </div>
      </div>
      )}

      {showLive && focusMode && (
        <div className="room-toggles room-toggles-fs" role="group" aria-label="Show / hide panels">
          {togButtons}
        </div>
      )}


      {/* ---- bottom tape: live market ticker + brand ---- */}
      <div className="term-tape-slot">
      {/* a market ticker, not a page footer — plain div so it isn't a second
         contentinfo landmark (the site footer is the real one). */}
      <div className="term-tape" aria-label="Live market ticker">
        <span className="term-tape-cap left">Invest in yourself</span>
        <div className="term-tape-ticker"><Ticker /></div>
        <span className="term-tape-cap right">LIVE THURS 1PM · <b>Polymarket</b></span>
      </div>
      </div>
      </div>

      {/* ---- full site footer (scroll below the room) ---- */}
      <TermFooter />

      <CinemaMode
        open={cinema}
        onClose={() => setCinema(false)}
        fromRect={cinemaFrom.current}
        getReturnRect={playerRect}
        composer={composerNode}
        messages={messages}
        options={feedOptions}
        profiles={profiles}
        requestProfile={requestProfile}
        viewers={viewers}
        streams={streams}
        selected={selected}
        onSelect={setSelected}
        vod={vod}
        live={isLive}
        parent={parent}
      />

      <ChatCustomizer
        open={editChat}
        onClose={() => setEditChat(false)}
        look={myLook}
        onChange={patchChatPrefs}
        onReset={resetChatPrefs}
        customized={customized}
        overlayOptions={myOverlayOptions}
      />

      {toast && (
        <div className={`watch-toast ${toast.ok ? "ok" : "err"} ${toastIn ? "in" : "out"}`} role="status">
          {toast.text}
        </div>
      )}
    </div>
  );
}

function ViewsPopRow({
  source,
  label,
  count,
  channels,
  breakdown,
}: {
  source: Exclude<SourceKey, never>;
  label: string;
  count: number;
  channels?: string[];
  // when set (X across 3 broadcasts), render a sub-row per account beneath the
  // combined total — "who it's coming from".
  breakdown?: { host: string; viewers: number; live: boolean }[];
}) {
  const subs = breakdown && breakdown.length > 1 ? breakdown : null;
  return (
    <>
      <span className="views-pop-row" data-source={source}>
        <span className="views-pop-src">
          <SourceLogo source={source} size={13} /> {label}
        </span>
        <span className="views-pop-chan">
          {subs ? `${subs.length} broadcasts` : channels && channels.length ? channels.join(", ") : "—"}
        </span>
        <span className="views-pop-val">{count.toLocaleString()}</span>
      </span>
      {subs?.map((b) => (
        <span className="views-pop-row views-pop-sub" data-source={source} key={b.host}>
          <span className="views-pop-src views-pop-sub-name">
            <span className={`views-pop-dot ${b.live ? "live" : ""}`} aria-hidden="true" />
            {b.host}
          </span>
          <span className="views-pop-chan">{b.live ? "live" : "ended"}</span>
          <span className="views-pop-val">{b.viewers.toLocaleString()}</span>
        </span>
      ))}
    </>
  );
}

function IndexRow({ label, cls, value, pct }: { label: string; cls: string; value: number; pct: number }) {
  return (
    <div className="term-row">
      <span className={`term-row-name ${cls}`}>{label}</span>
      <div className="term-row-track">
        <span className={`term-row-fill ${cls}`} style={{ width: `${Math.max(2, pct)}%` }} />
      </div>
      <LiveNumber className="term-row-val" value={value} format={fmtK} />
      <span className="term-row-pct">{Math.round(pct)}%</span>
    </div>
  );
}

function Sparkline({ data, up }: { data: number[]; up: boolean }) {
  if (data.length < 2) return <div className="term-spark empty" />;
  const w = 100;
  const h = 28;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg className={`term-spark ${up ? "up" : "down"}`} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <polyline points={pts} fill="none" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
