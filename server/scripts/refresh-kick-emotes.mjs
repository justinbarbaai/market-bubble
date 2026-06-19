// Refresh the bundled Kick emote snapshot (server/sources/kickEmotesStatic.js).
//
// Kick fronts its emote API with Cloudflare, which 403s the Render hub's
// datacenter IP and blocks browser CORS — only a plain residential request gets
// through. So the snapshot has to be captured from a normal connection here.
//
// Usage (from server/):  node --env-file=.env scripts/refresh-kick-emotes.mjs
import fs from "node:fs";
import { kickGet } from "../sources/kickContent.js";

const CHANNELS = (process.env.KICK_CHANNEL || "ansem")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const out = {};
for (const ch of CHANNELS) {
  try {
    const sets = await kickGet(`https://kick.com/emotes/${ch}`);
    if (Array.isArray(sets))
      for (const set of sets) {
        if (set?.name === "Emoji" || set?.id === "Emoji") continue;
        for (const e of set?.emotes || [])
          if (e?.name && e?.id != null) out[e.name] = `https://files.kick.com/emotes/${e.id}/fullsize`;
      }
  } catch (err) {
    console.error("fetch fail", ch, String(err));
  }
}

const body =
  "// Static snapshot of Kick channel emotes (Global + show channels). Kick fronts\n" +
  "// its emote API with Cloudflare, which blocks the Render hub (datacenter IP) and\n" +
  "// browser CORS — only a residential GET works — so we bundle a captured snapshot.\n" +
  "// Refresh with: node --env-file=.env scripts/refresh-kick-emotes.mjs (run locally).\n" +
  "export const KICK_EMOTES = " +
  JSON.stringify(out, null, 2) +
  ";\n";
fs.writeFileSync(new URL("../sources/kickEmotesStatic.js", import.meta.url), body);
console.log("wrote", Object.keys(out).length, "kick emotes to sources/kickEmotesStatic.js");
