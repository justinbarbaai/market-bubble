"use client";

import { useEffect, useId } from "react";

// Twitch's iframe VOD embeds don't reliably autoplay (they show a play button).
// The Embed JS API does — we create the player and force play() (muted, so the
// browser allows it), retrying, and also on the first user interaction as a
// fallback. Used for VODs + live channels (clips autoplay via their own iframe).

let scriptPromise: Promise<void> | null = null;
function loadTwitch(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((window as any).Twitch?.Embed) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://embed.twitch.tv/embed/v1.js";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject();
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export function TwitchEmbed({
  video,
  channel,
  parent,
  muted = true,
}: {
  video?: string | null;
  channel?: string | null;
  parent: string;
  muted?: boolean;
}) {
  const rawId = useId();
  const domId = "tw-" + rawId.replace(/[^a-zA-Z0-9_-]/g, "");

  useEffect(() => {
    let cancelled = false;
    let cleanupGesture: (() => void) | null = null;
    if (!video && !channel) return;

    loadTwitch()
      .then(() => {
        if (cancelled) return;
        const el = document.getElementById(domId);
        if (!el) return;
        el.innerHTML = "";
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const Twitch = (window as any).Twitch;
        if (!Twitch?.Embed) return;

        // Pass the element ID *string* (the Embed API expects an id, not a node).
        const embed = new Twitch.Embed(domId, {
          width: "100%",
          height: "100%",
          parent: [parent],
          autoplay: true,
          muted,
          layout: "video",
          ...(video ? { video } : { channel }),
        });

        // Mute is forced ONLY for the very first autoplay — browsers block
        // autoplay WITH sound, so the stream has to start muted. After it's
        // playing we never touch the mute state again, so when the viewer
        // unmutes it STICKS: clicking anywhere on the site, switching tabs, or
        // the watchdog resuming a pause no longer slams it back to muted.
        let didInitialPlay = false;
        const forcePlay = () => {
          try {
            const p = embed.getPlayer();
            if (muted && !didInitialPlay) {
              p.setMuted(true);
              p.setVolume(0);
            }
            p.play();
            didInitialPlay = true;
          } catch {}
        };

        // The viewer owns playback once they actually click INTO the player —
        // iframe clicks don't bubble, but they steal window focus, so a blur
        // landing on our container WHILE THE TAB STAYS VISIBLE means a real
        // click (a tab/app switch hides the document at the same moment — and
        // the embed grabbing focus on load must not count).
        let userOwnsPlayback = false;
        // The embed grabs window focus WHILE IT INITIALIZES, which looks exactly
        // like the viewer clicking in — and that would wrongly flag "user owns
        // playback" and disable the watchdog, leaving a VOD/stream sitting paused
        // on load. So ignore focus-based ownership for the first couple seconds.
        let armed = false;
        const armTimer = setTimeout(() => { armed = true; }, 2500);
        const onBlur = () => {
          if (armed && document.visibilityState === "visible" && el.contains(document.activeElement))
            userOwnsPlayback = true;
        };
        window.addEventListener("blur", onBlur);
        // Coming back to the tab re-arms the watchdog — the replay should be
        // rolling again whenever the viewer returns.
        const onVisible = () => {
          if (document.visibilityState === "visible") {
            userOwnsPlayback = false;
            forcePlay();
          }
        };
        document.addEventListener("visibilitychange", onVisible);
        // Entering / leaving fullscreen makes the Twitch player pause itself —
        // and often a BEAT AFTER the event fires, so a single replay misses it.
        // Re-arm the watchdog (in case the viewer had clicked in) and retry play
        // across the transition. Mute is preserved (forcePlay only mutes once).
        const fsTimers: ReturnType<typeof setTimeout>[] = [];
        const onFs = () => {
          userOwnsPlayback = false;
          [0, 250, 600, 1200, 2000].forEach((d) =>
            fsTimers.push(setTimeout(() => forcePlay(), d))
          );
        };
        document.addEventListener("fullscreenchange", onFs);

        // Watchdog: Twitch's embed pauses itself when scrolled offscreen, when
        // its container resizes (e.g. entering/leaving fullscreen), and sometimes
        // never starts under a busy load. This is a live show — keep it rolling:
        // resume ANY pause within ~1.2s. (We deliberately do NOT honor
        // userOwnsPlayback here — that flag was leaving the stream stuck paused
        // after fullscreen if the viewer had clicked in. Mute is still preserved,
        // so a viewer who unmuted stays unmuted.)
        const iv = setInterval(() => {
          if (cancelled) return;
          try {
            const p = embed.getPlayer();
            if (p.isPaused && p.isPaused()) forcePlay();
          } catch {}
        }, 1200);

        // THE fullscreen-pause fix: the room's "focus" mode doesn't use the
        // Fullscreen API at all (verified — it never fires) — it just collapses
        // the header/ticker, which RESIZES the player, and Twitch pauses through a
        // container resize. Watch the player's own box and resume the moment the
        // resize settles (when the player is stable), then once more shortly after.
        let roT: ReturnType<typeof setTimeout> | undefined;
        const ro = new ResizeObserver(() => {
          clearTimeout(roT);
          roT = setTimeout(() => {
            forcePlay();
            setTimeout(forcePlay, 450);
          }, 250);
        });
        try { ro.observe(el); } catch {}

        embed.addEventListener(Twitch.Embed.VIDEO_READY, () => forcePlay());

        // Fallback: the moment the viewer interacts anywhere, start playback.
        const onGesture = () => {
          if (!userOwnsPlayback) forcePlay();
        };
        window.addEventListener("pointerdown", onGesture, { once: true });
        window.addEventListener("keydown", onGesture, { once: true });
        cleanupGesture = () => {
          clearInterval(iv);
          clearTimeout(armTimer);
          clearTimeout(roT);
          try { ro.disconnect(); } catch {}
          fsTimers.forEach(clearTimeout);
          window.removeEventListener("pointerdown", onGesture);
          window.removeEventListener("keydown", onGesture);
          window.removeEventListener("blur", onBlur);
          document.removeEventListener("visibilitychange", onVisible);
          document.removeEventListener("fullscreenchange", onFs);
        };
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      cleanupGesture?.();
      const el = document.getElementById(domId);
      if (el) el.innerHTML = "";
    };
  }, [video, channel, parent, muted, domId]);

  return <div id={domId} className="tw-embed" />;
}
