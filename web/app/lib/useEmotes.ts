"use client";

import { useEffect, useState } from "react";

export type EmoteEntry = { url: string; provider: string };
export type EmoteMap = Record<string, EmoteEntry>;

// Pulls the composer's typeable emote set (Twitch + 7TV/BTTV/FFZ, global +
// channel) from the hub once and keeps it in memory. The hub already renders
// these in incoming chat; this is purely so the viewer can find + insert them.
export function useEmotes(hubHttpUrl?: string): EmoteMap {
  const [map, setMap] = useState<EmoteMap>({});
  useEffect(() => {
    if (!hubHttpUrl) return;
    let alive = true;
    fetch(`${hubHttpUrl}/emotes`)
      .then((r) => r.json())
      .then((d) => {
        if (alive && d?.emotes) setMap(d.emotes);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [hubHttpUrl]);
  return map;
}
