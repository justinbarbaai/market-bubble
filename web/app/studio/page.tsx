"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ChatFeed } from "../components/ChatFeed";
import { useHub, type Poll } from "../lib/useHub";
import { SITE_DEFAULT_LOOK, type OverlayOptions } from "../lib/overlay";
import { SourceLogo, SOURCE_LABELS, type SourceKey } from "../components/logos";
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
  const [banksTwitch, setBanksTwitch] = useState("fazebanks");
  const [ansemKick, setAnsemKick] = useState("ansem");

  const [twitch, setTwitch] = useState<string[]>([]);
  const [kick, setKick] = useState<string[]>([]);
  const [seeded, setSeeded] = useState(false);

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
    const tw = [...new Set([clean(banksTwitch), ...guestTw].filter(Boolean))];
    const kk = [...new Set([clean(ansemKick), ...guestKk].filter(Boolean))];
    setTwitch(tw);
    setKick(kk);
    applyChannels({ twitch: tw, kick: kk, xQuery: "" });
  };

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
        <span className="studio-eyebrow">Operator console</span>
        <h1 className="studio-h1">Connect the show.</h1>
        <p className="studio-sub">
          Link Banks &amp; Ansem&apos;s accounts — every account you connect merges into the one chat
          everyone sees. The chat look is each viewer&apos;s own, set from the live room.
        </p>
      </section>

      {/* live source status */}
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

      {/* pre-show health: hub + bridge freshness at a glance */}
      <HealthStrip hubHttpUrl={hubHttpUrl} />

      {/* remote control of the X-bridge running on the show machine */}
      <BridgeControl hubHttpUrl={hubHttpUrl} />

      {/* the live "chat vs the market" prediction poll */}
      <PollControl hubHttpUrl={hubHttpUrl} poll={poll} />

      {/* host account cards — connect + channel, the one place the feed is built */}
      <div className="host-grid">
        <HostAccountCard name="Banks" role="Host" avatarHandle="Banks">
          <PlatformBlock
            source="twitch"
            value={banksTwitch}
            onChange={setBanksTwitch}
            placeholder="fazebanks"
            on={!!twAuth}
            stateLabel={twAuth ? "Connected" : "Not connected"}
            connect={twitchConnect}
          />
        </HostAccountCard>

        <HostAccountCard name="Ansem" role="Co-host" avatarHandle="blknoiz06">
          <PlatformBlock
            source="kick"
            value={ansemKick}
            onChange={setAnsemKick}
            placeholder="ansem"
            on={kickConnected}
            stateLabel={kickConnected ? "Connected" : "Not connected"}
            connect={kickConnect}
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
        <button className="btn btn-gold" onClick={applyHosts}>Apply &amp; merge chat</button>
        <span className="muted small">
          Merges every connected account — Banks (Twitch) + Ansem (Kick) + guests — into the one
          chat everyone sees. X chat comes in through the bridge above.
        </span>
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
  connect: ReactNode;
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
      <div className="acct-connect">{connect}</div>
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
