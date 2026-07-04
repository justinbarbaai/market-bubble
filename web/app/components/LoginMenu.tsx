"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { SourceLogo } from "./logos";
import { fetchTwitchAvatar, type TwitchAuth } from "../lib/twitchAuth";
import { useKickSession } from "../lib/kickAuth";

type Props = {
  auth: TwitchAuth | null;
  twitchReady: boolean; // a Twitch Client ID is configured
  onTwitchLogin: () => void;
  onTwitchLogout: () => void;
  onSaveClientId: (id: string) => void;
};

// Unified sign-in menu in the header. Twitch + Kick are both per-viewer (sign in
// to type in the chat as yourself). The dropdown is portaled to <body> with fixed
// positioning so the header's overflow/transform can't clip it.
export function LoginMenu({
  auth,
  twitchReady,
  onTwitchLogin,
  onTwitchLogout,
  onSaveClientId,
}: Props) {
  const [open, setOpen] = useState(false);
  const [idInput, setIdInput] = useState("");
  const [coords, setCoords] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const { session: kick, signIn: kickSignIn, signOut: kickSignOut } = useKickSession();
  const router = useRouter();

  const place = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setCoords({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) });
  };

  const toggle = () => {
    // Signed in → the pfp opens YOUR PROFILE (public card + connect everything).
    // The sign-in dropdown is only for logged-out visitors; sign-out moved to
    // the profile page's "Chat identities".
    if (auth || kick) {
      router.push("/profile");
      return;
    }
    if (!open) place();
    setOpen((o) => !o);
  };

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onMove = () => setOpen(false); // close on scroll/resize (position would go stale)
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open]);

  const save = () => {
    const id = idInput.trim();
    if (id) onSaveClientId(id);
  };

  // When signed in, show the profile photo in a circle instead of "@handle".
  // Twitch: the account's REAL pfp from Helix (their own token) — unavatar is
  // only the interim fallback while it loads. Kick: unavatar (no public API).
  const signedIn = !!auth || !!kick;
  const [twAvatar, setTwAvatar] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (auth) fetchTwitchAvatar(auth).then((u) => { if (live) setTwAvatar(u); });
    else setTwAvatar(null);
    return () => { live = false; };
  }, [auth]);
  const avatarUrl = auth
    ? twAvatar || `https://unavatar.io/twitch/${auth.login}`
    : kick?.username
    ? `https://unavatar.io/kick/${kick.username}`
    : "";

  return (
    <div className="login-menu">
      <button
        ref={btnRef}
        className={`term-auth ${signedIn ? "on" : ""} ${signedIn && avatarUrl ? "has-av" : ""}`}
        onClick={toggle}
        aria-expanded={open}
        aria-label={signedIn ? "Your account" : "Log in"}
      >
        {signedIn && avatarUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img className="login-av" src={avatarUrl} alt="Your account" />
        ) : signedIn ? (
          "Account"
        ) : (
          "Log in"
        )}
      </button>

      {open &&
        coords &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popRef}
            className="login-pop"
            role="dialog"
            aria-label="Sign in"
            style={{ top: coords.top, right: coords.right }}
          >
            <div className="login-pop-head">Sign in to chat in the room</div>

            {/* Twitch — per-viewer */}
            <div className="login-row">
              <span className="login-row-id">
                <SourceLogo source="twitch" size={15} /> Twitch
              </span>
              {auth ? (
                <span className="login-row-act">
                  <span className="login-row-on">@{auth.login}</span>
                  <button className="login-link" onClick={onTwitchLogout}>
                    Sign out
                  </button>
                </span>
              ) : twitchReady ? (
                <button className="login-btn tw" onClick={onTwitchLogin}>
                  Sign in
                </button>
              ) : (
                <span className="login-row-setup">
                  <input
                    value={idInput}
                    onChange={(e) => setIdInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && save()}
                    placeholder="Twitch Client ID"
                    spellCheck={false}
                  />
                  <button className="login-btn tw" onClick={save}>
                    Save
                  </button>
                </span>
              )}
            </div>

            {/* Kick — per-viewer sign-in */}
            <div className="login-row">
              <span className="login-row-id">
                <SourceLogo source="kick" size={15} /> Kick
              </span>
              {kick ? (
                <span className="login-row-act">
                  <span className="login-row-on">{kick.username ? `@${kick.username}` : "Signed in"}</span>
                  <button className="login-link" onClick={kickSignOut}>
                    Sign out
                  </button>
                </span>
              ) : (
                <button className="login-btn kk" onClick={kickSignIn}>
                  Sign in
                </button>
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
