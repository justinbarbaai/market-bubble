"use client";

import { useEffect, useMemo, useState } from "react";
import { StyleControls } from "./StyleControls";
import { buildQuery, type LookOptions, type OverlayOptions } from "../lib/overlay";

// The viewer's own overlay channels (their stream, not the show's) — saved on
// this device only, used purely to build their overlay/pop-out links. The
// site's chat feed never touches any of this.
type MyChannels = { twitch: string; kick: string; xQuery: string; xToken: string };
const MY_KEY = "mb.cc.myChannels";
const EMPTY_MINE: MyChannels = { twitch: "", kick: "", xQuery: "", xToken: "" };
const splitList = (s: string) => s.split(",").map((x) => x.trim().replace(/^@/, "")).filter(Boolean);

// A slide-in drawer for the viewer to style THEIR OWN chat. Changes write to
// per-device prefs and the live chat behind it updates instantly (preview).
// Also exports the viewer's styled chat as a pop-out / OBS overlay URL.
export function ChatCustomizer({
  open,
  onClose,
  look,
  onChange,
  onReset,
  customized,
  overlayOptions,
}: {
  open: boolean;
  onClose: () => void;
  look: LookOptions;
  onChange: (patch: Partial<LookOptions>) => void;
  onReset: () => void;
  customized: boolean;
  overlayOptions: OverlayOptions;
}) {
  const [copied, setCopied] = useState(false);
  const [mine, setMine] = useState<MyChannels>(EMPTY_MINE);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(MY_KEY);
      if (raw) setMine({ ...EMPTY_MINE, ...JSON.parse(raw) });
    } catch {}
  }, []);
  const patchMine = (p: Partial<MyChannels>) => {
    setMine((m) => {
      const next = { ...m, ...p };
      try {
        localStorage.setItem(MY_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  };
  const hasMine = !!(mine.twitch.trim() || mine.kick.trim());

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  // The exported links carry the show's channels by default — or the viewer's
  // own, if they filled any in. (X live chat has no API — it comes only from the
  // show's X Bridge, so there's no per-viewer X option here.)
  const linkOptions: OverlayOptions = useMemo(() => {
    if (!hasMine) return overlayOptions;
    return {
      ...overlayOptions,
      twitch: splitList(mine.twitch),
      kick: splitList(mine.kick),
      xQuery: "",
    };
  }, [overlayOptions, hasMine, mine]);
  const overlayUrl = origin ? `${origin}/overlay?${buildQuery(linkOptions)}` : "";
  const readerUrl = origin ? `${origin}/reader?${buildQuery(linkOptions)}` : "";
  const popReader = () => window.open(readerUrl, "mbreader", "width=440,height=760,resizable=yes");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(overlayUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {}
  };
  return (
    <>
      <div className={`cc-scrim ${open ? "in" : ""}`} onClick={onClose} aria-hidden="true" />
      <aside
        className={`cc-drawer ${open ? "in" : ""}`}
        role="dialog"
        aria-label="Customize your chat"
        aria-hidden={!open}
        // when closed, take its form controls out of the tab order entirely
        // (aria-hidden alone leaves them focusable → WCAG aria-hidden-focus fail)
        {...(open ? {} : { inert: true })}
      >
        <div className="cc-head">
          <span className="cc-title">Your Chat</span>
          <button className="cc-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p className="cc-note">
          Saved on this device — only changes <b>your</b> view, never anyone else's.
        </p>

        <div className="cc-body">
          <StyleControls value={look} onChange={onChange} />

          <button className="cc-popout" onClick={popReader}>
            ↗ Pop out chat into its own window
          </button>

          <div className="cc-overlay">
            <span className="cc-overlay-title">Your overlay</span>
            <p className="cc-overlay-note">
              Your styled chat as a link — pop it out or drop it into OBS as a browser source.
              It follows the show&apos;s chat, or your own channels below.
            </p>
            <div className="cc-mine">
              <input
                className="cc-mine-input"
                value={mine.twitch}
                onChange={(e) => patchMine({ twitch: e.target.value })}
                placeholder="Your Twitch channel (optional)"
                spellCheck={false}
              />
              <input
                className="cc-mine-input"
                value={mine.kick}
                onChange={(e) => patchMine({ kick: e.target.value })}
                placeholder="Your Kick channel (optional)"
                spellCheck={false}
              />
            </div>
            <input className="cc-overlay-url" value={overlayUrl} readOnly onFocus={(e) => e.currentTarget.select()} />
            <div className="cc-overlay-btns">
              <button className="cc-overlay-copy" onClick={copy}>
                {copied ? "Copied ✓" : "Copy link"}
              </button>
              <a className="cc-overlay-open" href={overlayUrl} target="_blank" rel="noreferrer">
                Open ↗
              </a>
            </div>
          </div>
        </div>

        <div className="cc-foot">
          {customized ? (
            <button className="cc-reset" onClick={onReset}>
              Reset to show default
            </button>
          ) : (
            <span className="cc-foot-hint">Matching the show's default look</span>
          )}
        </div>
      </aside>
    </>
  );
}
