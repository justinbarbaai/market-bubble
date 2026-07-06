"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { getAuth } from "../lib/twitchAuth";
import { getKickSession } from "../lib/kickAuth";

// Shared member-profile sections — used on /profile (your account page) and
// /clips (the campaign page): link the outside accounts you clip from, and set
// your payout addresses + social links.

// Identity-claiming writes must carry PROOF (the hub verifies it): the viewer's
// own Twitch token or Kick session — otherwise anyone could claim your name and
// swap your giveaway address for theirs.
export function identityProof() {
  return {
    twitchToken: getAuth()?.token || undefined,
    kickSession: getKickSession()?.id || undefined,
  };
}

export const PLATFORM_LABEL: Record<string, string> = {
  tiktok: "TikTok",
  youtube: "YouTube",
  x: "X",
  instagram: "Reels",
  twitch: "Twitch",
  kick: "Kick",
};

export type Identity = { source: "twitch" | "kick"; username: string };

// Connect + verify the outside accounts a clipper posts from — proves the same
// person owns them, so clips auto-attribute and nobody submits someone else's.
export function ConnectAccounts({
  identity,
  hubHttpUrl,
}: {
  identity: Identity;
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
        body: JSON.stringify({ source: identity.source, username: identity.username, platform, handle: handle.trim(), ...identityProof() }),
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
        body: JSON.stringify({ source: identity.source, username: identity.username, platform: pending.platform, handle: pending.handle, clipUrl: clipUrl.trim(), ...identityProof() }),
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
              <span className={`clip-badge plat-${a.platform}`}>{PLATFORM_LABEL[a.platform] ?? a.platform}</span>
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
            {platform === "instagram" ? "Add" : "Get code"}
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
              Put <b>{pending.code}</b> in {pending.platform === "x" ? "the text of a post" : "the caption of any post"} from <b>@{pending.handle}</b> on <b>{PLATFORM_LABEL[pending.platform]}</b>, then paste that link below.{pending.platform === "x" ? "" : " (Scan the code to finish on your phone, where the app is.)"}
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

// Payout + socials — a member adds their crypto GIVEAWAY addresses (SOL/ETH/BTC)
// and social links so Banks & Ansem can pay winnings/bounties and shout them out.
// Public receive addresses only; no wallet-connect, nothing that moves funds.
const WALLETS = [
  { key: "sol", label: "Solana", ph: "your SOL address" },
  { key: "eth", label: "Ethereum", ph: "your ETH address (0x…)" },
  { key: "btc", label: "Bitcoin", ph: "your BTC address" },
] as const;
const SOCIALS = [
  { key: "x", label: "X", ph: "@handle" },
  { key: "tiktok", label: "TikTok", ph: "@handle" },
  { key: "instagram", label: "Instagram", ph: "@handle" },
  { key: "discord", label: "Discord", ph: "username" },
  { key: "website", label: "Website", ph: "yoursite.com" },
] as const;
type WalletKey = (typeof WALLETS)[number]["key"];
type SocialKey = (typeof SOCIALS)[number]["key"];

export function ProfilePanel({
  identity,
  hubHttpUrl,
  onSaved,
}: {
  identity: Identity;
  hubHttpUrl: string;
  /** called after a successful save — lets the page refresh the public card */
  onSaved?: () => void;
}) {
  const [wallets, setWallets] = useState<Record<WalletKey, string>>({ sol: "", eth: "", btc: "" });
  const [socials, setSocials] = useState<Record<SocialKey, string>>({ x: "", tiktok: "", instagram: "", discord: "", website: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Prefill from the saved profile.
  useEffect(() => {
    let live = true;
    fetch(`${hubHttpUrl}/profile?source=${identity.source}&username=${encodeURIComponent(identity.username)}`)
      .then((r) => r.json())
      .then((j) => {
        if (!live || !j?.profile) return;
        const p = j.profile;
        setWallets({ sol: p.wallets?.sol ?? "", eth: p.wallets?.eth ?? "", btc: p.wallets?.btc ?? "" });
        setSocials({
          x: p.socials?.x?.handle ?? "",
          tiktok: p.socials?.tiktok?.handle ?? "",
          instagram: p.socials?.instagram?.handle ?? "",
          discord: p.socials?.discord?.handle ?? "",
          website: p.socials?.website?.url ?? "",
        });
      })
      .catch(() => {});
    return () => { live = false; };
  }, [hubHttpUrl, identity.source, identity.username]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`${hubHttpUrl}/profile`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: identity.source, username: identity.username, wallets, socials, ...identityProof() }),
      });
      const j = await r.json();
      if (j.ok && (!j.invalid || j.invalid.length === 0)) {
        setMsg({ ok: true, text: "Saved ✓ — the show can pay you + tag you now." });
        onSaved?.();
      } else if (j.ok) {
        setMsg({ ok: false, text: `Saved, but check these — they didn't look right: ${j.invalid.join(", ")}` });
        onSaved?.();
      } else setMsg({ ok: false, text: j.error || "Couldn't save." });
    } catch {
      setMsg({ ok: false, text: "Network error — try again." });
    } finally { setBusy(false); }
  }

  return (
    <section className="clip-prof">
      <div className="clip-acc-head">
        <span className="clip-acc-title">Payout &amp; socials</span>
        <span className="clip-acc-sub">where to send giveaway winnings + how the show can find you</span>
      </div>

      <form onSubmit={save}>
        <div className="prof-group">
          <span className="prof-group-label">Crypto for giveaways &amp; bounties</span>
          <div className="prof-grid">
            {WALLETS.map((w) => (
              <label key={w.key} className="prof-field">
                <span className="prof-field-label">{w.label}</span>
                <input
                  className="clip-input"
                  value={wallets[w.key]}
                  onChange={(e) => setWallets((s) => ({ ...s, [w.key]: e.target.value }))}
                  placeholder={w.ph}
                  aria-label={`${w.label} address`}
                  spellCheck={false}
                  autoComplete="off"
                />
              </label>
            ))}
          </div>
          <p className="prof-note">Shown on your public profile card so the show can send giveaways. Receive addresses only — we never ask you to connect a wallet or sign anything.</p>
        </div>

        <div className="prof-group">
          <span className="prof-group-label">Socials</span>
          <div className="prof-grid">
            {SOCIALS.map((s) => (
              <label key={s.key} className="prof-field">
                <span className="prof-field-label">{s.label}</span>
                <input
                  className="clip-input"
                  value={socials[s.key]}
                  onChange={(e) => setSocials((v) => ({ ...v, [s.key]: e.target.value }))}
                  placeholder={s.ph}
                  aria-label={s.label}
                  spellCheck={false}
                  autoComplete="off"
                />
              </label>
            ))}
          </div>
        </div>

        <div className="prof-actions">
          <button className="clip-submit-btn" type="submit" disabled={busy}>{busy ? "Saving…" : "Save profile"}</button>
          {msg && <span className={`clip-msg ${msg.ok ? "ok" : "err"}`}>{msg.text}</span>}
        </div>
        <p className="prof-note">
          Signed into both Twitch <b>and</b> Kick? Saving links them — one profile, shown on your card in both chats.
        </p>
      </form>
    </section>
  );
}
