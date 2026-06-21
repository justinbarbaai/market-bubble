"use client";

import type { Poll } from "../lib/useHub";

// The live "chat vs the market" panel, in the Market Bubble newspaper voice.
// The Room is a green-YES / red-NO tug-of-war bar (so a NO vote visibly grows
// the red side), and Polymarket's real odds sit on the same scale as an ink
// marker — so you read the room-vs-market gap at a glance. Chat votes by typing
// YES / NO (counted across Twitch + Kick + X).
export function PredictionCard({ poll }: { poll: Poll | null }) {
  if (!poll) return null;
  const total = poll.total;
  const roomYes = total ? Math.round((poll.yes / total) * 100) : 0;
  const roomNo = total ? 100 - roomYes : 0;
  const mktYes = poll.oddsYes != null ? Math.round(poll.oddsYes * 100) : null;
  const gap = mktYes != null && total ? roomYes - mktYes : null;

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

        <div className="poll-tug">
          <div className="poll-tug-head">
            <span className="poll-tug-side yes">
              <b>{roomYes}%</b> YES
            </span>
            <span className="poll-tug-room">The Room</span>
            <span className="poll-tug-side no">
              NO <b>{roomNo}%</b>
            </span>
          </div>
          <div className="poll-tug-wrap">
            <div className="poll-tug-bar">
              <span className="poll-tug-yes" style={{ width: `${roomYes}%` }} />
              <span className="poll-tug-no" style={{ width: `${roomNo}%` }} />
            </div>
            {mktYes != null && (
              <span className="poll-mkt" style={{ left: `${mktYes}%` }} title={`Polymarket: ${mktYes}% YES`}>
                <span className="poll-mkt-tick" />
                <span className="poll-mkt-flag">Polymarket {mktYes}%</span>
              </span>
            )}
          </div>
        </div>

        <div className="poll-foot">
          <span className="poll-votes">
            {total.toLocaleString()} vote{total === 1 ? "" : "s"}
            {gap != null && Math.abs(gap) >= 6 && (
              <span className="poll-gap">
                {" "}
                · room <b>{gap > 0 ? "+" : "−"}{Math.abs(gap)}</b> vs the market
              </span>
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
