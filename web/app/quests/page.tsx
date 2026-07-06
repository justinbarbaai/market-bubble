"use client";

import { useCallback, useEffect, useState } from "react";
import { TermShell } from "../components/TermShell";
import { useHub } from "../lib/useHub";
import { getAuth, startLogin } from "../lib/twitchAuth";
import { useKickSession } from "../lib/kickAuth";
import { identityProof } from "../components/ProfileSections";

// Quests — verifiable on-chain actions that pay Bubbles + AIRDROP WEIGHT.
// Link a wallet you PROVE you own (one signature from Phantom — never a
// transaction, never touches funds), do the quests (hold, use protocols, post),
// climb the airdrop roster. The show sends rewards from its own public wallet.

type Quest = {
  id: string; type: "hold" | "interact" | "manual";
  title: string; desc: string;
  mint: string | null; minAmount: number; days: number;
  programId: string | null; protocol: string; link: string | null;
  reward: number; weight: number; active: boolean;
};
type QuestProgress = { status: string; streakDays?: number; lastBalance?: number; doneAt?: number };
type QuestState = {
  wallet: { address: string; verified: boolean } | null;
  weight: number;
  progress: Record<string, QuestProgress>;
};

const fmt = (n: number) => n.toLocaleString("en-US");
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

export default function QuestsPage() {
  const { hubHttpUrl } = useHub();
  const { session: kick, signIn: kickSignIn } = useKickSession();

  const [identity, setIdentity] = useState<{ source: "twitch" | "kick"; username: string } | null>(null);
  useEffect(() => {
    const a = getAuth();
    if (a?.login) setIdentity({ source: "twitch", username: a.login });
    else if (kick?.username) setIdentity({ source: "kick", username: kick.username });
    else setIdentity(null);
  }, [kick]);

  const [quests, setQuests] = useState<Quest[]>([]);
  const [state, setState] = useState<QuestState | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    const qs = identity ? `?source=${identity.source}&username=${encodeURIComponent(identity.username)}` : "";
    fetch(`${hubHttpUrl}/quests${qs}`)
      .then((r) => r.json())
      .then((j) => { setQuests(j.quests ?? []); setState(j.state ?? null); })
      .catch(() => {});
  }, [hubHttpUrl, identity]);
  useEffect(() => { load(); }, [load]);

  // Phantom: connect + sign ONE message proving wallet ownership. A signature,
  // not a transaction — it can't move anything.
  async function linkWallet() {
    if (!identity || busy) return;
    setMsg(null);
    const provider = (window as unknown as { phantom?: { solana?: PhantomProvider }; solana?: PhantomProvider });
    const phantom = provider.phantom?.solana ?? provider.solana;
    if (!phantom?.signMessage) {
      setMsg({ ok: false, text: "No Solana wallet found — install Phantom (phantom.com) and retry on desktop." });
      return;
    }
    setBusy(true);
    try {
      const conn = await phantom.connect();
      const address = conn.publicKey.toString();
      const mbKey = `${identity.source}:${identity.username.toLowerCase()}`;
      const message = `Market Bubble quests — I own ${address} as ${mbKey} @ ${Date.now()}`;
      const signed = await phantom.signMessage(new TextEncoder().encode(message), "utf8");
      const sigB64 = btoa(String.fromCharCode(...signed.signature));
      const r = await fetch(`${hubHttpUrl}/quests/wallet`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: identity.source, username: identity.username, address, message, signature: sigB64, ...identityProof() }),
      });
      const j = await r.json();
      if (j.ok) { setMsg({ ok: true, text: `Wallet verified ✓ ${short(address)} — quests are live for you.` }); load(); }
      else setMsg({ ok: false, text: j.error || "Couldn't verify the wallet." });
    } catch {
      setMsg({ ok: false, text: "Wallet signing was cancelled or failed — try again." });
    } finally { setBusy(false); }
  }

  async function checkNow() {
    if (!identity || busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`${hubHttpUrl}/quests/check`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: identity.source, username: identity.username, ...identityProof() }),
      });
      const j = await r.json();
      if (j.ok) {
        setState(j.state ?? null);
        setMsg({ ok: true, text: j.awarded > 0 ? `Quest complete — +${fmt(j.awarded)} ◆ paid!` : "Checked ✓ — keep going." });
      } else setMsg({ ok: false, text: j.error || "Couldn't check." });
    } catch {
      setMsg({ ok: false, text: "Network error — try again." });
    } finally { setBusy(false); }
  }

  const wallet = state?.wallet;

  return (
    <TermShell>
      <section className="mb-section-head">
        <h1 className="mb-page-title">Quests</h1>
        <p className="mb-page-sub">do things on-chain &amp; on the show — earn Bubbles + airdrop weight</p>
      </section>

      <div className="clipboard">
        {/* how it works */}
        <section className="clip-rules">
          <div className="clip-rules-head">
            <span className="clip-rules-kicker">The deal</span>
            <h2 className="clip-rules-title">Prove it. Do it. Get weighted.</h2>
          </div>
          <ol className="clip-steps">
            <li><b>1.</b> Link the wallet you own — one signature, never a transaction.</li>
            <li><b>2.</b> Complete quests: hold, try protocols, clip the show, show up.</li>
            <li><b>3.</b> Each quest pays <b>Bubbles</b> now and adds <b>airdrop weight</b> for when the show sends rewards.</li>
          </ol>
          <ul className="clip-reqs">
            <li>Read-only — we never ask you to sign a transaction or approve spending</li>
            <li>One wallet per verified member · switching wallets resets your streaks</li>
            <li>Airdrops are sent by the show from its own public wallet — never from this site</li>
          </ul>
        </section>

        {/* wallet */}
        <section className="clip-submit">
          {!identity ? (
            <div className="clip-signin">
              <p>Sign in first — quests attach to your Market Bubble identity.</p>
              <div className="clip-signin-btns">
                <button className="clip-submit-btn" onClick={() => startLogin("/quests")}>Sign in with Twitch</button>
                <button className="clip-submit-btn ghost" onClick={() => kickSignIn()}>Connect Kick</button>
              </div>
            </div>
          ) : wallet?.verified ? (
            <div className="q-walletrow">
              <span className="q-walletlabel">
                wallet <b>{short(wallet.address)}</b> verified ✓ · airdrop weight <b className="q-weight">{fmt(state?.weight ?? 0)}</b>
              </span>
              <button className="clip-submit-btn" onClick={checkNow} disabled={busy}>{busy ? "Checking…" : "Check my quests"}</button>
            </div>
          ) : (
            <div className="q-walletrow">
              <span className="q-walletlabel">Link the wallet you own to start earning airdrop weight.</span>
              <button className="clip-submit-btn" onClick={linkWallet} disabled={busy}>
                {busy ? "Waiting for wallet…" : "Verify wallet (Phantom)"}
              </button>
            </div>
          )}
          {msg && <p className={`clip-msg ${msg.ok ? "ok" : "err"}`}>{msg.text}</p>}
        </section>

        {/* quest cards */}
        <section className="clip-gallery-wrap">
          <div className="clip-gallery-head">
            <h2 className="clip-gallery-title">Open quests</h2>
            <span className="clip-gallery-meta">{quests.length ? "each pays Bubbles + airdrop weight" : ""}</span>
          </div>
          {quests.length === 0 ? (
            <p className="clip-empty">No quests posted yet — they drop here.</p>
          ) : (
            <ol className="q-list">
              {quests.map((q) => {
                const p = state?.progress?.[q.id];
                const done = p?.status === "done";
                return (
                  <li key={q.id} className={`q-card${done ? " done" : ""}`}>
                    <div className="q-card-main">
                      <span className="q-type">{q.type === "hold" ? "HOLD" : q.type === "interact" ? "USE" : "IRL"}</span>
                      <span className="q-title">{q.title}</span>
                      <span className="q-reward">{fmt(q.reward)} ◆ <i>+{q.weight} weight</i></span>
                    </div>
                    {q.desc && <p className="q-desc">{q.desc}</p>}
                    {q.link && (
                      <a className="q-link" href={q.link} target="_blank" rel="noreferrer noopener">
                        open {q.protocol || "the app"} ↗
                      </a>
                    )}
                    <div className="q-progress">
                      {done ? (
                        <span className="q-done">complete ✓</span>
                      ) : q.type === "hold" ? (
                        <span>
                          streak <b>{p?.streakDays ?? 0}</b>/{q.days} days
                          {p?.lastBalance != null ? ` · balance ${fmt(Math.round(p.lastBalance * 100) / 100)}` : ""}
                        </span>
                      ) : q.type === "interact" ? (
                        <span>waiting for a {q.protocol || "protocol"} transaction from your wallet</span>
                      ) : (
                        <span>awarded by the show (IRL / quality posts)</span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        {/* bagwork — $ANSEM posts on X */}
        <Bagwork identity={identity} hubHttpUrl={hubHttpUrl} />
      </div>
    </TermShell>
  );
}

// Bagwork: submit your $ANSEM posts (author must be your VERIFIED X handle —
// verify it on your profile) → engagement tracked → Top Bagworkers → weight.
type BagPost = { id: string; url: string; handle: string; text: string; likes: number; replies: number };
type BagMine = { posts: BagPost[]; count: number; score: number } | null;
type BagRow = { rank: number; name: string; source: string; handle: string; posts: number; score: number };

function Bagwork({ identity, hubHttpUrl }: { identity: { source: "twitch" | "kick"; username: string } | null; hubHttpUrl: string }) {
  const [board, setBoard] = useState<BagRow[]>([]);
  const [mine, setMine] = useState<BagMine>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(() => {
    const qs = identity ? `?source=${identity.source}&username=${encodeURIComponent(identity.username)}` : "";
    fetch(`${hubHttpUrl}/bagwork${qs}`)
      .then((r) => r.json())
      .then((j) => { setBoard(j.leaderboard ?? []); setMine(j.mine ?? null); })
      .catch(() => {});
  }, [hubHttpUrl, identity]);
  useEffect(() => { load(); }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!identity || !url.trim() || busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`${hubHttpUrl}/bagwork/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: identity.source, username: identity.username, url: url.trim(), ...identityProof() }),
      });
      const j = await r.json();
      if (j.ok) { setMsg({ ok: true, text: "Post logged ✓ — engagement tracks automatically from here." }); setUrl(""); load(); }
      else setMsg({ ok: false, text: j.error || "Couldn't log that post." });
    } catch {
      setMsg({ ok: false, text: "Network error — try again." });
    } finally { setBusy(false); }
  }

  return (
    <section className="clip-gallery-wrap">
      <div className="clip-gallery-head">
        <h2 className="clip-gallery-title">Bagwork · $ANSEM posts</h2>
        <span className="clip-gallery-meta">post about $ANSEM on X, drop the link — engagement counts toward your airdrop weight</span>
      </div>

      {identity && (
        <form className="clip-submit-row" onSubmit={submit}>
          <input
            className="clip-input" type="url" inputMode="url"
            placeholder="Link to your $ANSEM post on X (must be from your verified handle)…"
            value={url} onChange={(e) => setUrl(e.target.value)} aria-label="X post URL"
          />
          <button className="clip-submit-btn" type="submit" disabled={busy || !url.trim()}>
            {busy ? "Reading…" : "Log post"}
          </button>
        </form>
      )}
      {msg && <p className={`clip-msg ${msg.ok ? "ok" : "err"}`}>{msg.text}</p>}
      {mine && (
        <p className="q-progress">
          your bagwork: <b>{mine.count}</b> post{mine.count === 1 ? "" : "s"} · <b>{fmt(mine.score)}</b> engagement
        </p>
      )}

      {board.length > 0 && (
        <ol className="clb-list" style={{ marginTop: 12 }}>
          {board.map((r) => (
            <li key={`${r.source}:${r.name}`} className={`clb-row${r.rank <= 3 ? " top3" : ""}`}>
              <div className="clb-main" style={{ cursor: "default" }}>
                <span className="clb-rank">{String(r.rank).padStart(2, "0")}</span>
                <span className="clb-who">
                  <span className="clb-name">{r.name}</span>
                  <span className="clb-sub">@{r.handle} · {r.posts} post{r.posts === 1 ? "" : "s"}</span>
                </span>
                <span className="clb-views"><b>{fmt(r.score)}</b><span>engagement</span></span>
              </div>
            </li>
          ))}
        </ol>
      )}
      {board.length === 0 && <p className="clip-empty">Nobody on the board yet — first verified $ANSEM post takes Nº 1.</p>}
    </section>
  );
}

type PhantomProvider = {
  connect: () => Promise<{ publicKey: { toString(): string } }>;
  signMessage: (msg: Uint8Array, enc: string) => Promise<{ signature: Uint8Array }>;
};
