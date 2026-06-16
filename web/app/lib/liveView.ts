// Shared "which view" intent for the home page (lobby vs the live room). The
// live room is a view-state on `/` (manualView), so the global bottom nav and
// the top button both flip it through here — persisted to sessionStorage so the
// intent survives a cross-page navigation (e.g. /market → Live), and broadcast
// via an event so a same-page tap updates instantly.
export type MBView = "live" | "lobby";
const KEY = "mb.view";

export function requestView(v: MBView) {
  try {
    sessionStorage.setItem(KEY, v);
  } catch {}
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<MBView>("mb:view", { detail: v }));
  }
}

export function readView(): MBView | null {
  try {
    const v = sessionStorage.getItem(KEY);
    return v === "live" || v === "lobby" ? v : null;
  } catch {
    return null;
  }
}
