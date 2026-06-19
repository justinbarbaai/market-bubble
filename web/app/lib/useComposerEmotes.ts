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
    // Bucket the show channels' sets by provider: Kick, third-party (7TV/BTTV/
    // FFZ), and Twitch (only used for the logged-out fallback).
    const kick: { name: string; url: string }[] = [];
    const tp: { name: string; url: string }[] = [];
    const tw: { name: string; url: string }[] = [];
    const channelMap: EmoteMap = {};
    const sideMap: EmoteMap = {};
    for (const [name, e] of Object.entries(channel)) {
      channelMap[name] = e;
      if (e.provider === "kick") {
        kick.push({ name, url: e.url });
        sideMap[name] = e;
      } else if (e.provider === "twitch") {
        tw.push({ name, url: e.url });
      } else {
        tp.push({ name, url: e.url });
        sideMap[name] = e;
      }
    }
    // Side sections shown after the Twitch channels (Kick, then 7TV).
    const sideSections: EmoteSection[] = [];
    if (kick.length) sideSections.push({ id: "kick", label: "Kick", emotes: kick });
    if (tp.length) sideSections.push({ id: "7tv", label: "7TV · BTTV · FFZ", emotes: tp });

    // Logged in with the scope → the viewer's real entitlement set + the sides.
    if (user.status === "ok" && user.sections.length) {
      return {
        sections: [...user.sections, ...sideSections],
        map: { ...sideMap, ...user.map },
        status: user.status,
      };
    }

    // Fallback: the show channels' public Twitch set + Kick + third-party.
    const sections: EmoteSection[] = [];
    if (tw.length) sections.push({ id: "twitch", label: "Twitch", emotes: tw });
    sections.push(...sideSections);
    return { sections, map: channelMap, status: user.status };
  }, [channel, user.sections, user.map, user.status]);
}
