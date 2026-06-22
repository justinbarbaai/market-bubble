"use client";

import type { Floor } from "../lib/useHub";
import { SourceLogo } from "./logos";

// "The Floor" — the live engagement leaderboard, in the Market Bubble newspaper
// voice. Everyone earns "Bubbles" just by taking part in the show — chatting and
// voting in the prediction — on WHATEVER platform they watch from (Twitch / Kick
// / X). One ranking across all three; the native platforms can't do that. The
// top of the room rises here in real time.
const fmt = (n: number) => n.toLocaleString("en-US");

export function TheFloor({ floor }: { floor: Floor | null }) {
  const top = floor?.top ?? [];

  return (
    <section className="rp rp-floor">
      <div className="rp-head">
        <span className="rp-title">The Floor</span>
        <span className="panel-meta">
          {floor && floor.bubbles > 0 ? (
            <>
              <b>{fmt(floor.bubbles)}</b> Bubbles · {fmt(floor.users)} earning
            </>
          ) : (
            "earn Bubbles by taking part"
          )}
        </span>
      </div>

      <div className="rp-body floor-body">
        {top.length === 0 ? (
          <p className="floor-empty">
            Chat to climb. Every message and prediction vote earns <b>Bubbles</b> —
            across Twitch, Kick &amp; X.
          </p>
        ) : (
          <ol className="floor-list">
            {top.map((e) => (
              <li
                key={`${e.source}:${e.name}`}
                className={`floor-row${e.rank <= 3 ? " top" : ""}`}
                data-rank={e.rank}
              >
                <span className="floor-rank">{String(e.rank).padStart(2, "0")}</span>
                <span className="floor-src" data-source={e.source} title={e.source}>
                  <SourceLogo source={e.source} size={12} />
                </span>
                <span className="floor-name">{e.name}</span>
                <span className="floor-pts">
                  {fmt(e.points)}
                  <span className="floor-pts-unit">◆</span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
