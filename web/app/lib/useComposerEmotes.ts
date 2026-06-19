"use client";

import { useMemo } from "react";
import { useEmotes, type EmoteMap } from "./useEmotes";
import { useUserEmotes, type EmoteSection, type UserEmoteStatus } from "./useUserEmotes";
import type { TwitchAuth } from "./twitchAuth";

// Assembles what the composer needs:
//  - `sections`: the Twitch-picker layout — the viewer's OWN channels (when
//    logged in with the emote scope) plus a 7TV/BTTV/FFZ section on the side,
//    like the 7TV browser extension adds to Twitch.
//  - `map`: a flat name→url lookup for type-to-autocomplete + feed safety.
// Falls back to the show channels' public sets when the viewer isn't logged in.
export function useComposerEmotes(
  hubHttpUrl: string | undefined,
  auth: TwitchAuth | null,
  clientId: string
): { sections: EmoteSection[]; map: EmoteMap; status: UserEmoteStatus } {
  const channel = useEmotes(hubHttpUrl); // /emotes → { name: { url, provider } }
  const user = useUserEmotes(auth, clientId);

  return useMemo(() => {
    // 7TV / BTTV / FFZ — always the show channels' sets, shown on the side.
    const tp: { name: string; url: string }[] = [];
    const tpMap: EmoteMap = {};
    for (const [name, e] of Object.entries(channel)) {
      if (e.provider !== "twitch") {
        tp.push({ name, url: e.url });
        tpMap[name] = e;
      }
    }
    const sevenSection: EmoteSection | null = tp.length
      ? { id: "7tv", label: "7TV · BTTV · FFZ", emotes: tp }
      : null;

    // Logged in with the scope → the viewer's real entitlement set.
    if (user.status === "ok" && user.sections.length) {
      const sections = sevenSection ? [...user.sections, sevenSection] : user.sections;
      const map: EmoteMap = { ...tpMap, ...user.map };
      return { sections, map, status: user.status };
    }

    // Fallback: the show channels' public Twitch set + the third-party sets.
    const tw: { name: string; url: string }[] = [];
    const map: EmoteMap = {};
    for (const [name, e] of Object.entries(channel)) {
      map[name] = e;
      if (e.provider === "twitch") tw.push({ name, url: e.url });
    }
    const sections: EmoteSection[] = [];
    if (tw.length) sections.push({ id: "twitch", label: "Twitch", emotes: tw });
    if (sevenSection) sections.push(sevenSection);
    return { sections, map, status: user.status };
  }, [channel, user.sections, user.map, user.status]);
}
