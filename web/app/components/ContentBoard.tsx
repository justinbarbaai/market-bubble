"use client";

import { useEffect, useState } from "react";
import { SourceLogo } from "./logos";
import { HostSocials } from "./HostSocialCard";
import { usePlayer } from "../lib/player";
import { TweetPreview } from "./TweetCard";
import { ScrollFX } from "./ScrollFX";
import type { Media } from "../lib/media";
import { MBMark } from "./brand";
import { useHub } from "../lib/useHub";
import { TWEETS, CLIPS, STREAMS, HOSTS, X_PROFILE, type Tweet, type Clip, type Stream } from "../lib/showContent";

// A thumbnail frame: renders the real image when a URL is provided, otherwise a
// branded video-frame placeholder (so every card reads as media either way).
function Thumb({
  src,
  ratio = "16 / 9",
  duration,
  source,
}: {
  src?: string;
  ratio?: string;
  duration?: string;
  source?: "twitch" | "kick";
}) {
  return (
    <span className="cnt-thumb" style={{ aspectRatio: ratio }}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="cnt-thumb-img" src={src} alt="" loading="lazy" />
      ) : (
        <span className="cnt-thumb-ph" aria-hidden="true">
          <MBMark size={28} />
        </span>
      )}
      {source && (
        <span className={`cnt-thumb-src cnt-thumb-src-${source}`} aria-hidden="true">
          <SourceLogo source={source} size={12} />
        </span>
      )}
      <span className="cnt-thumb-play" aria-hidden="true">
        ▶
      </span>
      {duration && <span className="cnt-thumb-dur">{duration}</span>}
    </span>
  );
}

function Section({ title, count }: { title: string; count?: string }) {
  return (
    <div className="cnt-section">
      <span className="cnt-section-kicker">{title}</span>
      <span className="cnt-section-rule" />
      {count && <span className="cnt-section-count">{count}</span>}
    </div>
  );
}

// The /content "Dispatch" — an editorial layout: masthead, a lead story, then
// sectioned Clips / On X / Broadcasts.
const FAN_PLATFORM: Record<string, string> = {
  tiktok: "TikTok", youtube: "YouTube", x: "X", instagram: "Reels", twitch: "Twitch", kick: "Kick",
};

