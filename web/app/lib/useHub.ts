"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SourceKey } from "../components/logos";
import type { OverlayOptions } from "./overlay";

export type LiveStyle = Partial<OverlayOptions>;

export type MessageFragment =
  | { type: "text"; text: string }
  | { type: "emote"; name: string; url: string };

export interface ChatBadge {
  type: string;
  title: string;
  img: string | null;
}

export interface Profile {
  source: string;
  login: string;
  displayName: string;
  avatar: string | null;
  createdAt: string | null;
  description: string | null;
}

export interface ChatMessage {
  id: string;
  source: SourceKey;
  username: string;
  userId?: string | null;
  text: string;
  timestamp: number;
  color: string;
  userColor?: string | null;
  channel?: string | null;
  fragments?: MessageFragment[] | null;
  badges?: ChatBadge[] | null;
}

export interface SourceStatus {
  connected: boolean;
  channel: string;
}

export interface Channels {
  twitch: string[];
  kick: string[];
  xQuery: string;
  // X handle whose native Live broadcast we read viewer/view counts for.
  // Optional: only the control panel sets it, so overlay/reader pushes don't
  // clobber the server's configured handle.
  xLiveHandle?: string;
  // Bring-your-own X bearer token (private-scope overlays only): the X stream
  // for xQuery runs on the OVERLAY OWNER's token, billing their account, never
  // the show's. Carried in the overlay link's #fragment, sent only over WSS.
  xToken?: string;
}

export interface ChannelViewers {
  source: SourceKey;
  channel: string;
  live: boolean;
  viewers: number;
}

export interface XViews {
  enabled: boolean;
  views: number;
  posts: number;
  updatedAt: number;
}

export interface XLive {
  handle: string;
  live: boolean;
  viewers: number;
  views: number;
  // per-broadcast counts (Banks / Ansem / Market Bubble) — the bar shows the
  // summed `viewers`, the hover lists these.
  breakdown?: { host: string; viewers: number; live: boolean }[];
  broadcastId?: string | null;
  title?: string | null;
  updatedAt: number;
}

export interface ViewerSnapshot {
  channels: ChannelViewers[];
  totals: { twitch: number; kick: number; total: number };
  twitchEnabled: boolean;
  x?: XViews | null;
  xLive?: XLive | null;
  updatedAt: number;
}

// Live "chat vs the market" poll (Polymarket). null when no market is featured.
export interface Poll {
  id: string;
  slug: string;
  question: string;
  oddsYes: number | null; // Polymarket's real YES probability (0..1)
  url: string | null;
  open: boolean;
  yes: number;
  no: number;
  total: number;
}

const HUB_URL = process.env.NEXT_PUBLIC_HUB_URL || "ws://localhost:8080";
const MAX_BUFFER = 500;

// Operator key (stored only after the Studio gate validates it server-side).
// Appended to the WS URL so the hub grants this socket operator privileges.
// Viewers never have it, so they can only do viewer actions.
function hubUrlWithKey(): string {
  if (typeof window === "undefined") return HUB_URL;
  try {
    const key = localStorage.getItem("mb.operatorKey");
    if (key) return `${HUB_URL}${HUB_URL.includes("?") ? "&" : "?"}key=${encodeURIComponent(key)}`;
  } catch {}
  return HUB_URL;
}

type UseHubArgs = {
  // If set, the hub is told to follow these channels on every (re)connect.
  // Used by the overlay so the link is self-contained.
  pushChannels?: Channels | null;
  // Private subscription: this connection gets its own dedicated sources and
  // does NOT receive the shared/global feed. Used by the pop-out reader so it
  // can watch a separate set of channels from the overlay.
  privateScope?: boolean;
};

