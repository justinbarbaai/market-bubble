"use client";

import { useEffect, useState } from "react";
import { useHub } from "../lib/useHub";
import type { Clip } from "../lib/useHub";
import { getAuth, startLogin } from "../lib/twitchAuth";
import { useKickSession } from "../lib/kickAuth";
import { ConnectAccounts, ProfilePanel, PLATFORM_LABEL, identityProof } from "./ProfileSections";

// Clip-to-Earn — viewers turn the show into reach. Submit a clip you posted
// (TikTok / YouTube / X / Reels, or a native Twitch/Kick clip), it gets reviewed,
// and approval pays Bubbles to your balance on The Floor. The best get featured.

const fmt = (n: number) => n.toLocaleString("en-US");

export function ClipBoard() {
  const { clips, hubHttpUrl } = useHub();
  const { session: kickSession, signIn: kickSignIn } = useKickSession();

  // Resolve the signed-in identity (Twitch first, then Kick).
  const [identity, setIdentity] = useState<{ source: "twitch" | "kick"; username: string } | null>(null);
  useEffect(() => {
    const a = getAuth();
    if (a?.login) setIdentity({ source: "twitch", username: a.login });
    else if (kickSession?.username) setIdentity({ source: "kick", username: kickSession.username });
    else setIdentity(null);
  }, [kickSession]);

  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!identity || !url.trim() || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`${hubHttpUrl}/clips/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: url.trim(), source: identity.source, username: identity.username, ...identityProof() }),
      });
      const j = await r.json();
      if (j.ok) {
        setMsg({ ok: true, text: "Clip submitted — it'll show here once it's approved." });
        setUrl("");
      } else {
        setMsg({ ok: false, text: j.error || "Couldn't submit that clip." });
      }
    } catch {
      setMsg({ ok: false, text: "Network error — try again." });
    } finally {
      setBusy(false);
    }
  }

  const gallery = clips?.clips ?? [];

  return (
    <div className="clipboard">
      {/* ---- how it works + campaign rules ---- */}
      <section className="clip-rules">
        <div className="clip-rules-head">
          <span className="clip-rules-kicker">The campaign</span>
          <h2 className="clip-rules-title">Clip the show. Earn Bubbles.</h2>
        </div>
        <ol className="clip-steps">
          <li><b>1.</b> Clip a moment from the live show and post it anywhere.</li>
          <li><b>2.</b> Drop the link below — it gets reviewed, not auto-posted.</li>
          <li><b>3.</b> Approved clips earn <b>Bubbles</b> by reach. The best get <b>featured on the show.</b></li>
        </ol>
        <ul className="clip-reqs">
          <li>Tag <b>@MarketBubble</b> and use <b>#MarketBubble</b> in the caption</li>
          <li>Posted this week · genuine show content only</li>
          <li>No bot views or recycled clips — they get removed</li>
        </ul>
      </section>

      {/* ---- connect your clip accounts (identity) ---- */}
      {identity && <ConnectAccounts identity={identity} hubHttpUrl={hubHttpUrl} />}

      {/* ---- payout + socials (crypto giveaways / shout-outs) ---- */}
      {identity && <ProfilePanel identity={identity} hubHttpUrl={hubHttpUrl} />}

      {/* ---- submit ---- */}
      <section className="clip-submit">
        {identity ? (
          <form onSubmit={submit}>
            <div className="clip-submit-as">
              submitting as <b>{identity.username}</b>
              <span className="clip-as-src">· {identity.source}</span>
            </div>
            <div className="clip-submit-row">
              <input
                className="clip-input"
                type="url"
                inputMode="url"
                placeholder="Paste your clip link (TikTok, YouTube, X, Reels, Twitch, Kick)…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                aria-label="Clip URL"
              />
              <button className="clip-submit-btn" type="submit" disabled={busy || !url.trim()}>
                {busy ? "Submitting…" : "Submit clip"}
              </button>
            </div>
            {msg && <p className={`clip-msg ${msg.ok ? "ok" : "err"}`}>{msg.text}</p>}
          </form>
        ) : (
          <div className="clip-signin">
            <p>Sign in to submit a clip and earn Bubbles.</p>
            <div className="clip-signin-btns">
              <button className="clip-submit-btn" onClick={() => startLogin("/clips")}>
                Sign in with Twitch
              </button>
              <button className="clip-submit-btn ghost" onClick={() => kickSignIn()}>
                Connect Kick
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ---- gallery ---- */}
      <section className="clip-gallery-wrap">
        <div className="clip-gallery-head">
          <h2 className="clip-gallery-title">Top 10 · The Wall</h2>
          <span className="clip-gallery-meta">
            {gallery.length ? "ranked by views · most reach wins" : "be the first"}
          </span>
        </div>
        {gallery.length === 0 ? (
          <p className="clip-empty">No clips up yet — submit one and it lands here once approved.</p>
        ) : (
          <ul className="clip-grid">
            {gallery.map((c, i) => (
              <ClipCard key={c.id} clip={c} rank={i + 1} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ClipCard({ clip, rank }: { clip: Clip; rank: number }) {
  return (
    <li className={`clip-card${clip.featured ? " featured" : ""}${rank <= 3 ? " top3" : ""}`}>
      <a className="clip-card-link" href={clip.url} target="_blank" rel="noreferrer">
        <div className="clip-card-top">
          <span className="clip-rank-no">#{rank}</span>
          <span className={`clip-badge plat-${clip.platform}`}>{PLATFORM_LABEL[clip.platform]}</span>
          {clip.featured && <span className="clip-feat">★ Featured</span>}
        </div>
        <div className="clip-card-body">
          <span className="clip-card-by">@{clip.by}</span>
          <div className="clip-card-stats">
            {clip.views > 0 && <span className="clip-card-views">{fmt(clip.views)} views</span>}
            <span className="clip-card-bubbles">{fmt(clip.bubbles)} ◆</span>
          </div>
        </div>
        <span className="clip-card-go">watch ↗</span>
      </a>
    </li>
  );
}
