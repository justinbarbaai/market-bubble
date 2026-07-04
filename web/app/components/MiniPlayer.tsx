"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { usePlayer } from "../lib/player";
import { sourceLabel } from "../lib/media";
import { MediaPlayer, mediaEmbeddable } from "./MediaPlayer";

const HUB_HTTP = (process.env.NEXT_PUBLIC_HUB_URL || "ws://localhost:8080").replace(/^ws/, "http");

// Auto-open the mini-player on load so there's always a stream playing (muted),
// like Twitch does. Skips Home (it has its own theater), Studio, and the bare
// overlay/reader routes. Dismissible — closing it keeps it closed for the session.
export function AutoMini() {
  const { mini, openMini } = usePlayer();
  const path = usePathname();
  useEffect(() => {
    if (mini || !path) return;
    if (
      path === "/" ||
      path.startsWith("/overlay") ||
      path.startsWith("/studio") ||
      path.startsWith("/watch")
    )
      return;
    try {
      if (sessionStorage.getItem("mb.miniDismissed")) return;
    } catch {}
    let alive = true;
    fetch(`${HUB_HTTP}/content`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive || !d?.streams) return;
        // pick the latest embeddable (Twitch) VOD
        const s = d.streams.find((v: { source?: string; url?: string }) => v.source === "twitch" && v.url);
        if (s?.url) {
          openMini({
            kind: "vod",
            title: s.title,
            url: s.url,
            source: s.source,
            thumb: s.thumb,
            date: s.date,
            duration: s.duration,
            views: s.views,
          });
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [path, mini, openMini]);
  return null;
}

// Floating, draggable mini-player. Lives in the root layout so it persists
// across page navigations and keeps playing (muted). Drag by the header.
export function MiniPlayer() {
  const { mini, miniCollapsed, closeMini, toggleMiniSize, play } = usePlayer();
  const [parent, setParent] = useState("");
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);

  useEffect(() => setParent(window.location.hostname), []);

  // Default position: bottom-right, once we know the viewport.
  useEffect(() => {
    if (mini && !pos && typeof window !== "undefined") {
      setPos({ x: window.innerWidth - 380, y: window.innerHeight - 280 });
    }
  }, [mini, pos]);

  const onDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest(".mini-btn")) return;
    const base = pos || { x: window.innerWidth - 380, y: window.innerHeight - 280 };
    dragRef.current = { dx: e.clientX - base.x, dy: e.clientY - base.y };
    const move = (ev: PointerEvent) => {
      if (!dragRef.current) return;
      const w = 360;
      const x = Math.max(8, Math.min(ev.clientX - dragRef.current.dx, window.innerWidth - w - 8));
      const y = Math.max(8, Math.min(ev.clientY - dragRef.current.dy, window.innerHeight - 80));
      setPos({ x, y });
    };
    const up = () => {
      dragRef.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  if (!mini || typeof document === "undefined") return null;

  const embeddable = parent && mediaEmbeddable(mini);
  const label = sourceLabel(mini.source);

  return createPortal(
    <div className={`mini ${miniCollapsed ? "collapsed" : ""}`} style={pos ? { left: pos.x, top: pos.y } : undefined}>
      <div className="mini-head" onPointerDown={onDown}>
        <span className="mini-title">{mini.title || `${label} stream`}</span>
        <span className="mini-actions">
          <button className="mini-btn" onClick={() => play(mini)} title="Expand" aria-label="Expand">
            ⤢
          </button>
          <button className="mini-btn" onClick={toggleMiniSize} title={miniCollapsed ? "Show" : "Hide"} aria-label="Collapse">
            {miniCollapsed ? "▢" : "—"}
          </button>
          <button className="mini-btn" onClick={closeMini} title="Close" aria-label="Close">
            ✕
          </button>
        </span>
      </div>
      {!miniCollapsed && (
        <div className="mini-stage">
          {embeddable ? (
            <MediaPlayer media={mini} muted />
          ) : (
            <a className="mini-noembed" href={mini.url} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {mini.thumb && <img src={mini.thumb} alt={mini.title} />}
              <span>Watch on {label} ↗</span>
            </a>
          )}
        </div>
      )}
    </div>,
    document.body
  );
}