export function useHub({ pushChannels = null, privateScope = false }: UseHubArgs = {}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // Cumulative count for this session (the buffer is capped; this isn't).
  const [totalMessages, setTotalMessages] = useState(0);
  const [statuses, setStatuses] = useState<Record<SourceKey, SourceStatus>>({
    twitch: { connected: false, channel: "" },
    kick: { connected: false, channel: "" },
    x: { connected: false, channel: "" },
  });
  const [hubConnected, setHubConnected] = useState(false);
  const [xEnabled, setXEnabled] = useState(true);
  const [kickEnabled, setKickEnabled] = useState(false);
  const [kickConnected, setKickConnected] = useState(false);
  const [modResult, setModResult] = useState<{ ok: boolean; error: string | null; action?: string; ts: number } | null>(null);
  const [sendResult, setSendResult] = useState<{ ok: boolean; error: string | null; ts: number } | null>(null);
  const [serverChannels, setServerChannels] = useState<Channels | null>(null);
  const [liveStyle, setLiveStyle] = useState<LiveStyle | null>(null);
  const [siteLook, setSiteLook] = useState<LiveStyle | null>(null);
  const [viewers, setViewers] = useState<ViewerSnapshot | null>(null);
  const [poll, setPoll] = useState<Poll | null>(null);
  const [profiles, setProfiles] = useState<Record<string, Profile | null>>({});
  const requestedProfiles = useRef<Set<string>>(new Set());

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const delayRef = useRef(1000);
  const pushRef = useRef<Channels | null>(pushChannels);
  pushRef.current = pushChannels;

  const sendChannels = useCallback((channels: Channels, xToken?: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== ws.OPEN) return;
    ws.send(
      JSON.stringify({
        type: "config",
        ...(privateScope ? { scope: "private" } : {}),
        twitchChannels: channels.twitch,
        kickChannels: channels.kick,
        xQuery: channels.xQuery.trim(),
        ...(channels.xLiveHandle !== undefined
          ? { xLiveHandle: channels.xLiveHandle.trim().replace(/^@/, "") }
          : {}),
        // Only sent from the control panel (never the overlay link).
        ...(xToken && xToken.trim() ? { xToken: xToken.trim() } : {}),
      })
    );
  }, [privateScope]);

  // If the pushed channels change while the socket is open (the overlay studio
  // edits them live), re-send the follow and restart the feed clean.
  const pushKey = pushChannels
    ? JSON.stringify([pushChannels.twitch, pushChannels.kick, pushChannels.xQuery, pushChannels.xToken ?? ""])
    : "";
  const pushKeyRef = useRef(pushKey);
  useEffect(() => {
    if (pushKeyRef.current === pushKey) return;
    pushKeyRef.current = pushKey;
    const push = pushRef.current;
    const ws = wsRef.current;
    if (!push || !ws || ws.readyState !== ws.OPEN) return;
    if (push.twitch.length || push.kick.length || push.xQuery) {
      setMessages([]);
      sendChannels(push, push.xToken);
    }
  }, [pushKey, sendChannels]);

  const connect = useCallback(() => {
    // Tear down any existing socket first so we never run two in parallel —
    // React strict-mode double-mount and reconnect races would otherwise leave
    // multiple live sockets, each delivering every message (duplicate chats).
    const existing = wsRef.current;
    if (existing) {
      existing.onopen = existing.onmessage = existing.onclose = existing.onerror = null;
      try {
        existing.close();
      } catch {}
      wsRef.current = null;
    }

    let ws: WebSocket;
    try {
      ws = new WebSocket(hubUrlWithKey());
    } catch {
      scheduleReconnect();
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      setHubConnected(true);
      delayRef.current = 1000;
      // Self-contained overlay: tell the hub which channels to follow.
      const push = pushRef.current;
      if (push && (push.twitch.length || push.kick.length || push.xQuery)) {
        sendChannels(push, push.xToken);
      }
    };

    ws.onmessage = (event) => {
      let msg: any;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      if (msg.type === "message") {
        setTotalMessages((n) => n + 1);
        setMessages((prev) => {
          const next = [
            ...prev,
            {
              id: `${msg.source}-${msg.timestamp}-${Math.random().toString(36).slice(2, 8)}`,
              source: msg.source as SourceKey,
              username: msg.username,
              userId: msg.userId ?? null,
              text: msg.text,
              timestamp: msg.timestamp,
              color: msg.color,
              userColor: msg.userColor ?? null,
              channel: msg.channel ?? null,
              fragments: msg.fragments ?? null,
              badges: msg.badges ?? null,
            },
          ];
          return next.length > MAX_BUFFER ? next.slice(next.length - MAX_BUFFER) : next;
        });
      } else if (msg.type === "status") {
        setStatuses((prev) => ({
          ...prev,
          [msg.source as SourceKey]: {
            connected: msg.connected,
            channel: msg.channel ?? prev[msg.source as SourceKey]?.channel ?? "",
          },
        }));
      } else if (msg.type === "config") {
        if (typeof msg.xEnabled === "boolean") setXEnabled(msg.xEnabled);
        if (typeof msg.kickEnabled === "boolean") setKickEnabled(msg.kickEnabled);
        if (typeof msg.kickConnected === "boolean") setKickConnected(msg.kickConnected);
        if (msg.config) {
          setServerChannels({
            twitch: msg.config.twitchChannels ?? [],
            kick: msg.config.kickChannels ?? [],
            xQuery: msg.config.xQuery ?? "",
            xLiveHandle: msg.config.xLiveHandle ?? "",
          });
        }
      } else if (msg.type === "style") {
        if (msg.style && typeof msg.style === "object") setLiveStyle(msg.style);
      } else if (msg.type === "siteLook") {
        if (msg.look && typeof msg.look === "object") setSiteLook(msg.look);
      } else if (msg.type === "viewers") {
        if (msg.viewers && typeof msg.viewers === "object") setViewers(msg.viewers);
      } else if (msg.type === "profile") {
        const key = `${msg.source}:${String(msg.name).toLowerCase()}`;
        setProfiles((prev) => ({ ...prev, [key]: msg.data ?? null }));
      } else if (msg.type === "modResult") {
        setModResult({ ok: !!msg.ok, error: msg.error ?? null, action: msg.action, ts: Date.now() });
      } else if (msg.type === "sendResult") {
        setSendResult({ ok: !!msg.ok, error: msg.error ?? null, ts: Date.now() });
      } else if (msg.type === "poll") {
        setPoll(msg.poll ?? null);
      }
    };

    const onDrop = () => {
      setHubConnected(false);
      setStatuses((prev) => ({
        twitch: { ...prev.twitch, connected: false },
        kick: { ...prev.kick, connected: false },
        x: { ...prev.x, connected: false },
      }));
      scheduleReconnect();
    };

    ws.onclose = onDrop;
    ws.onerror = () => ws.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendChannels]);

  const scheduleReconnect = useCallback(() => {
    if (reconnectRef.current) clearTimeout(reconnectRef.current);
    reconnectRef.current = setTimeout(() => connect(), delayRef.current);
    delayRef.current = Math.min(delayRef.current * 2, 15000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connect]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      const ws = wsRef.current;
      if (ws) {
        // Detach handlers (esp. onclose) so teardown doesn't trigger a reconnect.
        ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
        try {
          ws.close();
        } catch {}
        wsRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyChannels = useCallback(
    (channels: Channels, xToken?: string) => {
      sendChannels(channels, xToken);
      setMessages([]);
    },
    [sendChannels]
  );

  const clearMessages = useCallback(() => setMessages([]), []);

  // Lazily ask the hub for a chatter's profile (for the hover card). Each
  // name is requested at most once per session.
  const requestProfile = useCallback((source: string, name: string) => {
    const clean = name.trim();
    if (!clean) return;
    const key = `${source}:${clean.toLowerCase()}`;
    if (requestedProfiles.current.has(key)) return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== ws.OPEN) return;
    requestedProfiles.current.add(key);
    ws.send(JSON.stringify({ type: "profile", source, name: clean }));
  }, []);

  // Kick timeout/ban via the hub (uses the connected Kick account's token).
  const moderateKick = useCallback(
    (slug: string, action: "timeout" | "ban", targetUserId: string, duration?: number) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== ws.OPEN) return;
      ws.send(JSON.stringify({ type: "kickModerate", slug, action, targetUserId, duration }));
    },
    []
  );

  const sendKick = useCallback((slug: string, content: string, kickSession?: string | null) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify({ type: "kickSend", slug, content, kickSession: kickSession || undefined }));
  }, []);

  const disconnectKickAccount = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify({ type: "kickDisconnect" }));
  }, []);

  // Push the current overlay style to the hub so live overlays update without
  // re-copying their link.
  const pushStyle = useCallback((style: LiveStyle) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify({ type: "style", style }));
  }, []);

  // Admin: set the public room chat appearance for everyone.
  const pushSiteLook = useCallback((look: LiveStyle) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify({ type: "siteLook", look }));
  }, []);

  return {
    messages,
    totalMessages,
    statuses,
    hubConnected,
    xEnabled,
    serverChannels,
    liveStyle,
    siteLook,
    pushSiteLook,
    viewers,
    poll,
    profiles,
    requestProfile,
    kickEnabled,
    kickConnected,
    modResult,
    sendResult,
    moderateKick,
    sendKick,
    disconnectKickAccount,
    pushStyle,
    applyChannels,
    clearMessages,
    hubUrl: HUB_URL,
    hubHttpUrl: HUB_URL.replace(/^ws/, "http"),
  };
}
