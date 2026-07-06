"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ChatFeed } from "../components/ChatFeed";
import { useHub, type Poll } from "../lib/useHub";
import { SITE_DEFAULT_LOOK, type OverlayOptions } from "../lib/overlay";
import { SourceLogo, SocialLogo, SOURCE_LABELS, type SourceKey } from "../components/logos";
import { MBLockup } from "../components/brand";
import { StudioGate } from "../components/StudioGate";
import { ThemeToggle } from "../components/ThemeToggle";
import {
  getAuth,
  getClientId,
  setClientId,
  startLogin,
  handleRedirect,
  clearAuth,
  type TwitchAuth,
} from "../lib/twitchAuth";

const SOURCES: SourceKey[] = ["twitch", "kick"];

const clean = (s: string) => s.replace(/^@/, "").trim();

export default function StudioPage() {
  return (
    <StudioGate>
      <ControlPanel />
    </StudioGate>
  );
}

function ControlPanel() {
  const {
    messages,
    statuses,
    hubConnected,
    kickEnabled,
    kickConnected,
    serverChannels,
    applyChannels,
    disconnectKickAccount,
    hubUrl,
    hubHttpUrl,
    poll,
  } = useHub();

  // The show = Banks on Twitch + Ansem on Kick. Connecting either merges its
  // chat into the one feed everyone sees. X chat arrives through the bridge
  // (the switch below), so X needs no setup here.
  // Each host can have BOTH a Twitch and a Kick channel — whatever's filled in
  // merges into the one feed. (X has nothing to do with this — it comes through
  // the capture rig on the X Capture tab.)
  const [banksTwitch, setBanksTwitch] = useState("fazebanks");
  const [banksKick, setBanksKick] = useState("");
  const [ansemTwitch, setAnsemTwitch] = useState("");
  const [ansemKick, setAnsemKick] = useState("ansem");

  const [twitch, setTwitch] = useState<string[]>([]);
  const [kick, setKick] = useState<string[]>([]);
  const [seeded, setSeeded] = useState(false);
  // Merge feedback — confirmed once the hub echoes the new config back.
  const [mergeNote, setMergeNote] = useState("");
  const [merging, setMerging] = useState(false);
  const appliedRef = useRef("");

  // Guest streamers — connect a Twitch or Kick channel (not X) and their chat
  // merges into the show feed too.
  type Guest = { id: number; platform: "twitch" | "kick"; channel: string };
  const [guests, setGuests] = useState<Guest[]>([]);
  const guestId = useRef(0);
  const addGuest = () =>
    setGuests((g) => [...g, { id: ++guestId.current, platform: "twitch", channel: "" }]);
  const updateGuest = (id: number, patch: Partial<Guest>) =>
    setGuests((g) => g.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const removeGuest = (id: number) => setGuests((g) => g.filter((x) => x.id !== id));

  // ---- Twitch OAuth (client-side implicit; one connection for the show) ----
  const [twAuth, setTwAuth] = useState<TwitchAuth | null>(null);
  const [twClientId, setTwClientId] = useState("");
  const [twSetup, setTwSetup] = useState(false);
  const [twKey, setTwKey] = useState("");

  useEffect(() => {
    setTwClientId(getClientId());
    handleRedirect().then((a) => setTwAuth(a || getAuth()));
  }, []);

  const saveTwKey = () => {
    const id = twKey.trim();
    if (!id) return;
    setClientId(id);
    setTwClientId(id);
    setTwSetup(false);
  };

  // Seed inputs from whatever the hub currently follows.
  useEffect(() => {
    if (serverChannels && !seeded) {
      setTwitch(serverChannels.twitch);
      setKick(serverChannels.kick);
      if (serverChannels.twitch[0]) setBanksTwitch(serverChannels.twitch[0]);
      if (serverChannels.kick[0]) setAnsemKick(serverChannels.kick[0]);
      setSeeded(true);
    }
  }, [serverChannels, seeded]);

  const cleanTwitch = useMemo(() => twitch.map(clean).filter(Boolean), [twitch]);
  const cleanKick = useMemo(() => kick.map(clean).filter(Boolean), [kick]);

  const previewOptions: OverlayOptions = useMemo(
    () => ({ ...SITE_DEFAULT_LOOK, twitch: cleanTwitch, kick: cleanKick, xQuery: "" }),
    [cleanTwitch, cleanKick]
  );

  // Merge everything that's set/connected — hosts + guests — into one feed.
  // X chat is handled separately by the bridge, not the channel config.
  const applyHosts = () => {
    const guestTw = guests.filter((g) => g.platform === "twitch").map((g) => clean(g.channel));
    const guestKk = guests.filter((g) => g.platform === "kick").map((g) => clean(g.channel));
    const tw = [...new Set([clean(banksTwitch), clean(ansemTwitch), ...guestTw].filter(Boolean))];
    const kk = [...new Set([clean(banksKick), clean(ansemKick), ...guestKk].filter(Boolean))];
    if (!tw.length && !kk.length) {
      setMerging(false);
      setMergeNote("Add at least one Twitch or Kick channel first.");
      return;
    }
    setTwitch(tw);
    setKick(kk);
    appliedRef.current = JSON.stringify([tw, kk]);
    setMerging(true);
    setMergeNote("Merging… pushing channels to the live room.");
    // Twitch + Kick only — X chat is the capture rig's job, never the channel config.
    applyChannels({ twitch: tw, kick: kk, xQuery: "" });
  };

  // Confirm the merge actually landed: the hub echoes its live config back as
  // serverChannels. When that matches what we pushed, the live room is following it
  // — so the operator gets real confirmation instead of a silent button.
  useEffect(() => {
    if (!appliedRef.current || !serverChannels) return;
    if (JSON.stringify([serverChannels.twitch, serverChannels.kick]) !== appliedRef.current) return;
    const tw = serverChannels.twitch, kk = serverChannels.kick;
    const all = [...tw, ...kk];
    setMerging(false);
    setMergeNote(all.length ? `✓ Live room is now following: ${all.join(", ")}` : "✓ Cleared — no channels.");
    appliedRef.current = "";
  }, [serverChannels]);

  // ---- connect controls (rendered inside the platform blocks) ----
  const twitchConnect: ReactNode = twAuth ? (
    <div className="acct-conn on">
      <span className="acct-as">● @{twAuth.login}</span>
      <button className="acct-btn ghost" onClick={() => { clearAuth(); setTwAuth(null); }}>Disconnect</button>
    </div>
  ) : twClientId ? (
    <button className="acct-btn connect" data-platform="twitch" onClick={() => startLogin("/studio")}>
      Connect Twitch
    </button>
  ) : twSetup ? (
    <div className="acct-key">
      <input value={twKey} onChange={(e) => setTwKey(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveTwKey()} placeholder="Twitch Client ID" spellCheck={false} />
      <button className="acct-btn solid" onClick={saveTwKey}>Save</button>
    </div>
  ) : (
    <button className="acct-btn ghost" onClick={() => setTwSetup(true)}>Set up (add Client ID)</button>
  );

  const kickConnect: ReactNode = kickConnected ? (
    <div className="acct-conn on">
      <span className="acct-as">● Account linked</span>
      <button className="acct-btn ghost" onClick={disconnectKickAccount}>Disconnect</button>
    </div>
  ) : kickEnabled ? (
    <a className="acct-btn connect" data-platform="kick" href={`${hubHttpUrl}/auth/kick/login`}>Connect Kick</a>
  ) : (
    <p className="acct-note">
      Add <code>KICK_CLIENT_ID</code> / <code>KICK_CLIENT_SECRET</code> to the hub to enable.
    </p>
  );

  const [tab, setTab] = useState<"show" | "bridge" | "engage" | "growth">("show");
  const TABS = [
    {
      id: "show",
      label: "Show",
      eyebrow: "Operator console",
      title: "Connect the show.",
      sub: "Link Banks & Ansem's accounts — every account you connect merges into the one chat everyone sees. The chat look is each viewer's own, set from the live room.",
    },
    {
      id: "bridge",
      label: "X Capture",
      eyebrow: "X capture",
      title: "Bring in the X chat.",
      sub: "X live chat + view counts come from the Chrome extension (the clean, primary feed); OCR is the automatic backup if the extension drops. This panel drives the capture rig on the show machine — start/stop, point it at a broadcast, Auto-follow, and watch its heartbeat.",
    },
    {
      id: "engage",
      label: "Engage",
      eyebrow: "Audience",
      title: "Play the room.",
      sub: "Run the live Polymarket prediction poll and review Clip-to-Earn submissions — approve, tier, and feature clips. Both pay Bubbles on The Floor.",
    },
    {
      id: "growth",
      label: "Growth",
      eyebrow: "Distribution",
      title: "Track the reach.",
      sub: "One ledger across paid clippers and placements — views-per-dollar, bot-cheap flags, and the weekly report you take to the founders.",
    },
  ] as const;
  const active = TABS.find((t) => t.id === tab) ?? TABS[0];

  return (
    <div className="console">
      <header className="topbar">
        <Link href="/" className="studio-brand" aria-label="Market Bubble">
          <MBLockup className="studio-lockup" />
          <span className="studio-tag">Studio</span>
        </Link>
        <div className="topbar-right">
          <ThemeToggle className="term-icon" />
          <a className="btn btn-ghost btn-watch" href="/overlay-studio">OBS overlay</a>
          <a className="btn btn-ghost btn-watch" href="/">View site</a>
          <div className="livestat">
            <span className={`dot ${hubConnected ? "on" : "off"}`} />
            <span>{hubConnected ? "live" : "offline"}</span>
          </div>
        </div>
      </header>

      <section className="studio-head">
        <span className="studio-eyebrow">{active.eyebrow}</span>
        <h1 className="studio-h1">{active.title}</h1>
        <p className="studio-sub">{active.sub}</p>
      </section>

      {/* tabs — keep the console organized like the site nav */}
      <div className="studio-tabs" role="tablist" aria-label="Studio sections">
        {TABS.map((tb) => (
          <button
            key={tb.id}
            role="tab"
            aria-selected={tab === tb.id}
            className={`studio-tab ${tab === tb.id ? "on" : ""}`}
            onClick={() => setTab(tb.id)}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {/* ENGAGE: prediction poll + Clip-to-Earn queue */}
      {tab === "engage" && (
        <>
          <PollControl hubHttpUrl={hubHttpUrl} poll={poll} />
          <ClipQueue hubHttpUrl={hubHttpUrl} />
          <QuestsControl hubHttpUrl={hubHttpUrl} />
          <Roster hubHttpUrl={hubHttpUrl} />
        </>
      )}

      {/* X CAPTURE: hub + bridge health, then the capture-rig remote control */}
      {tab === "bridge" && (
        <>
          <HealthStrip hubHttpUrl={hubHttpUrl} />
          <BridgeControl hubHttpUrl={hubHttpUrl} />
        </>
      )}

      {/* GROWTH: distribution cockpit — ROI + bot flags + weekly report */}
      {tab === "growth" && <CockpitControl hubHttpUrl={hubHttpUrl} />}

      {/* SHOW: source status → host accounts (Twitch + Kick) → merge → preview */}
      {tab === "show" && (
      <>
      {/* live Twitch + Kick source status (X lives on the X Capture tab) */}
      <div className="statusrow">
        {SOURCES.map((src) => {
          const on = statuses[src].connected;
          return (
            <div className={`statuscard ${on ? "live" : "down"}`} key={src} data-source={src}>
              <span className="sc-logo" style={{ color: srcColor(src) }}>
                <SourceLogo source={src} size={18} />
              </span>
              <div className="sc-meta">
                <div className="sc-name">{SOURCE_LABELS[src]}</div>
                <div className="sc-target">{statuses[src].channel || "—"}</div>
              </div>
              <span className={`dot ${on ? "on" : "off"}`} />
            </div>
          );
        })}
      </div>

      {/* host account cards — each host can add their OWN Twitch and/or Kick */}
      <div className="host-grid">
        <HostAccountCard name="Banks" role="Host" avatarHandle="Banks">
          <PlatformBlock
            source="twitch" value={banksTwitch} onChange={setBanksTwitch} placeholder="fazebanks"
            on={!!clean(banksTwitch)} stateLabel={twAuth ? "Connected" : clean(banksTwitch) ? "Reading" : "Add channel"} connect={twitchConnect}
          />
          <PlatformBlock
            source="kick" value={banksKick} onChange={setBanksKick} placeholder="banks kick (optional)"
            on={!!clean(banksKick)} stateLabel={clean(banksKick) ? "Reading" : "Optional"}
          />
        </HostAccountCard>

        <HostAccountCard name="Ansem" role="Co-host" avatarHandle="blknoiz06">
          <PlatformBlock
            source="twitch" value={ansemTwitch} onChange={setAnsemTwitch} placeholder="ansem twitch (optional)"
            on={!!clean(ansemTwitch)} stateLabel={clean(ansemTwitch) ? "Reading" : "Optional"}
          />
          <PlatformBlock
            source="kick" value={ansemKick} onChange={setAnsemKick} placeholder="ansem"
            on={!!clean(ansemKick)} stateLabel={kickConnected ? "Connected" : clean(ansemKick) ? "Reading" : "Add channel"} connect={kickConnect}
          />
        </HostAccountCard>

        {guests.map((g) => (
          <GuestCard
            key={g.id}
            guest={g}
            onChange={(p) => updateGuest(g.id, p)}
            onRemove={() => removeGuest(g.id)}
          />
        ))}

        <button className="acct-add" onClick={addGuest}>
          <span className="acct-add-plus">+</span>
          <span className="acct-add-label">Add guest</span>
          <span className="acct-add-sub">Twitch or Kick — merges their chat in</span>
        </button>
      </div>

      <div className="host-apply">
        <button className="btn btn-gold" onClick={applyHosts} disabled={merging}>
          {merging ? "Merging…" : "Apply & merge chat"}
        </button>
        <span className="muted small">
          Reads every Twitch + Kick channel above into the one chat the live room shows. X chat comes
          through the X Capture tab — separate from this.
        </span>
        {mergeNote && <span className={`merge-note ${mergeNote.startsWith("✓") ? "ok" : ""}`}>{mergeNote}</span>}
      </div>

      {/* live chat preview */}
      <section className="card preview-card">
        <div className="preview-head">
          <h2 className="card-title">Live chat preview</h2>
          <span className="muted small">{messages.length} msgs</span>
        </div>
        <div className={`preview-stage bg-${SITE_DEFAULT_LOOK.bg}`}>
          <ChatFeed
            messages={messages}
            options={previewOptions}
            placeholder={<span>Waiting for chat… connect the hosts and hit <b>Apply &amp; merge chat</b>.</span>}
          />
        </div>
        <p className="muted small">Server: <code>{hubUrl}</code> must be running to receive chat.</p>
      </section>
      </>
      )}
    </div>
  );
}

function GuestCard({
  guest,
  onChange,
  onRemove,
}: {
  guest: { id: number; platform: "twitch" | "kick"; channel: string };
  onChange: (patch: Partial<{ platform: "twitch" | "kick"; channel: string }>) => void;
  onRemove: () => void;
}) {
  return (
    <section className="host-card acct-card guest-card">
      <div className="host-top">
        <div className="host-id">
          <span className="host-name">Guest</span>
          <span className="host-role">Stream + chat</span>
        </div>
        <button className="acct-remove" onClick={onRemove} aria-label="Remove guest">✕</button>
      </div>
      <div className="acct-blocks">
        <div className="acct-block" data-platform={guest.platform}>
          <div className="acct-head">
            <span className="acct-plat">Platform</span>
            <div className="acct-seg">
              <button className={guest.platform === "twitch" ? "on" : ""} onClick={() => onChange({ platform: "twitch" })}>
                <SourceLogo source="twitch" size={12} /> Twitch
              </button>
              <button className={guest.platform === "kick" ? "on" : ""} onClick={() => onChange({ platform: "kick" })}>
                <SourceLogo source="kick" size={12} /> Kick
              </button>
            </div>
          </div>
          <input
            className="acct-input"
            value={guest.channel}
            onChange={(e) => onChange({ channel: e.target.value })}
            placeholder={guest.platform === "twitch" ? "their_twitch" : "their_kick"}
            spellCheck={false}
          />
          <p className="acct-note">
            Their {guest.platform === "twitch" ? "Twitch" : "Kick"} chat merges into the show on Apply.
          </p>
        </div>
      </div>
    </section>
  );
}

function HostAccountCard({
  name,
  role,
  avatarHandle,
  children,
}: {
  name: string;
  role: string;
  avatarHandle: string;
  children: ReactNode;
}) {
  return (
    <section className="host-card acct-card">
      <div className="host-top">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="host-av" src={`https://unavatar.io/twitter/${clean(avatarHandle)}`} alt={name} />
        <div className="host-id">
          <span className="host-name">{name}</span>
          <span className="host-role">{role}</span>
        </div>
      </div>
      <div className="acct-blocks">{children}</div>
    </section>
  );
}

function PlatformBlock({
  source,
  value,
  onChange,
  placeholder,
  on,
  stateLabel,
  connect,
}: {
  source: SourceKey;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  on: boolean;
  stateLabel: string;
  connect?: ReactNode;
}) {
  return (
    <div className="acct-block" data-platform={source}>
      <div className="acct-head">
        <span className="acct-logo" style={{ color: source === "x" ? "var(--text)" : srcColor(source) }}>
          <SourceLogo source={source} size={15} />
        </span>
        <span className="acct-plat">{SOURCE_LABELS[source]}</span>
        <span className={`acct-state ${on ? "on" : ""}`}>{stateLabel}</span>
      </div>
      <input
        className="acct-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
      />
      {connect && <div className="acct-connect">{connect}</div>}
    </div>
  );
}

function srcColor(src: SourceKey): string {
  return src === "twitch" ? "#9146FF" : src === "kick" ? "#53FC18" : "#FFFFFF";
}

// ---- Remote bridge control: the switch + paste-link that drives the X
// capture agent on the show machine, straight from the site. Talks to the hub
// relay (/op/state, /op/command), gated by the operator key already in hand.
type StreamRow = { last_msg: number; watching: number; ok: boolean; frozen: number | null };
type AgentStatus = {
  running: boolean;
  helper: boolean;
  auto: boolean;
  now: number;
  bridge: {
    streams: Record<string, StreamRow>;
    mbcap: boolean;
    pushed: number;
    push_err: string | null;
    fresh: boolean;
  } | null;
} | null;
type OpState = { ok: boolean; online: boolean; agoSec: number | null; status: AgentStatus; queued: number };

function BridgeControl({ hubHttpUrl }: { hubHttpUrl: string }) {
  const [opKey, setOpKey] = useState("");
  const [state, setState] = useState<OpState | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    try { setOpKey(localStorage.getItem("mb.operatorKey") || ""); } catch {}
  }, []);

  useEffect(() => {
    if (!opKey) return;
    let stop = false;
    const poll = async () => {
      try {
        const r = await fetch(`${hubHttpUrl}/op/state?key=${encodeURIComponent(opKey)}`, { cache: "no-store" });
        const j = await r.json();
        if (!stop) setState(j);
      } catch { /* keep last state; hub blip */ }
    };
    poll();
    const t = setInterval(poll, 2000);
    return () => { stop = true; clearInterval(t); };
  }, [hubHttpUrl, opKey]);

  const cmd = async (action: string, extra?: Record<string, unknown>) => {
    setBusy(true); setNote("");
    try {
      const r = await fetch(`${hubHttpUrl}/op/command`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: opKey, action, ...extra }),
      });
      const j = await r.json();
      if (!j.ok) setNote(j.error || "failed");
    } catch { setNote("Can't reach the hub."); }
    setBusy(false);
  };

  // Pull the bridge agent bundle (operator-gated). Stream it with the key in a
  // header — never in the URL — and save via a blob so it downloads cleanly.
  const [dl, setDl] = useState("");
  const downloadBridge = async () => {
    setDl("Preparing…");
    try {
      const r = await fetch(`${hubHttpUrl}/op/bridge.zip`, { headers: { "x-op-key": opKey } });
      if (!r.ok) { setDl("Download failed — re-enter the operator key."); return; }
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "market-bubble-bridge.zip";
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(a.href);
      setDl("Downloaded ✓");
    } catch { setDl("Can’t reach the hub."); }
  };

  const online = !!state?.online;
  const status = state?.status;
  const running = !!status?.running;
  const bridge = status?.bridge ?? null;
  const fresh = !!bridge?.fresh;
  const now = status?.now ?? 0;
  const streams = online && running && bridge?.streams ? bridge.streams : {};
  const names = Object.keys(streams).sort();

  const fmtAge = (s: number) => (s < 90 ? `${Math.round(s)}s` : `${Math.round(s / 60)}m`);
  const auto = !!status?.auto;
  const sub = !online
    ? "the capture app isn’t running on the show machine"
    : auto
    ? running
      ? "Auto — the show is live, capturing"
      : "Auto — waiting for the show to go live"
    : running
    ? fresh
      ? bridge?.mbcap
        ? "on — capturing via MBCapture (fullscreen anywhere is fine)"
        : "on — legacy capture: helper down, windows must stay on the show desktop"
      : "on — starting up…"
    : "off — nothing is being read or pushed";

  const toggle = () => { if (online && !busy && !auto) cmd(running ? "stop" : "start"); };
  const toggleAuto = () => { if (online && !busy) cmd(auto ? "auto_off" : "auto_on"); };
  const openProfiles = () => { if (online && !busy) cmd("open_profiles"); };
  const openUrl = () => {
    const u = url.trim();
    if (!u || !online) return;
    cmd("open", { url: u });
    setUrl("");
  };

  return (
    <section className="card bridgectl">
      <div className="bc-power">
        <div>
          <h2 className="card-title" style={{ margin: 0 }}>X chat bridge</h2>
          <span className="muted small">{sub}</span>
        </div>
        <div className="bc-switches">
          <button
            className={`bc-auto-pill ${auto ? "on" : ""} ${!online || busy ? "off-disabled" : ""}`}
            onClick={toggleAuto}
            disabled={!online || busy}
            title="Auto-capture follows the show going live"
          >
            <span className="bc-auto-dot" /> Auto
          </button>
          <button
            className={`bc-switch ${running ? "on" : ""} ${!online || busy || auto ? "off-disabled" : ""}`}
            onClick={toggle}
            disabled={!online || busy || auto}
            aria-label={running ? "Turn bridge off" : "Turn bridge on"}
          />
        </div>
      </div>

      {!online && (
        <div className="bc-offline">
          Bridge agent offline — start it on the show Mac to control it from here (see{" "}
          <b>How the bridge works</b> below).
          {state?.agoSec != null && <span className="muted small"> Last seen {fmtAge(state.agoSec)} ago.</span>}
        </div>
      )}

      {online && (
        <div className="bc-streams">
          {!running ? (
            <div className="bc-empty">
              {auto
                ? "Auto is on — capture starts by itself when the show goes live. Just leave the broadcast windows open."
                : "Flip the switch on, then paste each broadcast link below."}
            </div>
          ) : names.length === 0 ? (
            <div className="bc-empty">
              No broadcast windows found yet — paste them below. Fullscreen is fine; minimized is not.
            </div>
          ) : (
            names.map((n) => {
              const v = streams[n];
              const age = v.last_msg ? now - v.last_msg : null;
              let cls = "ok";
              let txt = `last chat ${age != null ? fmtAge(age) + " ago" : "—"}`;
              if (!v.ok) { cls = "bad"; txt = "window lost — reopen the broadcast"; }
              else if (v.frozen) { cls = "warn"; txt = "frames frozen — minimized? un-minimize it (fullscreen is fine)"; }
              else if (age == null) { cls = "warn"; txt = "capturing, no chat read yet"; }
              else if (age > 120) { cls = "warn"; txt = `no new chat for ${fmtAge(age)}`; }
              return (
                <div className={`bc-row ${cls}`} key={n}>
                  <span className="dot" />
                  <span className="bc-name">{n}</span>
                  <span className="bc-note">{txt}</span>
                  {v.watching > 0 && <span className="bc-watch">{v.watching.toLocaleString()} watching</span>}
                </div>
              );
            })
          )}
        </div>
      )}

      <div className="bc-openrow">
        <input
          className="acct-input"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && openUrl()}
          placeholder="https://x.com/i/broadcasts/…"
          spellCheck={false}
          disabled={!online}
        />
        <button className="btn btn-gold" onClick={openUrl} disabled={!online || !url.trim()}>Open</button>
      </div>
      <div className="bc-profiles">
        <button className="btn btn-ghost" onClick={openProfiles} disabled={!online}>Open host profiles</button>
        <span className="muted small">
          Opens Banks &amp; Ansem’s X pages on the show machine, ready for the live ring — click it to
          enter the broadcast when they go live.
        </span>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        Paste a broadcast link — it opens in its own window on the show machine. Fullscreen it after.
        {bridge?.push_err && <span className="bc-err"> · push error: {bridge.push_err}</span>}
        {note && <span className="bc-err"> · {note}</span>}
      </p>

      <details className="bc-help">
        <summary>How the bridge works · setup</summary>
        <div className="bc-help-body">
          <p>
            X has no API for live-broadcast chat, so a small agent on the show Mac reads it off the
            screen and feeds it into the site’s chat. This switch controls that agent from here.
          </p>
          <div className="bc-dl">
            <button className="btn btn-gold" onClick={downloadBridge}>Download the bridge</button>
            <span className="muted small">macOS · Apple Silicon · ~90&nbsp;KB</span>
            {dl && <span className="muted small">{dl}</span>}
          </div>
          <ol>
            <li>
              <b>Install it on the show Mac.</b> Unzip, then open <code>mb-panel.command</code>. The
              very first time, right-click it → <b>Open</b> (it’s unsigned, so macOS asks once). Grant{" "}
              <b>Screen&nbsp;Recording</b> to <b>MBCapture</b> when prompted. It then runs in the
              background and the switch above turns on.
            </li>
            <li>
              <b>Open each broadcast</b> — paste its X link in the box above and hit Open. Each opens
              in its own window. <b>Fullscreen every one.</b>
            </li>
            <li>
              <b>Flip the switch on.</b> Each stream shows a green dot with a live “last chat” timer.
              Turn it off after the show.
            </li>
          </ol>
          <p>
            <b>Hands-off:</b> turn on <b>Auto</b> and you never touch the switch again — capture
            starts by itself when Banks/Ansem go live and stops when the show ends. Just leave the
            Mac on with the broadcast windows open. The switch is there for manual override.
          </p>
          <p className="bc-rule">
            <b>The one rule:</b> never <b>minimize</b> a broadcast window. Fullscreen, another
            desktop, or buried behind other apps is all fine — only minimizing to the Dock stops
            capture, and that’s a macOS limit nothing can work around.
          </p>
        </div>
      </details>
    </section>
  );
}