// Build a platform embed URL from a clip link so fan clips PLAY inline on the
// Content page. Returns null for platforms with no clean iframe (X / Kick) — those
// fall back to a click-out card.
function fanEmbedSrc(platform: string, url: string, host: string): string | null {
  try {
    if (platform === "youtube") {
      const u = new URL(url);
      let id = u.searchParams.get("v");
      if (!id && u.hostname.includes("youtu.be")) id = u.pathname.slice(1);
      if (!id) { const m = u.pathname.match(/\/(shorts|embed)\/([^/?#]+)/); if (m) id = m[2]; }
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
    if (platform === "tiktok") { const m = url.match(/\/video\/(\d+)/); return m ? `https://www.tiktok.com/embed/v2/${m[1]}` : null; }
    if (platform === "instagram") { const m = url.match(/\/(reel|p|tv)\/([^/?#]+)/); return m ? `https://www.instagram.com/${m[1]}/${m[2]}/embed` : null; }
    if (platform === "twitch") {
      const m = url.match(/clips\.twitch\.tv\/([^/?#]+)/) || url.match(/twitch\.tv\/[^/]+\/clip\/([^/?#]+)/);
      return m && host ? `https://clips.twitch.tv/embed?clip=${m[1]}&parent=${host}&autoplay=false` : null;
    }
    return null;
  } catch { return null; }
}

type FanClip = { id: string; url: string; platform: string; by: string; featured: boolean; views: number; bubbles: number };

function FanClipEmbed({ clip, host }: { clip: FanClip; host: string }) {
  const src = fanEmbedSrc(clip.platform, clip.url, host);
  const vertical = clip.platform === "tiktok" || clip.platform === "instagram";
  const caption = (
    <div className="fanclip-cap">
      <span className={`clip-badge plat-${clip.platform}`}>{FAN_PLATFORM[clip.platform] ?? clip.platform}</span>
      <span className="fanclip-by">@{clip.by}</span>
      {clip.featured && <span className="clip-feat">★</span>}
      <span className="fanclip-bubbles">{clip.bubbles.toLocaleString()} ◆</span>
    </div>
  );
  if (!src) {
    // X / Kick (or unparseable) → click-out card
    return (
      <li className="fanclip fanclip-card">
        <a className="clip-card-link" href={clip.url} target="_blank" rel="noreferrer">
          <div className="clip-card-top">
            <span className={`clip-badge plat-${clip.platform}`}>{FAN_PLATFORM[clip.platform] ?? clip.platform}</span>
            {clip.featured && <span className="clip-feat">★ Featured</span>}
          </div>
          <div className="clip-card-body">
            <span className="clip-card-by">@{clip.by}</span>
            <div className="clip-card-stats">
              {clip.views > 0 && <span className="clip-card-views">{clip.views.toLocaleString()} views</span>}
              <span className="clip-card-bubbles">{clip.bubbles.toLocaleString()} ◆</span>
            </div>
          </div>
          <span className="clip-card-go">watch ↗</span>
        </a>
      </li>
    );
  }
  return (
    <li className={`fanclip${vertical ? " vertical" : ""}${clip.featured ? " featured" : ""}`}>
      <div className="fanclip-frame">
        <iframe
          src={src}
          title={`Clip by @${clip.by}`}
          loading="lazy"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          frameBorder="0"
          scrolling="no"
        />
      </div>
      {caption}
    </li>
  );
}

export function ContentBoard() {
  const { hubHttpUrl, clips: fanClipsState } = useHub();
  const { play } = usePlayer();
  // Click a clip/VOD → play it on-site (modal). Falls back to the link (cmd-click).
  const open = (m: Media) => (e: React.MouseEvent) => {
    if (m.url) {
      e.preventDefault();
      play(m);
    }
  };
  // Host for Twitch clip embeds (needs the page's domain as `parent`).
  const [host, setHost] = useState("");
  useEffect(() => { setHost(window.location.hostname); }, []);
  // Live clips + VODs from the hub (Twitch Helix); fall back to curated data.
  const [live, setLive] = useState<{ clips?: Clip[]; streams?: Stream[]; tweets?: Tweet[] } | null>(null);
  useEffect(() => {
    if (!hubHttpUrl) return;
    let alive = true;
    const load = () =>
      fetch(`${hubHttpUrl}/content`)
        .then((r) => r.json())
        .then((d) => alive && setLive(d))
        .catch(() => {});
    load();
    const t = setInterval(load, 120000); // refresh every 2 min
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [hubHttpUrl]);

  const allClips = live?.clips?.length ? live.clips : CLIPS;
  const allStreams = live?.streams?.length ? live.streams : STREAMS;
  const allTweets = live?.tweets?.length ? live.tweets : TWEETS;
  const lead = allClips[0];
  const clips = allClips.slice(1);
  // Fan clips from Clip-to-Earn: the top of The Wall, featured ones first, played
  // inline. (allFan arrives already ranked by views from the hub.) YouTube is left
  // out — the show's clippers post short-form (TikTok / Reels / X), not YouTube.
  const allFan = (fanClipsState?.clips ?? []).filter((c) => c.platform !== "youtube");
  const fanClips = [...allFan].sort((a, b) => Number(b.featured) - Number(a.featured)).slice(0, 6);

  return (
    <div className="cnt-mag">
      <ScrollFX />
      {/* masthead */}
      <div className="cnt-masthead">
        <span className="cnt-mast-kicker">The Bubble Dispatch</span>
        <a className="cnt-mast-x" href={X_PROFILE} target="_blank" rel="noreferrer">
          <SourceLogo source="x" size={12} /> @MarketBubble ↗
        </a>
      </div>

      {/* hosts */}
      <div className="cnt-hosts">
        {HOSTS.map((h) => (
          <div key={h.handle} className="cnt-host" tabIndex={0}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="cnt-host-av" src={h.avatar} alt={h.name} loading="lazy" />
            <span className="cnt-host-id">
              <span className="cnt-host-name">{h.name}</span>
              <span className="cnt-host-handle">@{h.handle}</span>
            </span>
            <span className="cnt-host-role">{h.role}</span>
            <HostSocials host={h} className="cnt-host-socials" />
          </div>
        ))}
      </div>

      {/* lead story */}
      {lead && (
        <a
          className="cnt-lead"
          href={lead.url || X_PROFILE}
          target="_blank"
          rel="noreferrer"
          onClick={open({ kind: "clip", title: lead.title, url: lead.url, source: lead.source, thumb: lead.thumb, date: lead.date })}
        >
          <Thumb src={lead.thumb} ratio="16 / 9" source={lead.source} />
          <div className="cnt-lead-body">
            <span className="cnt-lead-kicker">Latest clip</span>
            <h2 className="cnt-lead-title">{lead.title}</h2>
            <span className="cnt-lead-meta">{lead.date} · Watch ▶</span>
          </div>
        </a>
      )}

      {/* clips */}
      <Section title="Clips" count={`${allClips.length} media`} />
      <div className="cnt-strip">
        {clips.map((c, i) => (
          <a
            key={i}
            className="cnt-strip-card"
            data-rv={(i % 6) + 1}
            href={c.url || "#"}
            target="_blank"
            rel="noreferrer"
            onClick={open({ kind: "clip", title: c.title, url: c.url, source: c.source, thumb: c.thumb, date: c.date, duration: c.duration })}
          >
            <Thumb src={c.thumb} ratio="16 / 9" duration={c.duration} source={c.source} />
            <span className="cnt-strip-title">{c.title}</span>
            <span className="cnt-strip-date">{c.date}</span>
          </a>
        ))}
      </div>

      {/* fan clips — Clip-to-Earn (links out to the original posts) */}
      {fanClips.length > 0 && (
        <>
          <Section title="Fan Clips" count="from the floor ↗ /clips" />
          <ul className="fanclip-grid">
            {fanClips.map((c) => (
              <FanClipEmbed key={c.id} clip={c} host={host} />
            ))}
          </ul>
        </>
      )}

      {/* on X */}
      <Section title="On X" count={`${allTweets.length} posts`} />
      <div className="cnt-x-grid">
        {allTweets.map((t, i) => {
          const tweet = {
            handle: t.handle,
            name: t.name,
            avatar: t.avatar,
            verified: t.verified,
            text: t.text,
            video: t.video,
            thumb: t.thumb,
            date: t.date,
            likes: t.likes,
            replies: t.replies,
          };
          return (
            <div key={i} data-rv={(i % 6) + 1}>
              <TweetPreview
                tweet={tweet}
                onOpen={() =>
                  play({ kind: "clip", source: "x", title: t.text, url: t.url || X_PROFILE, thumb: t.thumb, tweet })
                }
              />
            </div>
          );
        })}
      </div>

      {/* broadcasts */}
      <Section title="Recent Broadcasts" count="Twitch" />
      <div className="cnt-strip cnt-strip-streams">
        {allStreams.map((s, i) => (
          <a
            key={i}
            className="cnt-strip-card"
            data-rv={(i % 6) + 1}
            href={s.url || "#"}
            target="_blank"
            rel="noreferrer"
            onClick={open({ kind: "vod", title: s.title, url: s.url, source: s.source, thumb: s.thumb, date: s.date, duration: s.duration, views: s.views })}
          >
            <Thumb src={s.thumb} ratio="16 / 9" duration={s.duration} source={s.source} />
            <span className="cnt-strip-title">{s.title}</span>
            <span className="cnt-strip-date">
              {s.date} · {s.views} views
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}
