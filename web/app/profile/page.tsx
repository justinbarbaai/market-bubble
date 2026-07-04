"use client";

import { useCallback, useEffect, useState } from "react";
import { TermShell } from "../components/TermShell";
import { SourceLogo } from "../components/logos";
import { ConnectAccounts, ProfilePanel } from "../components/ProfileSections";
import { useHub } from "../lib/useHub";
import type { MemberCard } from "../lib/useHub";
import { getAuth, clearAuth, startLogin } from "../lib/twitchAuth";
import { useKickSession } from "../lib/kickAuth";

// Your profile — opened from the pfp in the header. Shows the member card the
// room sees when they hover you in chat (Floor rank, Bubbles, clips, socials),
// and is where you connect everything: chat identities, clip accounts, payout
// addresses + social links.

const fmt = (n: number) => n.toLocaleString("en-US");

export default function ProfilePage() {
  const { hubHttpUrl } = useHub();
  const { session: kick, signIn: kickSignIn, signOut: kickSignOut } = useKickSession();

  const [twitch, setTwitch] = useState<{ login: string } | null>(null);
  useEffect(() => {
    const a = getAuth();
    setTwitch(a?.login ? { login: a.login } : null);
  }, []);

  // The identity the profile is keyed to (Twitch first, then Kick — same rule
  // as Clip-to-Earn, so everything lands on one Floor identity).
  const identity =
    twitch ? ({ source: "twitch", username: twitch.login } as const)
    : kick?.username ? ({ source: "kick", username: kick.username } as const)
    : null;

  // The public member card (what chat sees on hover).
  const [member, setMember] = useState<MemberCard | null>(null);
  const loadMember = useCallback(() => {
    if (!identity) { setMember(null); return; }
    fetch(`${hubHttpUrl}/member?source=${identity.source}&username=${encodeURIComponent(identity.username)}`)
      .then((r) => r.json())
      .then((j) => setMember(j?.member ?? null))
      .catch(() => {});
  }, [hubHttpUrl, identity?.source, identity?.username]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadMember(); }, [loadMember]);

  const avatar = identity
    ? `https://unavatar.io/${identity.source === "twitch" ? "twitch" : "kick"}/${encodeURIComponent(identity.username)}`
    : "";

  return (
    <TermShell>
      <section className="mb-section-head">
        <h1 className="mb-page-title">Your profile</h1>
        <p className="mb-page-sub">what the room sees — and where you connect your stuff</p>
      </section>

      {!identity ? (
        <section className="clip-submit">
          <div className="clip-signin">
            <p>Sign in to build your profile — earn Bubbles, submit clips, get paid.</p>
            <div className="clip-signin-btns">
              <button className="clip-submit-btn" onClick={() => startLogin("/profile")}>
                Sign in with Twitch
              </button>
              <button className="clip-submit-btn ghost" onClick={() => kickSignIn()}>
                Connect Kick
              </button>
            </div>
          </div>
        </section>
      ) : (
        <div className="profpage">
          {/* ---- the public card: who you are + your standing ---- */}
          <section className="profpage-hero">
            <span className="profpage-av">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={avatar} alt="" onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
              <b>{identity.username.charAt(0).toUpperCase()}</b>
            </span>
            <div className="profpage-id">
              <span className="profpage-name">{identity.username}</span>
              <span className="profpage-handle">
                <SourceLogo source={identity.source} size={13} /> @{identity.username} · {identity.source}
              </span>
            </div>
            <div className="profpage-stats">
              <span className="profpage-stat">
                <b>{member?.points != null ? fmt(member.points) : "0"} ◆</b>
                <span>Bubbles</span>
              </span>
              <span className="profpage-stat">
                <b>{member?.rank != null ? `#${member.rank}` : "—"}</b>
                <span>The Floor</span>
              </span>
              <span className="profpage-stat">
                <b>{member?.clips ? fmt(member.clips.approved) : "0"}</b>
                <span>clips</span>
              </span>
              <span className="profpage-stat">
                <b>{member?.clips ? fmt(member.clips.views) : "0"}</b>
                <span>clip views</span>
              </span>
            </div>
          </section>
          <p className="profpage-note">
            This is your public card — it&apos;s what the room sees when they hover your name in chat.
            Earn Bubbles by chatting and voting during the show, on any platform.
          </p>

          {/* ---- chat identities (sign in/out) ---- */}
          <section className="clip-accounts">
            <div className="clip-acc-head">
              <span className="clip-acc-title">Chat identities</span>
              <span className="clip-acc-sub">the accounts you chat + earn Bubbles as</span>
            </div>
            <ul className="clip-acc-list">
              <li className={`clip-acc-item ${twitch ? "ok" : "pending"}`}>
                <span className="clip-badge plat-twitch">Twitch</span>
                {twitch ? (
                  <>
                    <span className="clip-acc-handle">@{twitch.login}</span>
                    <span className="clip-acc-status ok">connected ✓</span>
                    <button className="clip-acc-cancel" onClick={() => { clearAuth(); setTwitch(null); }}>sign out</button>
                  </>
                ) : (
                  <button className="clip-submit-btn ghost profpage-connect" onClick={() => startLogin("/profile")}>Sign in</button>
                )}
              </li>
              <li className={`clip-acc-item ${kick ? "ok" : "pending"}`}>
                <span className="clip-badge plat-kick">Kick</span>
                {kick ? (
                  <>
                    <span className="clip-acc-handle">{kick.username ? `@${kick.username}` : "signed in"}</span>
                    <span className="clip-acc-status ok">connected ✓</span>
                    <button className="clip-acc-cancel" onClick={() => kickSignOut()}>sign out</button>
                  </>
                ) : (
                  <button className="clip-submit-btn ghost profpage-connect" onClick={() => kickSignIn()}>Sign in</button>
                )}
              </li>
            </ul>
          </section>

          {/* ---- clip accounts + payout & socials (shared with /clips) ---- */}
          <ConnectAccounts identity={identity} hubHttpUrl={hubHttpUrl} />
          <ProfilePanel identity={identity} hubHttpUrl={hubHttpUrl} onSaved={loadMember} />
        </div>
      )}
    </TermShell>
  );
}
