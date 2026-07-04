"use client";

import { useLayoutEffect, useMemo, useRef, useState, useEffect } from "react";
import type { ChatMessage, ChatBadge, Profile } from "../lib/useHub";
import type { OverlayOptions } from "../lib/overlay";
import { FONT_STACKS } from "../lib/overlay";
import { SourceLogo, SOURCE_LABELS } from "./logos";
import { KICK_BADGES } from "./kickBadges";

function nameColorFor(m: ChatMessage, mode: OverlayOptions["nameColor"]): string {
  // "white" = the theme's ink: paper-white on dark, true ink in light mode —
  // a literal #fff would vanish on cream paper.
  if (mode === "white") return "var(--text)";
  if (mode === "platform") return m.color;
  // "chatter": the user's real platform color, falling back to platform tint.
  return m.userColor || m.color;
}

// Twitch-style readable colors: clamp a name color's lightness per theme so a
// near-white name never vanishes on cream paper and a near-black one never
// vanishes on dark newsprint. Non-hex values (e.g. var(--text)) pass through.
function clampForTheme(color: string, light: boolean): string {
  let m = String(color || "").trim().match(/^#([0-9a-f]{6})$/i);
  let hex = m?.[1];
  const m3 = String(color || "").trim().match(/^#([0-9a-f]{3})$/i);
  if (!hex && m3) hex = m3[1].split("").map((c) => c + c).join("");
  if (!hex) return color;
  const n = parseInt(hex, 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  if (light && lum > 0.58) {
    // too bright for paper — scale toward ink, keeping the hue
    const f = 0.5 / Math.max(lum, 0.001);
    r = Math.round(r * f); g = Math.round(g * f); b = Math.round(b * f);
  } else if (!light && lum < 0.35) {
    // too dark for newsprint — blend toward paper, keeping the hue
    const t = (0.55 - lum) / (1 - lum);
    r = Math.round(r + (255 - r) * t); g = Math.round(g + (255 - g) * t); b = Math.round(b + (255 - b) * t);
  } else {
    return color;
  }
  return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

// The current theme, kept live so name colors re-clamp the moment it flips.
function useLightTheme(): boolean {
  const [light, setLight] = useState(false);
  useEffect(() => {
    const el = document.documentElement;
    const read = () => setLight(el.getAttribute("data-theme") === "light");
    read();
    const mo = new MutationObserver(read);
    mo.observe(el, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);
  return light;
}

// Short labels for role badges that lack a real image (Kick roles, or Twitch
// badges whose art hasn't loaded yet).
const BADGE_LABELS: Record<string, string> = {
  broadcaster: "HOST",
  mod: "MOD",
  vip: "VIP",
  founder: "FND",
  og: "OG",
  sub: "SUB",
  gifter: "GIFT",
  staff: "STAFF",
  verified: "✓",
  artist: "ART",
};

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// The face of the channel a message came from (the "Streamer face" badge).
// Hosts resolve via unavatar; unknown channels fall back to the platform logo
// (the img errors out and the logo square underneath shows through).
const KNOWN_FACES: Record<string, string> = {
  "twitch:fazebanks": "https://unavatar.io/twitter/Banks",
  "kick:ansem": "https://unavatar.io/twitter/blknoiz06",
};
function faceUrl(source: string, channel?: string | null, username?: string): string | null {
  if (source === "x" && username) return `https://unavatar.io/x/${encodeURIComponent(username.replace(/^@/, ""))}`;
  const key = `${source}:${(channel || "").toLowerCase()}`;
  if (KNOWN_FACES[key]) return KNOWN_FACES[key];
  if (source === "twitch" && channel) return `https://unavatar.io/twitch/${encodeURIComponent(channel)}`;
  return null;
}

// Link to the chatter's profile on their platform.
function profileUrl(source: string, username: string, profile?: Profile | null): string | null {
  const u = encodeURIComponent((profile?.login || username).replace(/^@/, ""));
  if (!u) return null;
  if (source === "twitch") return `https://www.twitch.tv/${u}`;
  if (source === "kick") return `https://kick.com/${u}`;
  if (source === "x") return `https://x.com/${u}`;
  return null;
}

// Hover-card avatar: the platform-provided one if we fetched a profile, else
// unavatar by platform handle so a face shows even before/without that fetch.
// Kick has no reliable public avatar endpoint → it falls back to the letter tile.
function avatarUrl(source: string, username: string, profile?: Profile | null): string | null {
  if (profile?.avatar) return profile.avatar;
  const u = (profile?.login || username || "").replace(/^@/, "");
  if (!u) return null;
  if (source === "twitch") return `https://unavatar.io/twitch/${encodeURIComponent(u)}`;
  if (source === "x") return `https://unavatar.io/x/${encodeURIComponent(u)}`;
  return null;
}

// Render chat text with @mentions highlighted like Twitch (a tinted pill).
const MENTION_RE = /(@[A-Za-z0-9_]{1,25})/g;
function withMentions(text: string): React.ReactNode {
  if (!text || text.indexOf("@") === -1) return text;
  return text.split(MENTION_RE).map((p, i) =>
    p && p[0] === "@" && /^@[A-Za-z0-9_]{1,25}$/.test(p) ? (
      <span key={i} className="cf-mention">{p}</span>
    ) : (
      <span key={i}>{p}</span>
    )
  );
}

function Badges({ badges, source }: { badges?: ChatBadge[] | null; source?: string }) {
  if (!badges || !badges.length) return null;
  return (
    <>
      {badges.map((b, i) =>
        b.img ? (
          // real platform art (Twitch badge CDN, Kick per-channel sub badges)
          <img key={i} className="cf-badge-img" src={b.img} alt={b.title} title={b.title} loading="lazy" />
        ) : source === "kick" && KICK_BADGES[b.type] ? (
          // Kick role badges ship no image — render the same art kick.com does
          <span key={i} className="cf-badge-svg" title={b.title}>
            {KICK_BADGES[b.type](b.title)}
          </span>
        ) : BADGE_LABELS[b.type] ? (
          <span key={i} className="cf-rolebadge" data-role={b.type} title={b.title}>
            {BADGE_LABELS[b.type]}
          </span>
        ) : null
      )}
    </>
  );
}

type SessionStat = { count: number; first: number };

export type Moderation = {
  canModerate: (m: ChatMessage) => boolean;
  onTimeout: (m: ChatMessage, minutes: number) => void;
  onBan: (m: ChatMessage) => void;
};

export function ChatFeed({
  messages,
  options,
  placeholder,
  profiles,
  onHoverUser,
  moderation,
}: {
  messages: ChatMessage[];
  options: OverlayOptions;
  placeholder?: React.ReactNode;
  profiles?: Record<string, Profile | null>;
  onHoverUser?: (source: string, username: string) => void;
  moderation?: Moderation;
}) {
  const feedRef = useRef<HTMLDivElement | null>(null);
  const atBottomRef = useRef(true);
  // When scrolled up, remember which message is at the top of the viewport and
  // its visual offset, so we can pin it back after the list trims/appends.
  const anchorRef = useRef<{ id: string; offset: number } | null>(null);
  const [paused, setPaused] = useState(false);

  const captureAnchor = () => {
    const el = feedRef.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    for (const r of Array.from(el.querySelectorAll<HTMLElement>(".cf-row"))) {
      const rect = r.getBoundingClientRect();
      if (rect.bottom > top) {
        anchorRef.current = { id: r.dataset.mid || "", offset: rect.top - top };
        return;
      }
    }
  };

  const onScroll = () => {
    const el = feedRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    atBottomRef.current = atBottom;
    if (atBottom) anchorRef.current = null;
    else captureAnchor();
    setPaused((p) => (p === !atBottom ? p : !atBottom));
  };

  const scrollToBottom = () => {
    const el = feedRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    atBottomRef.current = true;
    anchorRef.current = null;
    setPaused(false);
  };

  useLayoutEffect(() => {
    const el = feedRef.current;
    if (!el) return;
    if (atBottomRef.current) {
      // Pinned to the bottom — keep following new messages.
      el.scrollTop = el.scrollHeight;
    } else if (anchorRef.current) {
      // Scrolled up — re-pin the anchored message to its prior offset so trimming
      // old messages / appending new ones doesn't shift what you're reading.
      const row = el.querySelector<HTMLElement>(
        `.cf-row[data-mid="${CSS.escape(anchorRef.current.id)}"]`
      );
      if (row) {
        const cur = row.getBoundingClientRect().top - el.getBoundingClientRect().top;
        el.scrollTop += cur - anchorRef.current.offset;
      }
    }
  }, [messages]);

  // Per-chatter session stats (message count + first seen) from the buffer.
  // firstIds outlives the buffer: a chatter's FIRST message this session gets
  // the Twitch/Kick-style "first message" highlight, and stays the only one
  // even after the buffer evicts older rows.
  const lightTheme = useLightTheme();
  const firstIdsRef = useRef(new Map<string, string>());
  const stats = useMemo(() => {
    const m = new Map<string, SessionStat>();
    for (const msg of messages) {
      const k = `${msg.source}:${msg.username.toLowerCase()}`;
      if (!firstIdsRef.current.has(k)) firstIdsRef.current.set(k, msg.id);
      const e = m.get(k);
      if (e) e.count++;
      else m.set(k, { count: 1, first: msg.timestamp });
    }
    return m;
  }, [messages]);

  // Normally cap the rendered list to options.max. While the reader is scrolled
  // up (paused), render the full buffer so the message they're anchored to isn't
  // trimmed out from under them as new messages arrive.
  const shown = paused ? messages : messages.slice(-options.max);

  return (
    <div
      className="cf-root"
      data-bg={options.bg}
      data-size={options.size}
      data-skin={options.skin ?? "default"}
      data-shadow={options.shadow ? "1" : "0"}
      style={{ fontFamily: FONT_STACKS[options.font] }}
    >
      <div className="cf-feed" ref={feedRef} onScroll={onScroll}>
        {shown.length === 0 && placeholder ? (
          <div className="cf-empty">{placeholder}</div>
        ) : (
          shown.map((m) => {
            const key = `${m.source}:${m.username.toLowerCase()}`;
            return (
              <Row
                key={m.id}
                m={m}
                badge={options.badge}
                channel={m.channel || (m.source === "x" ? m.username : SOURCE_LABELS[m.source])}
                nameColor={clampForTheme(nameColorFor(m, options.nameColor), lightTheme)}
                accountColor={options.accountColor}
                timestamps={options.timestamps}
                profile={profiles?.[key]}
                stat={stats.get(key)}
                first={firstIdsRef.current.get(key) === m.id}
                onHoverUser={onHoverUser}
                moderation={moderation}
              />
            );
          })
        )}
      </div>
      {paused && (
        <button className="cf-jump" onClick={scrollToBottom}>
          ↓ New messages
        </button>
      )}
    </div>
  );
}

function Row({
  m,
  badge,
  channel,
  nameColor,
  accountColor,
  timestamps,
  profile,
  stat,
  first,
  onHoverUser,
  moderation,
}: {
  m: ChatMessage;
  badge: OverlayOptions["badge"];
  channel: string;
  nameColor: string;
  accountColor: OverlayOptions["accountColor"];
  timestamps: boolean;
  profile?: Profile | null;
  stat?: SessionStat;
  /** the chatter's first message this session — highlighted like Twitch/Kick */
  first?: boolean;
  onHoverUser?: (source: string, username: string) => void;
  moderation?: Moderation;
}) {
  const displayName = profile?.displayName || m.username;
  const since = profile?.createdAt ? new Date(profile.createdAt).getFullYear() : null;
  const url = profileUrl(m.source, m.username, profile);
  const avatar = avatarUrl(m.source, m.username, profile);

  return (
    <div
      className={`cf-row${first ? " cf-first" : ""}`}
      data-mid={m.id}
      style={first ? ({ ["--src" as any]: m.color } as React.CSSProperties) : undefined}
    >
      {first && <span className="cf-first-tag">First message</span>}
      {badge === "face" ? (
        <span className="cf-badge cf-badge-face" data-source={m.source} style={{ ["--src" as any]: m.color }}>
          <SourceLogo source={m.source} size={10} />
          {faceUrl(m.source, m.channel, m.username) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="cf-face"
              src={faceUrl(m.source, m.channel, m.username)!}
              alt=""
              loading="lazy"
              onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
            />
          )}
          <span className="cf-face-mini" data-source={m.source}>
            <SourceLogo source={m.source} size={7} />
          </span>
        </span>
      ) : badge === "none" ? null : badge !== "dot" && badge !== "text" ? (
        <>
          <span
            className="cf-badge"
            data-style={badge === "logoplain" ? "logo" : badge}
            data-source={m.source}
            style={{ ["--src" as any]: m.color }}
          >
            <SourceLogo source={m.source} size={14} />
            {badge === "full" && (
              <span
                className="cf-badge-label"
                style={accountColor === "white" ? { color: "var(--text)" } : undefined}
              >
                {SOURCE_LABELS[m.source]}
              </span>
            )}
            {badge === "channel" && (
              <span
                className="cf-badge-label"
                style={accountColor === "white" ? { color: "var(--text)" } : undefined}
              >
                {channel || SOURCE_LABELS[m.source]}
              </span>
            )}
          </span>
          {badge === "logoplain" && (
            <span
              className="cf-badge-plain"
              style={{
                ["--src" as any]: m.color,
                ...(accountColor === "white" ? { color: "var(--text)" } : {}),
              }}
            >
              {channel || SOURCE_LABELS[m.source]}
            </span>
          )}
        </>
      ) : badge === "text" ? (
        <span
          className="cf-badge cf-badge-textonly"
          data-source={m.source}
          style={{ ["--src" as any]: m.color }}
        >
          {SOURCE_LABELS[m.source]}
        </span>
      ) : (
        <span className="cf-dot" style={{ background: m.color }} />
      )}

      <span className="cf-body">
        {timestamps && <span className="cf-time">{fmtTime(m.timestamp)}</span>}
        <Badges badges={m.badges} source={m.source} />
        <span
          className="cf-userwrap"
          onMouseEnter={() => onHoverUser?.(m.source, m.username)}
        >
          <span className="cf-user" style={{ color: nameColor }}>
            {m.username}
          </span>
          <span className="cf-card" data-source={m.source} style={{ ["--src" as any]: m.color }}>
            <a
              className="cf-card-head"
              href={url ?? undefined}
              target="_blank"
              rel="noreferrer"
              title={url ? `Open ${displayName} on ${SOURCE_LABELS[m.source]} ↗` : undefined}
            >
              <span className="cf-card-avatar cf-card-avatar-fallback" style={{ background: m.color }}>
                {m.username.charAt(0).toUpperCase()}
                {avatar && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    className="cf-card-avatar-img"
                    src={avatar}
                    alt=""
                    loading="lazy"
                    onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
                  />
                )}
              </span>
              <span className="cf-card-id">
                <span className="cf-card-name">{displayName}</span>
                <span className="cf-card-handle">
                  @{m.username} · on {SOURCE_LABELS[m.source]}
                </span>
              </span>
              <SourceLogo source={m.source} size={16} />
            </a>

            {m.badges && m.badges.length > 0 && (
              <span className="cf-card-badges">
                <Badges badges={m.badges} source={m.source} />
              </span>
            )}

            <span className="cf-card-stats">
              <span className="cf-card-stat">
                <b>{stat?.count ?? 1}</b>
                <span>msg{(stat?.count ?? 1) === 1 ? "" : "s"} this session</span>
              </span>
              {since && (
                <span className="cf-card-stat">
                  <b>{since}</b>
                  <span>on {SOURCE_LABELS[m.source]} since</span>
                </span>
              )}
              {stat && (
                <span className="cf-card-stat">
                  <b>{fmtTime(stat.first)}</b>
                  <span>first seen</span>
                </span>
              )}
            </span>

            {/* Market Bubble member layer — their standing on the show, like a
                social-platform profile. Only renders once they've earned/set
                something (fresh chatters keep the plain platform card). */}
            {profile?.member && (
              <span className="cf-card-member">
                {profile.member.points != null && (
                  <span className="cf-card-mb-row">
                    <span className="cf-card-mb-rank">#{profile.member.rank}</span>
                    <span className="cf-card-mb-pts">{profile.member.points.toLocaleString("en-US")} ◆</span>
                    <span className="cf-card-mb-label">on The Floor</span>
                    {(profile.member.days ?? 0) > 1 && (
                      <span className="cf-card-mb-days">{profile.member.days} shows</span>
                    )}
                  </span>
                )}
                {profile.member.clips && (
                  <span className="cf-card-mb-clips">
                    {profile.member.clips.approved} clip{profile.member.clips.approved === 1 ? "" : "s"} ·{" "}
                    {profile.member.clips.views.toLocaleString("en-US")} views
                    {profile.member.clips.featured > 0 && <b> · ★ featured on the show</b>}
                  </span>
                )}
                {profile.member.socials && (
                  <span className="cf-card-socials">
                    {Object.entries(profile.member.socials).map(([net, v]) =>
                      v?.url ? (
                        <a key={net} className="cf-card-social" href={v.url} target="_blank" rel="noreferrer noopener">
                          {net === "x" ? "𝕏" : net === "website" ? "site" : net}
                          {v.handle ? ` @${v.handle}` : ""}
                        </a>
                      ) : v?.handle ? (
                        <span key={net} className="cf-card-social" title={`${net}: ${v.handle}`}>
                          {net} {v.handle}
                        </span>
                      ) : null
                    )}
                  </span>
                )}
              </span>
            )}
            {channel && channel !== SOURCE_LABELS[m.source] && (
              <span className="cf-card-foot">chatting in {channel}</span>
            )}

            {moderation?.canModerate(m) && (
              <span className="cf-card-mod">
                <button type="button" onClick={() => moderation.onTimeout(m, 10)} title="Timeout 10 minutes">
                  10m
                </button>
                <button type="button" onClick={() => moderation.onTimeout(m, 60)} title="Timeout 1 hour">
                  1h
                </button>
                <button
                  type="button"
                  className="cf-card-mod-ban"
                  onClick={() => moderation.onBan(m)}
                  title={`Ban @${m.username} from #${channel}`}
                >
                  Ban
                </button>
              </span>
            )}
          </span>
        </span>{" "}
        <span className="cf-text">
          {m.fragments && m.fragments.length
            ? m.fragments.map((f, i) =>
                f.type === "emote" ? (
                  <img
                    key={i}
                    className="cf-emote"
                    src={f.url}
                    alt={f.name}
                    title={f.name}
                    loading="lazy"
                  />
                ) : (
                  <span key={i}>{withMentions(f.text)}</span>
                )
              )
            : withMentions(m.text)}
        </span>
      </span>
    </div>
  );
}
