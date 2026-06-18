// Drives the bridge's scrape cadence from a Worker thread.
//
// Chrome clamps MAIN-THREAD timers (setInterval in the page/content script) to
// roughly once per MINUTE once a tab has been hidden or occluded for ~5 min —
// which is exactly what froze capture whenever the broadcast window wasn't in
// front (behind a fullscreen show, another window, or a background tab). Worker
// timers are NOT subject to that intensive throttling, and the message handler
// that runs on each beat is event-driven (also not timer-throttled), so this
// keeps the live capture running at full rate even when the tab is fully hidden.
//
// The content script does the actual DOM read on each "scan"/"tick" message.
let scanMs = 2000;
let tickMs = 5000;
let scanTimer = null;
let tickTimer = null;

function arm() {
  if (scanTimer) clearInterval(scanTimer);
  if (tickTimer) clearInterval(tickTimer);
  scanTimer = setInterval(() => self.postMessage("scan"), scanMs);
  tickTimer = setInterval(() => self.postMessage("tick"), tickMs);
}

self.onmessage = (e) => {
  const d = e.data || {};
  if (typeof d.scanMs === "number") scanMs = d.scanMs;
  if (typeof d.tickMs === "number") tickMs = d.tickMs;
  arm();
};

arm();
