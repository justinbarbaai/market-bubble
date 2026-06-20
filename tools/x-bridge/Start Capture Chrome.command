#!/bin/bash
#
# Start Capture Chrome
# --------------------
# Relaunches Google Chrome with background tabs kept ALIVE, so the Market Bubble
# X-bridge extension keeps capturing live view counts even when the broadcast
# tabs are hidden, fully covered, or behind a fullscreen show.
#
# It uses your NORMAL Chrome profile — same login, same extensions, same tabs.
# It does NOT make a fresh/temp profile, so nothing about your account, cookies,
# or the extension changes. The only difference is three launch flags that turn
# off Chrome's background-tab freezing. Open Chrome from the Dock as usual and
# you're back to default behavior — this keep-alive mode only applies when you
# launch from this file. Fully reversible, nothing permanent.
#
# Cost: Chrome quits for ~10s and reopens with your tabs restored (the broadcasts
# reload and re-attach in ~15s), and background tabs use a little more battery
# while capturing. That's it.

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

if [ ! -x "$CHROME" ]; then
  echo "❌ Couldn't find Google Chrome at:"
  echo "   $CHROME"
  echo "If Chrome is installed somewhere else, tell Claude and it'll fix the path."
  echo
  echo "Press any key to close…"; read -n 1 -s
  exit 1
fi

echo "Quitting Chrome so the keep-alive flags can apply (your tabs will restore)…"
osascript -e 'quit app "Google Chrome"' 2>/dev/null

# Wait for Chrome to fully exit (up to ~10s).
for i in $(seq 1 20); do
  pgrep -x "Google Chrome" >/dev/null 2>&1 || break
  sleep 0.5
done

echo "Relaunching Chrome in capture-keep-alive mode…"
# --restore-last-session  : bring back the tabs that were open (the broadcasts)
# --disable-backgrounding-occluded-windows : don't deprioritize covered windows
# --disable-renderer-backgrounding         : don't freeze background tab renderers
# --disable-background-timer-throttling     : don't slow background tab timers
"$CHROME" \
  --restore-last-session \
  --disable-backgrounding-occluded-windows \
  --disable-renderer-backgrounding \
  --disable-background-timer-throttling \
  >/dev/null 2>&1 &
disown

echo
echo "✅ Chrome is now running in keep-alive mode."
echo "   Your X broadcast tabs will keep capturing even hidden / fullscreen-covered."
echo "   You can close this window."
sleep 1
