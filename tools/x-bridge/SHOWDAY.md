# Market Bubble — Show-Day Runbook

Dead-simple start/stop for the X chat + views integration. The agent
(`mbpanel`) is a login item, so it's already running — you don't launch it.

> **The one rule that makes views stable:** the 3 X broadcast tabs must not be
> *frozen* by Chrome. Chrome freezes any tab that's hidden/covered for a few
> minutes — capture stops and the view counts drop off. **Launching Chrome with
> the keep-alive launcher (Step 1) prevents that, so you can fullscreen the show
> and walk away.** Chat survives freezing (it's a log + Twitch/Kick are
> server-side); the live **view counts** do not — they need a fresh push or they
> expire. That's the whole reason Step 1 exists.

---

## ▶️ START (do this ~10 min before the show)

1. **Launch keep-alive Chrome.** Double-click **`Start Capture Chrome.command`**
   (on the Desktop, also in `tools/x-bridge/`). Chrome quits for ~10s and
   reopens with your tabs restored — now background/covered tabs won't freeze.
   - First time only: if macOS warns, right-click the file → **Open** → Open.
   - This uses your normal Chrome profile (same login + extension). Opening
     Chrome from the Dock = normal mode (no keep-alive), so always start from
     this launcher on show day.
2. **Open the 3 broadcast tabs** — Banks, Ansem, and Market Bubble's X live
   broadcasts. (Open them *fresh*; freshly-opened tabs run the scraper
   automatically.)
3. **Check each tab's badge** (bottom-right of the X page): it must show a
   **green ●** + a **`host:`** line (Banks / Ansem / Market Bubble) + a
   **`views:`** number climbing. That's the "it's working" signal. If a host is
   missing or views shows `—` → **⌘R that one tab**.
4. **In Studio → "X chat bridge" card → flip `Auto` ON** (optional OCR backup —
   capture runs without it, this just arms the failover).
   - (Auto needs the operator login — same password you set in Render.)
5. **Confirm on the site** (the live room): chat scrolling with X/Twitch/Kick
   badges, and the **Live Audience** bar showing the combined view count
   (hover = per-account breakdown).

That's it. With keep-alive Chrome running you can fullscreen anything and leave it.

---

## 👀 DURING the show — what to glance at

- **The badges** on each broadcast tab: green ● + a host + a `views:` number.
  That's health. With keep-alive Chrome you don't need the tabs visible.
- **If a view count drops on the site:** ⌘R that broadcast tab. (Almost always
  means keep-alive Chrome wasn't launched — quit Chrome and start from
  `Start Capture Chrome.command`.)
- **If you hear a loud alarm + see "X EXTENSION DOWN — RELOAD IT":** the
  extension broke (X changed something). OCR backup covers chat, so **chat keeps
  flowing** — you just:
  1. `chrome://extensions` → **↻** on "Market Bubble — X Bridge"
  2. **⌘R** the broadcast tabs
  3. Badges go green again → done.

---

## ⏹️ STOP (after the show)

- **Quick pause:** Studio → flip `Auto` (or the switch) **off**, or just close
  the broadcast tabs.
- **Fully off (save battery):** close the broadcast tabs **and** quit
  **MBCapture** (⌘Q) if it's running. The login-item agent can stay running.
- You can go back to launching Chrome normally from the Dock once the show's
  over — keep-alive mode only matters while capturing.

---

## 🛠️ Troubleshooting

| Symptom | Fix |
|---|---|
| **View counts drop when you switch away / fullscreen** | Chrome froze the hidden tabs. Quit Chrome, relaunch via **`Start Capture Chrome.command`**. That's the fix — keep-alive Chrome stops the freezing. |
| Badge has no `host:` | ⌘R that broadcast tab (extension catches the host at page load; works even if you already follow them) |
| Badge shows `views: —` but a count is on screen | ⌘R the tab. If it persists across all tabs, the extension is running stale code — see the maintainer note below. |
| One host missing from the views bar | That tab is frozen or closed — open/⌘R it; a tab that stops pushing drops after **~90s** |
| Studio switch / Auto greyed out | Agent shows offline — quit & relaunch the agent (login item), check wifi |
| Switch clicks but nothing happens | Operator key not entered in Studio — re-enter the Render `OPERATOR_KEY` value |
| Fake / garbage chat appears | Extension died and OCR took over a dead chat — **reload the extension** (↻ + ⌘R); OCR is muted whenever the extension's alive |
| OCR/Capture not starting | MBCapture needs Screen Recording permission (System Settings → Privacy & Security → Screen Recording → MBCapture ON) |

---

## 🔧 Maintainer notes (editing the extension)

- **The live extension loads from `tools/x-bridge/extension/`** — a SUBFOLDER.
  The parent `tools/x-bridge/` also has `content.js` / `background.js` (working
  copies) but the extension does NOT use those. **Edit the files under
  `extension/`** (or `cp` parent → `extension/`) or your changes never take
  effect, no matter how many times you reload. (This burned a whole show once.)
- Confirm the loaded path: on the `chrome://extensions` page, run
  `chrome.developerPrivate.getExtensionsInfo(l=>console.log(l.map(e=>[e.name,e.path])))`.
- Reload the extension without clicking: from that same page,
  `chrome.developerPrivate.reload("<extId>", {failQuietly:false}, ()=>{})`, then ⌘R the tabs.
- The hub holds each X host's count for **90s** after its last push
  (`XLIVE_TTL` in `server/index.js`) — long enough to ride out a throttled tab,
  short enough that an ended broadcast drops within ~90s.

---

## How it works (one paragraph)

The **extension** scrapes each live X broadcast's chat (clean, with emojis) +
reads its live view count (a plain `N,NNN views` node on the broadcast) and
pings a **heartbeat** every 5s. The **OCR bridge** is the backup — it reads the
screen, so it survives X changing their HTML. The **hub** merges X + Twitch +
Kick into one feed and sums the X views per host (combined bar + per-account
breakdown). While the extension's heartbeat is alive, the OCR stays **muted**
(no doubles, no garbage); if the heartbeat stops, OCR takes over chat and the
**alarm** fires so you reload the extension. Chat never stops. The view counts
only stay live while the tabs keep pushing — which is why show day starts by
launching **keep-alive Chrome** so the tabs never freeze.
