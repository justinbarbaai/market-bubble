"use client";

import { useEffect, useState } from "react";
import type { TwitchAuth } from "./twitchAuth";
import type { EmoteMap } from "./useEmotes";

// A picker section = one channel (or "Global") with its emotes + a tab icon.
export type EmoteSection = {
  id: string;
  label: string;
  icon?: string;
  emotes: { name: string; url: string }[];
};

export type UserEmoteStatus = "idle" | "loading" | "ok" | "noscope" | "error";

const HELIX = "https://api.twitch.tv/helix";
const DEFAULT_TEMPLATE =
  "https://static-cdn.jtvnw.net/emoticons/v2/{{id}}/{{format}}/{{theme_mode}}/{{scale}}";

function buildUrl(template: string, id: string, animated: boolean): string {
  const fmt = animated ? "animated" : "static";
  return template
    .replace(/\{\{?\s*id\s*\}?\}/g, id)
    .replace(/\{\{?\s*format\s*\}?\}/g, fmt)
    .replace(/\{\{?\s*theme_mode\s*\}?\}/g, "dark")
    .replace(/\{\{?\s*scale\s*\}?\}/g, "2.0");
}

// Pulls the logged-in viewer's FULL emote entitlement from Twitch (every channel
// they're subscribed to, follower emotes, bits, and globals) via Get User Emotes
// — exactly the set Twitch's own picker shows. Runs client-side with the user's
// token (Helix supports CORS). Needs the `user:read:emotes` scope; a token minted
// before that scope was added returns 401 → status "noscope" (prompt a re-login).
export function useUserEmotes(auth: TwitchAuth | null, clientId: string) {
  const [sections, setSections] = useState<EmoteSection[]>([]);
  const [map, setMap] = useState<EmoteMap>({});
  const [status, setStatus] = useState<UserEmoteStatus>("idle");

  useEffect(() => {
    if (!auth?.token || !auth.userId || !clientId) {
      setStatus("idle");
      setSections([]);
      setMap({});
      return;
    }
    let alive = true;
    (async () => {
      setStatus("loading");
      const headers = { "Client-Id": clientId, Authorization: `Bearer ${auth.token}` };
      const all: any[] = [];
      let template = DEFAULT_TEMPLATE;
      let cursor = "";
      try {
        for (let page = 0; page < 12; page++) {
          const u =
            `${HELIX}/chat/emotes/user?user_id=${encodeURIComponent(auth.userId)}&first=100` +
            (cursor ? `&after=${encodeURIComponent(cursor)}` : "");
          const r = await fetch(u, { headers });
          if (r.status === 401 || r.status === 403) {
            if (alive) setStatus("noscope");
            return;
          }
          if (!r.ok) throw new Error(String(r.status));
          const j = await r.json();
          if (j.template) template = j.template;
          all.push(...(j.data || []));
          cursor = j.pagination?.cursor || "";
          if (!cursor) break;
        }
      } catch {
        if (alive) setStatus("error");
        return;
      }

      // Group by owning channel; globals (Twitch-owned) get their own section.
      const byOwner = new Map<string, any[]>();
      for (const e of all) {
        const key =
          e.emote_type === "globals" || !e.owner_id || e.owner_id === "0"
            ? "__global__"
            : String(e.owner_id);
        if (!byOwner.has(key)) byOwner.set(key, []);
        byOwner.get(key)!.push(e);
      }

      // Resolve channel display names + avatars for the tab strip (batch of 100).
      const ownerIds = [...byOwner.keys()].filter((k) => k !== "__global__");
      const ownerInfo = new Map<string, { name: string; icon?: string }>();
      for (let i = 0; i < ownerIds.length; i += 100) {
        const qs = ownerIds.slice(i, i + 100).map((id) => `id=${id}`).join("&");
        try {
          const r = await fetch(`${HELIX}/users?${qs}`, { headers });
          if (r.ok) {
            const j = await r.json();
            for (const u of j.data || [])
              ownerInfo.set(u.id, { name: u.display_name, icon: u.profile_image_url });
          }
        } catch {}
      }

      const flat: EmoteMap = {};
      const mk = (list: any[]) =>
        list.map((e) => {
          const animated = Array.isArray(e.format) && e.format.includes("animated");
          const url = buildUrl(template, e.id, animated);
          flat[e.name] = { url, provider: "twitch" };
          return { name: e.name, url };
        });

      const secs: EmoteSection[] = [];
      // Subscribed/followed channels first (Twitch order), globals last.
      for (const id of ownerIds) {
        const info = ownerInfo.get(id);
        secs.push({ id, label: info?.name || "Channel", icon: info?.icon, emotes: mk(byOwner.get(id)!) });
      }
      if (byOwner.has("__global__"))
        secs.push({ id: "global", label: "Global Twitch", emotes: mk(byOwner.get("__global__")!) });

      if (!alive) return;
      setSections(secs);
      setMap(flat);
      setStatus("ok");
    })();
    return () => {
      alive = false;
    };
  }, [auth?.token, auth?.userId, clientId]);

  return { sections, map, status };
}
