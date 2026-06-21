"use client";

import type { Poll } from "../lib/useHub";

// The live "chat vs the market" panel: the featured Polymarket market with the
// room's YES/NO vote split shown right next to Polymarket's real odds. Chat
// votes by typing YES / NO (counted across Twitch + Kick + X).
export function PredictionCard({ poll }: { poll: Poll | null }) {
  if (!poll) return null;
  const roomYes = poll.total ? Math.round((poll.yes / poll.total) * 100) : null;
  const mktYes = poll.oddsYes != null ? Math.round(poll.oddsYes * 100) : null;
  // who's higher on YES — a fun "the room disagrees with the market" tell
  const gap = roomYes != null && mktYes != null ? roomYes - mktYes : null;

  return (
    <section className="rp rp-poll">
      <div className="rp-head">
        <span className="rp-title">Prediction</span>
        <span className="panel-meta poll-meta">
          {poll.open ? (
            <>
              type <b>YES</b> / <b>NO</b> in chat
            </>
          ) : (
            "voting closed"
          )}
        </span>
      </div>
      <div className="rp-body poll-body">
        <p className="poll-q">{poll.question}</p>

        <div className="poll-bars">
          <div className="poll-bar-row">
            <span className="poll-bar-label">The Room</span>
            <span className="poll-bar">
              <span className="poll-bar-fill room" style={{ width: `${roomYes ?? 0}%` }} />
            </span>
            <span className="poll-bar-val">{roomYes != null ? `${roomYes}% YES` : "—"}</span>
          </div>
          <div className="poll-bar-row">
            <span className="poll-bar-label">Polymarket</span>
            <span className="poll-bar">
              <span className="poll-bar-fill market" style={{ width: `${mktYes ?? 0}%` }} />
            </span>
            <span className="poll-bar-val">{mktYes != null ? `${mktYes}% YES` : "—"}</span>
          </div>
        </div>

        <div className="poll-foot">
          <span className="poll-votes">
            {poll.total.toLocaleString()} vote{poll.total === 1 ? "" : "s"}
            {gap != null && Math.abs(gap) >= 8 && (
              <span className="poll-gap"> · room {gap > 0 ? "more" : "less"} bullish by {Math.abs(gap)}pts</span>
            )}
          </span>
          {poll.url && (
            <a className="poll-link" href={poll.url} target="_blank" rel="noreferrer">
              on Polymarket ↗
            </a>
          )}
        </div>
      </div>
    </section>
  );
}
