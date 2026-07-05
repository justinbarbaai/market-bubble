"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useHub } from "../lib/useHub";
import type { Clipper, MemberCard } from "../lib/useHub";
import { getAuth, startLogin } from "../lib/twitchAuth";
import { useKickSession } from "../lib/kickAuth";
import { identityProof } from "./ProfileSections";
import { SourceLogo, SocialLogo, type SourceKey } from "./logos";

// Clip-to-Earn — viewers turn the show into reach. Submit a clip you posted,
// it gets reviewed, approval pays Bubbles by reach. The campaign ranks PEOPLE:
// the leaderboard is whoever pulls the most views, and clicking a clipper opens
// the member profile they already built (socials + payout live there — nothing
// to re-enter here).

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
        setMsg({ ok: true, text: "Clip submitted — once it's approved, its views count toward your spot below." });
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

  const clippers = clips?.clippers ?? [];

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
          <li><b>3.</b> Approved clips earn <b>Bubbles</b> by reach — pull the most views and you own the leaderboard.</li>
        </ol>
        <ul className="clip-reqs">
          <li>Tag <b>@MarketBubble</b> and use <b>#MarketBubble</b> in the caption</li>
          <li>Posted this week · genuine show content only</li>
          <li>No bot views or recycled clips — they get removed</li>
        </ul>
      </section>

      {/* ---- submit ---- */}
      <section className="clip-submit">
        {identity ? (
          <form onSubmit={submit}>
            <div className="clip-submit-as">
              submitting as <b>{identity.username}</b>
              <span className="clip-as-src">· {identity.source}</span>
              <Link className="clip-profile-link" href="/profile">
                clip accounts, socials &amp; payout live on your profile ↗
              </Link>
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

      {/* ---- the clippers leaderboard ---- */}
      <section className="clip-gallery-wrap">
        <div className="clip-gallery-head">
          <h2 className="clip-gallery-title">Top Clippers</h2>
          <span className="clip-gallery-meta">
            {clippers.length ? "ranked by total views · tap a name for their profile" : "be the first on the board"}
          </span>
        </div>
        {clippers.length === 0 ? (
          <p className="clip-empty">Nobody's on the board yet — submit a clip and claim Nº 1.</p>
        ) : (
          <ol className="clb-list">
            {clippers.map((c) => (
              <ClipperRow key={`${c.source}:${c.name}`} clipper={c} hubHttpUrl={hubHttpUrl} />
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

// One leaderboard row — tapping it opens the member profile they already built
// (same data as the chat card: Floor standing, socials, giveaway addresses).
function ClipperRow({ clipper: c, hubHttpUrl }: { clipper: Clipper; hubHttpUrl: string }) {
  const [open, setOpen] = useState(false);
  const [member, setMember] = useState<MemberCard | null | "loading">("loading");
  const [copied, setCopied] = useState("");

  useEffect(() => {
    if (!open || member !== "loading") return;
    fetch(`${hubHttpUrl}/member?source=${c.source}&username=${encodeURIComponent(c.name)}`)
      .then((r) => r.json())
      .then((j) => setMember(j?.member ?? null))
      .catch(() => setMember(null));
  }, [open, member, hubHttpUrl, c.source, c.name]);

  const avatar =
    c.source === "twitch"
      ? `https://unavatar.io/twitch/${encodeURIComponent(c.name)}`
      : c.source === "x"
      ? `https://unavatar.io/x/${encodeURIComponent(c.name)}`
      : null;

  const copy = (id: string, text: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(""), 1400);
    }).catch(() => {});
  };

  const m = member === "loading" ? null : member;

  return (
    <li className={`clb-row${c.rank <= 3 ? " top3" : ""}${open ? " open" : ""}`}>
      <button type="button" className="clb-main" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="clb-rank">{String(c.rank).padStart(2, "0")}</span>
        <span className="clb-av">
          {avatar && (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={avatar} src={avatar} alt="" loading="lazy" onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
          )}
          <b>{c.name.charAt(0).toUpperCase()}</b>
        </span>
        <span className="clb-who">
          <span className="clb-name">{c.name}</span>
          <span className="clb-sub">
            <SourceLogo source={c.source as SourceKey} size={10} /> {c.clips} clip{c.clips === 1 ? "" : "s"}
            {c.featured > 0 && <b> · ★ featured</b>}
          </span>
        </span>
        <span className="clb-views">
          <b>{fmt(c.views)}</b>
          <span>views</span>
        </span>
        <span className="clb-bubbles">{fmt(c.bubbles)} ◆</span>
      </button>

      {open && (
        <div className="clb-profile">
          {member === "loading" ? (
            <span className="clb-loading">loading profile…</span>
          ) : (
            <>
              {m?.points != null && (
                <span className="clb-floorline">
                  <b>Nº {m.rank}</b> on The Floor · <b>{fmt(m.points)} ◆</b>
                  {m.clips ? <> · {fmt(m.clips.views)} clip views all-time</> : null}
                </span>
              )}
              {(m?.socials || m?.wallets) ? (
                <span className="clb-chips">
                  {m.socials &&
                    Object.entries(m.socials).map(([net, v]) =>
                      v?.url ? (
                        <a key={net} className="roster-chip social" href={v.url} target="_blank" rel="noreferrer noopener" title={net}>
                          <SocialLogo net={net} size={11} />{v.handle ? ` ${v.handle}` : " site"}
                        </a>
                      ) : v?.handle ? (
                        <span key={net} className="roster-chip social" title={net}>
                          <SocialLogo net={net} size={11} /> {v.handle}
                        </span>
                      ) : null
                    )}
                  {m.wallets &&
                    Object.entries(m.wallets).map(([chain, addr]) => (
                      <button
                        key={chain}
                        type="button"
                        className="roster-chip wallet"
                        title={`Copy ${chain.toUpperCase()} address`}
                        onClick={() => copy(chain, addr as string)}
                      >
                        {chain.toUpperCase()} {copied === chain ? "copied ✓" : `${(addr as string).slice(0, 4)}…${(addr as string).slice(-4)} ⧉`}
                      </button>
                    ))}
                </span>
              ) : (
                <span className="clb-loading">no profile yet — just the clips talking</span>
              )}
            </>
          )}
        </div>
      )}
    </li>
  );
}
