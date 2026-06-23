"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { useHub } from "../lib/useHub";
import type { Clip, ClipPlatform } from "../lib/useHub";
import { getAuth, startLogin } from "../lib/twitchAuth";
import { useKickSession } from "../lib/kickAuth";

// Clip-to-Earn — viewers turn the show into reach. Submit a clip you posted
// (TikTok / YouTube / X / Reels, or a native Twitch/Kick clip), it gets reviewed,
// and approval pays Bubbles to your balance on The Floor. The best get featured.

const PLATFORM_LABEL: Record<ClipPlatform, string> = {
  tiktok: "TikTok",
  youtube: "YouTube",
  x: "X",
  instagram: "Reels",
  twitch: "Twitch",
  kick: "Kick",
};

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
        body: JSON.stringify({ url: url.trim(), source: identity.source, username: identity.username }),
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

// Connect + verify the outside accounts a clipper posts from — proves the same
// person owns them, so clips auto-attribute and nobody submits someone else's.
function ConnectAccounts({
  identity,
  hubHttpUrl,
}: {
  identity: { source: "twitch" | "kick"; username: string };
  hubHttpUrl: string;
}) {
  const [accounts, setAccounts] = useState<{ platform: string; handle: string; verified: boolean; manual?: boolean; code: string | null }[]>([]);
  const [platform, setPlatform] = useState<"tiktok" | "youtube" | "x" | "instagram">("tiktok");
  const [handle, setHandle] = useState("");
  const [pending, setPending] = useState<{ platform: string; handle: string; code: string } | null>(null);
  const [clipUrl, setClipUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // QR to hop the verify step to a phone (where the TikTok/IG app lives).
  const [qr, setQr] = useState("");
  useEffect(() => {
    if (!pending || typeof window === "undefined") { setQr(""); return; }
    QRCode.toDataURL(`${window.location.origin}/clips`, { margin: 1, width: 140, color: { dark: "#000000", light: "#ffffff" } })
      .then(setQr)
      .catch(() => setQr(""));
  }, [pending]);

  const idQS = `source=${identity.source}&username=${encodeURIComponent(identity.username)}`;
  async function refresh() {
    try {
      const r = await fetch(`${hubHttpUrl}/accounts?${idQS}`);
      const j = await r.json();
      setAccounts(j.accounts ?? []);
    } catch {}
  }
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [identity.source, identity.username]);

  async function getCode(e: React.FormEvent) {
    e.preventDefault();
    if (!handle.trim() || busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`${hubHttpUrl}/accounts/code`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: identity.source, username: identity.username, platform, handle: handle.trim() }),
      });
      const j = await r.json();
      const h = handle.trim().replace(/^@/, "");
      if (j.ok && j.manual) {
        // X / Instagram — registered; confirmed when the operator reviews a clip.
        setMsg({ ok: true, text: `@${h} added — we'll confirm it when you submit a clip.` });
        setHandle(""); refresh();
      } else if (j.ok) {
        setPending({ platform, handle: h, code: j.code }); refresh();
      } else setMsg({ ok: false, text: j.error || "Couldn't add that account." });
    } finally { setBusy(false); }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!pending || !clipUrl.trim() || busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`${hubHttpUrl}/accounts/verify`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: identity.source, username: identity.username, platform: pending.platform, handle: pending.handle, clipUrl: clipUrl.trim() }),
      });
      const j = await r.json();
      if (j.ok && j.verified) { setMsg({ ok: true, text: `@${pending.handle} verified ✓` }); setPending(null); setClipUrl(""); setHandle(""); refresh(); }
      else setMsg({ ok: false, text: j.error || "Couldn't verify." });
    } finally { setBusy(false); }
  }

  return (
    <section className="clip-accounts">
      <div className="clip-acc-head">
        <span className="clip-acc-title">Your clip accounts</span>
        <span className="clip-acc-sub">link the accounts you post from so your clips count for you</span>
      </div>

      {accounts.length > 0 && (
        <ul className="clip-acc-list">
          {accounts.map((a) => (
            <li key={`${a.platform}:${a.handle}`} className={`clip-acc-item ${a.verified ? "ok" : "pending"}`}>
              <span className={`clip-badge plat-${a.platform}`}>{PLATFORM_LABEL[a.platform as keyof typeof PLATFORM_LABEL] ?? a.platform}</span>
              <span className="clip-acc-handle">@{a.handle}</span>
              {a.verified ? (
                <span className="clip-acc-status ok">verified ✓</span>
              ) : a.manual ? (
                <span className="clip-acc-status pending">added · review on submit</span>
              ) : (
                <span className="clip-acc-status pending">pending · code <b>{a.code}</b></span>
              )}
            </li>
          ))}
        </ul>
      )}

      {!pending ? (
        <form className="clip-acc-connect" onSubmit={getCode}>
          <select className="clip-acc-select" value={platform} onChange={(e) => setPlatform(e.target.value as "tiktok" | "youtube" | "x" | "instagram")} aria-label="Platform">
            <option value="tiktok">TikTok</option>
            <option value="youtube">YouTube / Shorts</option>
            <option value="x">X</option>
            <option value="instagram">Instagram</option>
          </select>
          <input className="clip-input" placeholder="your @handle" value={handle} onChange={(e) => setHandle(e.target.value)} aria-label="Your handle" />
          <button className="clip-submit-btn ghost" type="submit" disabled={busy || !handle.trim()}>
            {platform === "x" || platform === "instagram" ? "Add" : "Get code"}
          </button>
        </form>
      ) : (
        <form className="clip-acc-verify" onSubmit={verify}>
          <div className="clip-acc-verify-top">
            {qr && (
              <div className="clip-acc-qr">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qr} alt="Scan to open Clip-to-Earn on your phone" width={92} height={92} />
                <span className="clip-acc-qr-cap">on your phone?</span>
              </div>
            )}
            <p className="clip-acc-instr">
              Put <b>{pending.code}</b> in the caption of any <b>{PLATFORM_LABEL[pending.platform as keyof typeof PLATFORM_LABEL]}</b> post from <b>@{pending.handle}</b>, then paste that link below. (Scan the code to finish on your phone, where your {PLATFORM_LABEL[pending.platform as keyof typeof PLATFORM_LABEL]} app is.)
            </p>
          </div>
          <div className="clip-submit-row">
            <input className="clip-input" type="url" placeholder="link to the post with your code…" value={clipUrl} onChange={(e) => setClipUrl(e.target.value)} aria-label="Verification clip URL" />
            <button className="clip-submit-btn" type="submit" disabled={busy || !clipUrl.trim()}>{busy ? "Checking…" : "Verify"}</button>
          </div>
          <button type="button" className="clip-acc-cancel" onClick={() => { setPending(null); setMsg(null); }}>cancel</button>
        </form>
      )}
      {msg && <p className={`clip-msg ${msg.ok ? "ok" : "err"}`}>{msg.text}</p>}
    </section>
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