// Pre-show health strip — polls the hub's /status every 10s. Green across the
// board at 12:30 on Thursday = go; anything red tells you exactly what to fix.
type HubStatus = {
  ok: boolean;
  uptimeSec: number;
  wsClients: number;
  channels: { twitch: string[]; kick: string[]; xLiveHandle: string };
  sources: { twitch: boolean; kick: boolean };
  bridge: { xchatAgoSec: number | null; xLiveAgoSec: number | null };
  viewersUpdatedAgoSec: number | null;
  store?: { durable: boolean; ok: boolean | null; lastError: string | null };
};

function HealthStrip({ hubHttpUrl }: { hubHttpUrl: string }) {
  const [st, setSt] = useState<HubStatus | null>(null);
  const [dead, setDead] = useState(false);
  useEffect(() => {
    let stop = false;
    const poll = async () => {
      try {
        const r = await fetch(`${hubHttpUrl}/status`, { cache: "no-store" });
        const j = await r.json();
        if (!stop) {
          setSt(j);
          setDead(false);
        }
      } catch {
        if (!stop) setDead(true);
      }
    };
    poll();
    const t = setInterval(poll, 10000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [hubHttpUrl]);

  const fmtAgo = (s: number | null) =>
    s == null ? "never" : s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`;
  // The bridge pushes continuously during a live broadcast — older than 2 min
  // while you expect it to be running means it died or lost its windows.
  const bridgeFresh = st?.bridge.xchatAgoSec != null && st.bridge.xchatAgoSec < 120;

  const chips: { label: string; ok: boolean; detail: string }[] = dead || !st
    ? [{ label: "Hub", ok: false, detail: dead ? "unreachable" : "checking…" }]
    : [
        { label: "Hub", ok: true, detail: `up ${fmtAgo(st.uptimeSec)?.replace(" ago", "")} · ${st.wsClients} viewers` },
        { label: "Twitch src", ok: st.sources.twitch, detail: st.channels.twitch.join(", ") || "no channel" },
        { label: "Kick src", ok: st.sources.kick, detail: st.channels.kick.join(", ") || "no channel" },
        { label: "X bridge", ok: bridgeFresh, detail: `chat ${fmtAgo(st.bridge.xchatAgoSec)}` },
        { label: "Viewer counts", ok: st.viewersUpdatedAgoSec != null && st.viewersUpdatedAgoSec < 120, detail: fmtAgo(st.viewersUpdatedAgoSec) },
        // Durable storage — red means Redis is missing/failing and Bubbles,
        // clips, profiles + Kick logins will be WIPED on the next deploy.
        {
          label: "Storage",
          ok: st.store ? st.store.ok !== false && st.store.durable : false,
          detail: !st.store
            ? "unknown"
            : !st.store.durable
            ? "NOT durable — no Redis configured"
            : st.store.ok === false
            ? `FAILING: ${st.store.lastError ?? "unreachable"}`
            : "durable ✓",
        },
      ];

  return (
    <div className="healthstrip" role="status" aria-label="Hub health">
      {chips.map((c) => (
        <span key={c.label} className={`hs-chip ${c.ok ? "ok" : "bad"}`}>
          <span className="dot" style={{ background: c.ok ? "var(--up)" : "var(--down)" }} />
          <b>{c.label}</b>
          <span className="hs-detail">{c.detail}</span>
        </span>
      ))}
    </div>
  );
}

// ---- Live prediction poll control (operator picks the Polymarket market) ----
type PollMarket = { id: string; question: string; odds: number[] };

function PollControl({ hubHttpUrl, poll }: { hubHttpUrl: string; poll: Poll | null }) {
  const [opKey, setOpKey] = useState("");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PollMarket[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    try { setOpKey(localStorage.getItem("mb.operatorKey") || ""); } catch {}
  }, []);

  const search = async () => {
    if (!opKey) { setNote("Set your operator key in the Bridge control above first."); return; }
    setBusy(true); setNote("");
    try {
      const r = await fetch(
        `${hubHttpUrl}/poll/search?q=${encodeURIComponent(q)}&key=${encodeURIComponent(opKey)}`,
        { cache: "no-store" }
      );
      const j = await r.json();
      setResults(j.markets || []);
      if (!(j.markets || []).length) setNote("No Yes/No markets found — try another search.");
    } catch { setNote("Search failed."); } finally { setBusy(false); }
  };

  const setMarket = async (id: string) => {
    setBusy(true); setNote("");
    try {
      const r = await fetch(`${hubHttpUrl}/poll/set?id=${encodeURIComponent(id)}&key=${encodeURIComponent(opKey)}`);
      const j = await r.json();
      if (j.ok) { setNote("Poll is live — chat can vote YES / NO."); setResults([]); setQ(""); }
      else setNote(j.error || "Failed to set market.");
    } catch { setNote("Failed to set market."); } finally { setBusy(false); }
  };

  const close = () => fetch(`${hubHttpUrl}/poll/close?key=${encodeURIComponent(opKey)}`).catch(() => {});
  const clear = () => fetch(`${hubHttpUrl}/poll/clear?key=${encodeURIComponent(opKey)}`).catch(() => {});

  const roomYes = poll && poll.total ? Math.round((poll.yes / poll.total) * 100) : null;
  const mktYes = poll && poll.oddsYes != null ? Math.round(poll.oddsYes * 100) : null;

  return (
    <section className="pollctl">
      <div className="pollctl-head">
        <b>Prediction poll</b>
        <span className="muted small">chat votes YES / NO across Twitch · Kick · X, shown vs Polymarket</span>
      </div>

      {poll && (
        <div className="pollctl-active">
          <div className="pollctl-q">{poll.question}</div>
          <div className="muted small">
            Room {roomYes ?? 0}% YES · Market {mktYes ?? "—"}% YES · {poll.total} votes ·{" "}
            <b>{poll.open ? "OPEN" : "closed"}</b>
          </div>
          <div className="pollctl-actions">
            {poll.open && <button type="button" onClick={close}>Close voting</button>}
            <button type="button" onClick={clear}>Clear</button>
          </div>
        </div>
      )}

      <div className="pollctl-search">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder="Search Polymarket (blank = top markets)…"
        />
        <button type="button" onClick={search} disabled={busy}>Search</button>
      </div>

      {note && <p className="muted small pollctl-note">{note}</p>}

      {results.length > 0 && (
        <div className="pollctl-results">
          {results.map((m) => (
            <button key={m.id} type="button" className="pollctl-result" onClick={() => setMarket(m.id)}>
              <span className="pollctl-result-q">{m.question}</span>
              <span className="muted small">YES {Math.round((m.odds?.[0] || 0) * 100)}%</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

type StudioClip = {
  id: string; url: string; platform: string; by: string; bySource: string;
  status: string; featured: boolean; tier: string | null; views: number; bubbles: number;
  author?: string | null; attributed?: boolean;
  // scanner evidence (operator payload only)
  trust?: { score: number; reasons: string[]; flaggedAt: number | null } | null;
  scannedAt?: number | null;
  autoApproved?: boolean;
  lastStats?: { ts: number; views: number | null; likes: number | null; comments: number | null } | null;
};

// Scanner evidence line for a clip row — flag reasons, or the clean read.
function ClipScanInfo({ c }: { c: StudioClip }) {
  if (!c.scannedAt) return null;
  const flagged = !!c.trust?.flaggedAt;
  const st = c.lastStats;
  return (
    <span className={`clipq-scan ${flagged ? "bad" : "ok"}`}>
      {flagged ? (
        <>⚠ bot-suspect (score {c.trust!.score}): {c.trust!.reasons.join(" · ")}</>
      ) : (
        <>
          scanned ✓{st?.views != null ? ` · ${st.views.toLocaleString()} views` : ""}
          {st?.likes != null ? ` · ${st.likes.toLocaleString()} likes` : ""}
          {c.autoApproved ? " · auto-approved" : ""}
        </>
      )}
    </span>
  );
}

// Clip-to-Earn review queue — approve (with reach tier + views) / reject pending
// clips, and feature the best. Approval pays Bubbles to the clipper's Floor balance.
type CockpitRow = {
  id: string; type: string; channel: string; label: string; platform: string; url: string;
  spend: number; views: number; cpm: number | null; viewsPerDollar: number | null;
  flagged: boolean; flagReason: string | null; removed: boolean;
};
type CockpitLeader = { rank: number; id: string; label: string; channel: string; type: string; spend: number; views: number; cpm: number | null; viewsPerDollar: number | null; flagged: boolean };
type CockpitSnap = { ts: number; spend: number; views: number; cpm: number | null; followers: number; count: number };
type CockpitData = {
  rows: CockpitRow[];
  totals: { spend: number; views: number; blendedCpm: number | null; followers: number; costPerFollower: number | null; count: number };
  spendByType: { type: string; spend: number }[];
  leaderboard: CockpitLeader[];
  snapshots: CockpitSnap[];
  flags: { id: string; label: string; reason: string }[];
  report: string;
};

// Parse a CSV export (Whop / Vyro campaign data) into cockpit entries. Handles
// quoted fields and maps columns by keyword so it works across export formats.
function parseCockpitCsv(text: string): { type: string; channel: string; label: string; spend: number; views: number; followerDelta: number }[] {
  const rows: string[][] = [];
  let field = "", row: string[] = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += c; }
    else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const header = (rows.shift() || []).map((h) => h.trim().toLowerCase());
  const numv = (s: string) => { const n = parseFloat(String(s).replace(/[^0-9.\-]/g, "")); return Number.isFinite(n) ? n : 0; };
  return rows
    .filter((r) => r.some((c) => c.trim()))
    .map((r) => {
      const o: Record<string, string> = {};
      header.forEach((h, i) => (o[h] = (r[i] || "").trim()));
      const find = (kw: string[]) => { for (const k in o) if (kw.some((w) => k.includes(w))) return o[k]; return ""; };
      const typeRaw = find(["type", "kind"]).toLowerCase();
      return {
        type: typeRaw.includes("place") ? "placement" : "clipper",
        channel: find(["channel", "platform", "source", "server", "campaign", "seller", "account"]),
        label: find(["clipper", "creator", "handle", "username", "name", "label", "title", "video", "clip"]),
        spend: numv(find(["spend", "cost", "amount", "paid", "budget", "payout"])),
        views: numv(find(["view", "play", "impression", "reach"])),
        followerDelta: numv(find(["follow"])),
      };
    });
}

// Distribution Cockpit — one ledger across paid clipper campaigns + placements
// with reach-per-$, bot-cheap flags, and the weekly report. (Campaigns run on
// Whop/Vyro/Discord/placements; this is the measurement layer on top.)
function CockpitControl({ hubHttpUrl }: { hubHttpUrl: string }) {
  const [opKey, setOpKey] = useState("");
  const [data, setData] = useState<CockpitData | null>(null);
  const [copied, setCopied] = useState(false);
  const [msg, setMsg] = useState("");
  const [form, setForm] = useState({ type: "clipper", channel: "", label: "", platform: "", spend: "", views: "" });
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { try { setOpKey(localStorage.getItem("mb.operatorKey") || ""); } catch {} }, []);

  const load = useCallback(async () => {
    if (!opKey) return;
    try { const r = await fetch(`${hubHttpUrl}/cockpit?key=${encodeURIComponent(opKey)}`, { cache: "no-store" }); setData(await r.json()); } catch {}
  }, [hubHttpUrl, opKey]);
  useEffect(() => { load(); }, [load]);

  const post = async (path: string, body: object) => {
    const r = await fetch(`${hubHttpUrl}/cockpit/${path}?key=${encodeURIComponent(opKey)}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    return r.json();
  };
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.channel.trim() && !form.label.trim()) return;
    setData(await post("add", { ...form, spend: Number(form.spend) || 0, views: Number(form.views) || 0 }));
    setForm({ type: "clipper", channel: "", label: "", platform: "", spend: "", views: "" });
  };
  const importFile = async (file: File) => {
    setMsg("Importing…");
    try {
      const entries = parseCockpitCsv(await file.text());
      if (!entries.length) { setMsg("No rows found in that CSV."); return; }
      const j = await post("import", { entries });
      setData(j);
      setMsg(`Imported ${j.imported ?? entries.length} rows from ${file.name}.`);
    } catch { setMsg("Couldn't read that file."); }
  };
  const snapshot = async (reset: boolean) => {
    if (reset && !confirm("Save this week to the trend and clear the ledger for next week?")) return;
    setData(await post("snapshot", { reset }));
    setMsg(reset ? "Week closed — snapshot saved, ledger cleared." : "Snapshot saved to the trend.");
  };
  const fmt = (n: number) => Number(n || 0).toLocaleString("en-US");

  const t = data?.totals;
  const clipPct = t && t.spend > 0 ? Math.round(((data!.spendByType.find((s) => s.type === "clipper")?.spend || 0) / t.spend) * 100) : 0;
  const snaps = data?.snapshots ?? [];
  const maxSnapViews = Math.max(1, ...snaps.map((s) => s.views));

  return (
    <section className="pollctl">
      <div className="pollctl-head">
        <b>Distribution cockpit</b>
        <span className="muted small">ROI leaderboard · bot flags · week-over-week trend · weekly report · Whop/Vyro CSV import</span>
      </div>

      {!opKey && <p className="muted small pollctl-note">Set your operator key in the Bridge control above first.</p>}

      {t && (
        <div className="ckpt-totals">
          <div className="ckpt-stat"><span className="ckpt-stat-n">${fmt(t.spend)}</span><span className="ckpt-stat-l">spend</span></div>
          <div className="ckpt-stat"><span className="ckpt-stat-n">{fmt(t.views)}</span><span className="ckpt-stat-l">views</span></div>
          <div className="ckpt-stat"><span className="ckpt-stat-n">{t.blendedCpm != null ? `$${t.blendedCpm}` : "—"}</span><span className="ckpt-stat-l">blended CPM</span></div>
          <div className="ckpt-stat"><span className="ckpt-stat-n">{t.costPerFollower != null ? `$${t.costPerFollower}` : "—"}</span><span className="ckpt-stat-l">$/follower</span></div>
          <div className="ckpt-stat"><span className="ckpt-stat-n">{clipPct}/{100 - clipPct}</span><span className="ckpt-stat-l">clip / place %</span></div>
        </div>
      )}

      <form className="ckpt-form" onSubmit={add}>
        <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
          <option value="clipper">Clipper</option>
          <option value="placement">Placement</option>
        </select>
        <input placeholder="channel (Whop / Vyro / @account)" value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })} />
        <input placeholder="label" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
        <input className="ckpt-sm" placeholder="$ spend" inputMode="numeric" value={form.spend} onChange={(e) => setForm({ ...form, spend: e.target.value })} />
        <input className="ckpt-sm" placeholder="views" inputMode="numeric" value={form.views} onChange={(e) => setForm({ ...form, views: e.target.value })} />
        <button type="submit">Add</button>
      </form>
      <div className="ckpt-toolbar">
        <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.currentTarget.value = ""; }} />
        <button type="button" onClick={() => fileRef.current?.click()}>↑ Import CSV (Whop / Vyro)</button>
        <button type="button" onClick={() => snapshot(false)}>Save snapshot</button>
        <button type="button" onClick={() => snapshot(true)}>Close week ↺</button>
        {msg && <span className="muted small ckpt-msg">{msg}</span>}
      </div>

      {data && data.leaderboard.length > 0 && (
        <div className="ckpt-group">
          <div className="ckpt-group-label">ROI leaderboard · views per $</div>
          {data.leaderboard.slice(0, 10).map((l) => (
            <div key={l.id} className={`ckpt-lead${l.flagged ? " flagged" : ""}`}>
              <span className="ckpt-lead-rank">{l.rank}</span>
              <span className="ckpt-lead-name"><b>{l.label}</b> <span className="muted small">{l.type}</span></span>
              <span className="ckpt-lead-vpd">{fmt(Math.round(l.viewsPerDollar || 0))}<span className="muted small"> /$</span></span>
              <span className="muted small ckpt-lead-cpm">{l.cpm != null ? `$${l.cpm} CPM` : "—"}{l.flagged ? " ⚠" : ""}</span>
            </div>
          ))}
        </div>
      )}

      {snaps.length > 0 && (
        <div className="ckpt-group">
          <div className="ckpt-group-label">Week-over-week · reach &amp; CPM</div>
          <div className="ckpt-trend">
            {snaps.slice(-12).map((s, i) => (
              <div key={i} className="ckpt-trend-col" title={`${fmt(s.views)} views · $${fmt(s.spend)} · ${s.cpm != null ? `$${s.cpm} CPM` : "—"}`}>
                <span className="ckpt-trend-bar" style={{ height: `${Math.max(4, Math.round((s.views / maxSnapViews) * 100))}%` }} />
                <span className="ckpt-trend-cpm">{s.cpm != null ? `$${s.cpm}` : "—"}</span>
              </div>
            ))}
          </div>
          <div className="muted small">bars = views per snapshot · number = blended CPM (lower = more efficient)</div>
        </div>
      )}

      {data && data.rows.length > 0 && (
        <div className="ckpt-group">
          <div className="ckpt-group-label">Ledger</div>
          <div className="ckpt-rows">
            {data.rows.map((r) => (
              <div key={r.id} className={`ckpt-row${r.flagged ? " flagged" : ""}${r.removed ? " removed" : ""}`}>
                <span className="ckpt-row-main">
                  <b>{r.label || r.channel}</b>
                  <span className="muted small">{r.channel}{r.channel && r.label ? " · " : ""}{r.type}{r.platform ? ` · ${r.platform}` : ""}</span>
                </span>
                <span className="ckpt-row-nums muted small">
                  ${fmt(r.spend)} · {fmt(r.views)} views · {r.cpm != null ? `$${r.cpm} CPM` : "—"}
                  {r.flagged && <span className="ckpt-flag" title={r.flagReason || ""}>⚠ bot?</span>}
                </span>
                <span className="ckpt-row-act">
                  {!r.removed && <button type="button" onClick={async () => setData(await post("update", { id: r.id, removed: true }))} title="Caught a bot — pull it">Pull</button>}
                  <button type="button" onClick={async () => setData(await post("delete", { id: r.id }))}>✕</button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {data?.report && (
        <div className="ckpt-report">
          <div className="ckpt-report-head">
            <span className="muted small">Weekly report</span>
            <button type="button" onClick={() => { navigator.clipboard?.writeText(data.report).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>
              {copied ? "Copied ✓" : "Copy"}
            </button>
          </div>
          <pre className="ckpt-report-pre">{data.report}</pre>
        </div>
      )}
    </section>
  );
}

function ClipQueue({ hubHttpUrl }: { hubHttpUrl: string }) {
  const [opKey, setOpKey] = useState("");
  const [clips, setClips] = useState<StudioClip[]>([]);
  const [views, setViews] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");

  useEffect(() => { try { setOpKey(localStorage.getItem("mb.operatorKey") || ""); } catch {} }, []);

  const load = useCallback(async () => {
    if (!opKey) return;
    try {
      const r = await fetch(`${hubHttpUrl}/clips/all?key=${encodeURIComponent(opKey)}`, { cache: "no-store" });
      const j = await r.json();
      setClips(j.clips || []);
    } catch {}
  }, [hubHttpUrl, opKey]);

  useEffect(() => { load(); const t = setInterval(load, 12000); return () => clearInterval(t); }, [load]);

  const decide = async (id: string, action: "approve" | "reject", tier?: string) => {
    const v = Number(views[id]);
    const r = await fetch(`${hubHttpUrl}/clips/decide?key=${encodeURIComponent(opKey)}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, action, tier, views: Number.isFinite(v) ? v : undefined }),
    });
    const j = await r.json();
    if (!j.ok) setNote(j.error || "Action failed."); else setNote("");
    load();
  };
  const feature = async (id: string, on: boolean) => {
    await fetch(`${hubHttpUrl}/clips/feature?key=${encodeURIComponent(opKey)}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, on }),
    }).catch(() => {});
    load();
  };

  const pending = clips.filter((c) => c.status === "pending");
  const approved = clips.filter((c) => c.status === "approved");

  return (
    <section className="pollctl">
      <div className="pollctl-head">
        <b>Clip-to-Earn queue</b>
        <span className="muted small">YouTube/X/Twitch/Kick clips auto-scan + auto-approve when clean — this queue is bot-suspects (evidence attached), TikTok/IG, and low-reach clips · B 250 · A 1,000 · S 4,000 ◆ · feature +5,000</span>
      </div>

      {!opKey && <p className="muted small pollctl-note">Set your operator key in the Bridge control above first.</p>}
      {note && <p className="muted small pollctl-note">{note}</p>}

      <div className="clipq-group">
        <div className="clipq-label">Pending {pending.length > 0 && <span className="clipq-count">{pending.length}</span>}</div>
        {pending.length === 0 ? (
          <p className="muted small">Nothing waiting.</p>
        ) : pending.map((c) => (
          <div key={c.id} className="clipq-row">
            <div className="clipq-meta">
              <span className="muted small">
                {c.platform} · @{c.by}{" "}
                {c.attributed ? (
                  <span className="clipq-attr ok" title={`Clip is by @${c.author} — a verified account of @${c.by}`}>✓ author verified</span>
                ) : c.author ? (
                  <span className="clipq-attr warn" title={`Clip is by @${c.author}, not a verified account of @${c.by}`}>⚠ by @{c.author} (not linked)</span>
                ) : null}
              </span>
              <a href={c.url} target="_blank" rel="noreferrer" className="clipq-url">{c.url}</a>
              <ClipScanInfo c={c} />
            </div>
            <div className="clipq-actions">
              <input
                className="clipq-views" inputMode="numeric" placeholder="views"
                value={views[c.id] ?? ""} onChange={(e) => setViews((v) => ({ ...v, [c.id]: e.target.value }))}
              />
              <button type="button" onClick={() => decide(c.id, "approve", "S")}>S</button>
              <button type="button" onClick={() => decide(c.id, "approve", "A")}>A</button>
              <button type="button" onClick={() => decide(c.id, "approve", "B")}>B</button>
              <button type="button" className="clipq-reject" onClick={() => decide(c.id, "reject")}>Reject</button>
            </div>
          </div>
        ))}
      </div>

      {approved.length > 0 && (
        <div className="clipq-group">
          <div className="clipq-label">Approved</div>
          {approved.map((c) => (
            <div key={c.id} className="clipq-row">
              <div className="clipq-meta">
                <span className="muted small">{c.platform} · @{c.by} · tier {c.tier} · {c.views.toLocaleString()} views · {c.bubbles.toLocaleString()} ◆{c.featured ? " · ★ featured" : ""}</span>
                <a href={c.url} target="_blank" rel="noreferrer" className="clipq-url">{c.url}</a>
                <ClipScanInfo c={c} />
              </div>
              <div className="clipq-actions">
                <button type="button" onClick={() => feature(c.id, !c.featured)}>{c.featured ? "Unfeature" : "Feature ★"}</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// Roster — the top fans + clippers who added payout/social info, ranked by
// Bubbles. Banks & Ansem use this to send crypto giveaway winnings and find/tag
// people. Operator-only (crypto addresses aren't shown to the public).
type RosterProfile = {
  wallets: Partial<Record<"sol" | "eth" | "btc", string>>;
  socials: Partial<Record<"x" | "tiktok" | "instagram" | "discord" | "website", { handle?: string; url?: string }>>;
};
type RosterRow = { key: string; source: string; name: string; points: number; profile: RosterProfile };

const WALLET_LABEL: Record<string, string> = { sol: "SOL", eth: "ETH", btc: "BTC" };
const SOCIAL_LABEL: Record<string, string> = { x: "X", tiktok: "TikTok", instagram: "IG", discord: "Discord", website: "Site" };

function Roster({ hubHttpUrl }: { hubHttpUrl: string }) {
  const [opKey, setOpKey] = useState("");
  const [rows, setRows] = useState<RosterRow[]>([]);
  const [copied, setCopied] = useState("");

  useEffect(() => { try { setOpKey(localStorage.getItem("mb.operatorKey") || ""); } catch {} }, []);

  const load = useCallback(async () => {
    if (!opKey) return;
    try {
      const r = await fetch(`${hubHttpUrl}/roster?key=${encodeURIComponent(opKey)}`, { cache: "no-store" });
      const j = await r.json();
      setRows(j.roster || []);
    } catch {}
  }, [hubHttpUrl, opKey]);

  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);

  const copy = (id: string, text: string) => {
    navigator.clipboard?.writeText(text).then(() => { setCopied(id); setTimeout(() => setCopied(""), 1400); }).catch(() => {});
  };

  return (
    <section className="pollctl">
      <div className="pollctl-head">
        <b>Roster · payouts &amp; socials</b>
        <span className="muted small">who to pay for giveaways/bounties + find them on socials · ranked by Bubbles</span>
      </div>

      {!opKey && <p className="muted small pollctl-note">Set your operator key in the X Capture tab first.</p>}
      {opKey && rows.length === 0 && <p className="muted small">No one's added payout info yet.</p>}

      <div className="roster">
        {rows.map((r, i) => {
          const wallets = Object.entries(r.profile.wallets || {});
          const socials = Object.entries(r.profile.socials || {});
          return (
            <div key={r.key} className="roster-row">
              <div className="roster-who">
                <span className="roster-rank">{String(i + 1).padStart(2, "0")}</span>
                <span className="roster-name">{r.name}</span>
                <span className={`clip-badge plat-${r.source}`}>{r.source}</span>
                <span className="roster-pts">{r.points.toLocaleString()} ◆</span>
              </div>
              {(wallets.length > 0 || socials.length > 0) && (
                <div className="roster-links">
                  {socials.map(([net, v]) => (
                    v?.url ? (
                      <a key={net} className="roster-chip social" href={v.url} target="_blank" rel="noreferrer noopener" title={SOCIAL_LABEL[net] ?? net}>
                        <SocialLogo net={net} size={11} />{v.handle ? ` @${v.handle}` : net === "website" ? " site" : ""}
                      </a>
                    ) : v?.handle ? (
                      <button key={net} type="button" className="roster-chip social" onClick={() => copy(`${r.key}:${net}`, v.handle!)} title={`Copy ${SOCIAL_LABEL[net] ?? net}`}>
                        <SocialLogo net={net} size={11} /> {v.handle} {copied === `${r.key}:${net}` ? "✓" : "⧉"}
                      </button>
                    ) : null
                  ))}
                  {wallets.map(([chain, addr]) => (
                    <button key={chain} type="button" className="roster-chip wallet" onClick={() => copy(`${r.key}:${chain}`, addr as string)} title="Copy address">
                      {WALLET_LABEL[chain] ?? chain} {copied === `${r.key}:${chain}` ? "copied ✓" : `${(addr as string).slice(0, 4)}…${(addr as string).slice(-4)} ⧉`}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---- Quests control: create quests, hand-award IRL ones, export the airdrop
// roster (verified wallets + weights) for the show's own wallet / Bullpen. ----
type StudioQuest = {
  id: string; type: "hold" | "interact" | "manual"; title: string; desc: string;
  mint: string | null; minAmount: number; days: number; programId: string | null;
  protocol: string; link: string | null; reward: number; weight: number; active: boolean;
};
type QuestRosterRow = { key: string; name: string; source: string; wallet: string; verified: boolean; weight: number; done: string[] };

function QuestsControl({ hubHttpUrl }: { hubHttpUrl: string }) {
  const [opKey, setOpKey] = useState("");
  const [quests, setQuests] = useState<StudioQuest[]>([]);
  const [roster, setRoster] = useState<QuestRosterRow[]>([]);
  const [note, setNote] = useState("");
  const [copied, setCopied] = useState(false);
  // new-quest form
  const [qType, setQType] = useState<"hold" | "interact" | "manual">("interact");
  const [f, setF] = useState<Record<string, string>>({ title: "", desc: "", link: "", mint: "", minAmount: "", days: "3", programId: "", protocol: "", reward: "750", weight: "1" });
  // manual award
  const [awardQuest, setAwardQuest] = useState("");
  const [awardSrc, setAwardSrc] = useState<"twitch" | "kick">("twitch");
  const [awardUser, setAwardUser] = useState("");

  useEffect(() => { try { setOpKey(localStorage.getItem("mb.operatorKey") || ""); } catch {} }, []);

  const load = useCallback(async () => {
    try {
      const q = await fetch(`${hubHttpUrl}/quests`, { cache: "no-store" }).then((r) => r.json());
      setQuests(q.quests ?? []);
    } catch {}
    if (!opKey) return;
    try {
      const r = await fetch(`${hubHttpUrl}/quests/roster?key=${encodeURIComponent(opKey)}`, { cache: "no-store" }).then((r) => r.json());
      setRoster(r.roster ?? []);
    } catch {}
  }, [hubHttpUrl, opKey]);
  useEffect(() => { load(); const t = setInterval(load, 20000); return () => clearInterval(t); }, [load]);

  const post = async (path: string, body: object) => {
    const r = await fetch(`${hubHttpUrl}/quests/${path}?key=${encodeURIComponent(opKey)}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!j.ok && j.error) setNote(j.error); else setNote("");
    load();
    return j;
  };

  const createQuest = () =>
    post("upsert", { type: qType, title: f.title, desc: f.desc, link: f.link, mint: f.mint, minAmount: f.minAmount, days: f.days, programId: f.programId, protocol: f.protocol, reward: f.reward, weight: f.weight })
      .then((j) => { if (j.ok) setF((v) => ({ ...v, title: "", desc: "" })); });

  const copyCsv = () => {
    const csv = ["name,source,wallet,verified,weight,quests_done",
      ...roster.map((r) => `${r.name},${r.source},${r.wallet},${r.verified ? "yes" : "no"},${r.weight},"${r.done.join("; ")}"`)].join("\n");
    navigator.clipboard?.writeText(csv).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
  };

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF((v) => ({ ...v, [k]: e.target.value }));
  const manualQuests = quests.filter((q) => q.type === "manual");

  return (
    <section className="pollctl">
      <div className="pollctl-head">
        <b>Quests &amp; airdrop roster</b>
        <span className="muted small">on-chain quests (hold / use protocols) auto-verify from members&apos; proven wallets · roster export feeds the show&apos;s airdrop wallet or Bullpen</span>
      </div>
      {!opKey && <p className="muted small pollctl-note">Set your operator key in the X Capture tab first.</p>}
      {note && <p className="muted small pollctl-note">{note}</p>}

      <div className="clipq-group">
        <div className="clipq-label">Live quests</div>
        {quests.length === 0 ? <p className="muted small">None yet.</p> : quests.map((q) => (
          <div key={q.id} className="clipq-row">
            <div className="clipq-meta">
              <span className="muted small"><b>{q.type.toUpperCase()}</b> · {q.title} · {q.reward.toLocaleString()} ◆ · +{q.weight} weight</span>
              {q.type === "hold" && <span className="clipq-scan ok">hold ≥{q.minAmount} {q.mint ? "of mint " + q.mint.slice(0, 6) + "…" : "SOL"} for {q.days}d</span>}
              {q.type === "interact" && <span className="clipq-scan ok">tx touching {q.protocol || q.programId?.slice(0, 8) + "…"}</span>}
            </div>
            <div className="clipq-actions">
              <button type="button" onClick={() => post("upsert", { id: q.id, active: !q.active })}>{q.active ? "Pause" : "Resume"}</button>
              <button type="button" className="clipq-reject" onClick={() => post("delete", { id: q.id })}>Delete</button>
            </div>
          </div>
        ))}
      </div>

      <div className="clipq-group">
        <div className="clipq-label">New quest</div>
        <div className="qc-form">
          <select className="clip-acc-select" value={qType} onChange={(e) => setQType(e.target.value as typeof qType)}>
            <option value="interact">interact — use a protocol</option>
            <option value="hold">hold — balance streak</option>
            <option value="manual">manual — IRL / quality posts</option>
          </select>
          <input className="clip-input" placeholder="title" value={f.title} onChange={set("title")} />
          <input className="clip-input" placeholder="description" value={f.desc} onChange={set("desc")} />
          <input className="clip-input" placeholder="link (https://app.bullpen.fi/…?ref=blknoiz06)" value={f.link} onChange={set("link")} />
          {qType === "hold" && (<>
            <input className="clip-input" placeholder="mint address (blank = SOL)" value={f.mint} onChange={set("mint")} />
            <input className="clip-input" placeholder="min amount" value={f.minAmount} onChange={set("minAmount")} />
            <input className="clip-input" placeholder="days" value={f.days} onChange={set("days")} />
          </>)}
          {qType === "interact" && (<>
            <input className="clip-input" placeholder="program id (e.g. Jupiter v6)" value={f.programId} onChange={set("programId")} />
            <input className="clip-input" placeholder="protocol name" value={f.protocol} onChange={set("protocol")} />
          </>)}
          <input className="clip-input" placeholder="reward ◆" value={f.reward} onChange={set("reward")} />
          <input className="clip-input" placeholder="airdrop weight" value={f.weight} onChange={set("weight")} />
          <button type="button" className="clip-submit-btn" onClick={createQuest} disabled={!f.title.trim()}>Create quest</button>
        </div>
      </div>

      {manualQuests.length > 0 && (
        <div className="clipq-group">
          <div className="clipq-label">Hand-award (IRL / quality posts)</div>
          <div className="qc-form">
            <select className="clip-acc-select" value={awardQuest} onChange={(e) => setAwardQuest(e.target.value)}>
              <option value="">pick quest…</option>
              {manualQuests.map((q) => <option key={q.id} value={q.id}>{q.title}</option>)}
            </select>
            <select className="clip-acc-select" value={awardSrc} onChange={(e) => setAwardSrc(e.target.value as "twitch" | "kick")}>
              <option value="twitch">twitch</option>
              <option value="kick">kick</option>
            </select>
            <input className="clip-input" placeholder="username" value={awardUser} onChange={(e) => setAwardUser(e.target.value)} />
            <button type="button" className="clip-submit-btn ghost" disabled={!awardQuest || !awardUser.trim()}
              onClick={() => post("award", { questId: awardQuest, source: awardSrc, username: awardUser.trim() }).then((j) => { if (j.ok) setAwardUser(""); })}>
              Award
            </button>
          </div>
        </div>
      )}

      <div className="clipq-group">
        <div className="clipq-label">Airdrop roster {roster.length > 0 && <span className="clipq-count">{roster.length}</span>}
          {roster.length > 0 && <button type="button" className="clip-acc-cancel" onClick={copyCsv}>{copied ? "copied ✓" : "copy CSV"}</button>}
        </div>
        {roster.length === 0 ? <p className="muted small">No verified wallets yet.</p> : roster.slice(0, 30).map((r, i) => (
          <div key={r.key} className="clipq-row">
            <div className="clipq-meta">
              <span className="muted small">{String(i + 1).padStart(2, "0")} · <b>{r.name}</b> · {r.source} · weight <b>{r.weight}</b>{r.done.length ? ` · ${r.done.length} quest${r.done.length === 1 ? "" : "s"}` : ""}</span>
              <span className="clipq-url">{r.wallet}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
