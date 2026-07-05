"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { EmoteMap } from "../lib/useEmotes";
import type { EmoteSection } from "../lib/useUserEmotes";

// The chat input with a Twitch-style emote system:
//  - type-to-autocomplete: a popup of matching emotes appears as you type a
//    word (≥2 chars); ↑/↓ to move, Tab/Enter to insert, Esc to dismiss.
//  - an emote picker (☺) like Twitch's: search + sections grouped by channel,
//    with a right-side tab strip (channel avatars + a 7TV tab) to jump between
//    them. When logged in it shows the viewer's OWN emotes (every channel they
//    sub to); otherwise the show channels' public sets.
// Inserting drops the emote's NAME into the text — that's what gets sent, and
// the hub renders it back as an image in everyone's feed.

const SUG_MAX = 8;

function tokenAt(text: string, caret: number) {
  let start = caret;
  while (start > 0 && /\S/.test(text[start - 1])) start--;
  let end = caret;
  while (end < text.length && /\S/.test(text[end])) end++;
  return { start, end, q: text.slice(start, caret) };
}

export function EmoteInput({
  value,
  onChange,
  onSubmit,
  placeholder,
  disabled,
  emotes,
  sections,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  disabled?: boolean;
  emotes: EmoteMap;
  sections: EmoteSection[];
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const caretRef = useRef(0);
  const pendingCaret = useRef<number | null>(null);
  const [tick, setTick] = useState(0);
  const [sugIndex, setSugIndex] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const secRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const names = useMemo(() => Object.keys(emotes), [emotes]);
  const hasEmotes = names.length > 0;

  const suggestions = useMemo(() => {
    const el = inputRef.current;
    if (!el || document.activeElement !== el) return [];
    const { q } = tokenAt(value, caretRef.current);
    if (q.length < 2) return [];
    const ql = q.toLowerCase();
    const starts: string[] = [];
    const contains: string[] = [];
    for (const n of names) {
      const nl = n.toLowerCase();
      if (nl.startsWith(ql)) starts.push(n);
      else if (nl.includes(ql)) contains.push(n);
      if (starts.length >= SUG_MAX) break;
    }
    return [...starts, ...contains].slice(0, SUG_MAX);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, names, tick]);

  useEffect(() => setSugIndex(0), [value]);

  useEffect(() => {
    if (pendingCaret.current != null && inputRef.current) {
      const c = pendingCaret.current;
      pendingCaret.current = null;
      inputRef.current.setSelectionRange(c, c);
      caretRef.current = c;
    }
  });

  const syncCaret = () => {
    const el = inputRef.current;
    if (el) caretRef.current = el.selectionStart ?? el.value.length;
    setTick((n) => n + 1);
  };

  const insertEmote = (name: string, mode: "word" | "caret", keepPicker = false) => {
    const caret = caretRef.current;
    let start: number, end: number;
    if (mode === "word") {
      const t = tokenAt(value, caret);
      start = t.start;
      end = t.end;
    } else {
      start = end = caret;
    }
    const next = value.slice(0, start) + name + " " + value.slice(end);
    pendingCaret.current = start + name.length + 1;
    onChange(next);
    if (!keepPicker) setPickerOpen(false);
    inputRef.current?.focus();
  };

  // Sending puts the menu away — you shouldn't have to close it by hand.
  const submit = () => {
    setPickerOpen(false);
    setPickerQuery("");
    onSubmit();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (suggestions.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSugIndex((i) => (i + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSugIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && suggestions[sugIndex])) {
        e.preventDefault();
        insertEmote(suggestions[sugIndex], "word");
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        caretRef.current = -1;
        setTick((n) => n + 1);
        return;
      }
    }
    if (e.key === "Enter") submit();
  };

  // Search across every section → a flat result list.
  const searchHits = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    if (!q) return null;
    const seen = new Set<string>();
    const hits: { name: string; url: string }[] = [];
    for (const sec of sections)
      for (const e of sec.emotes) {
        if (seen.has(e.name)) continue;
        if (e.name.toLowerCase().includes(q)) {
          seen.add(e.name);
          hits.push(e);
        }
        if (hits.length >= 300) break;
      }
    return hits;
  }, [pickerQuery, sections]);

  const jumpTo = (id: string) => {
    const el = secRefs.current[id];
    const wrap = scrollRef.current;
    if (el && wrap) wrap.scrollTo({ top: el.offsetTop - wrap.offsetTop, behavior: "smooth" });
  };

  const tabIcon = (sec: EmoteSection) => {
    if (sec.icon) {
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={sec.icon} alt="" />;
    }
    if (sec.id === "7tv") return <span className="emote-tab-glyph">7TV</span>;
    if (sec.id === "kick") return <span className="emote-tab-glyph">KICK</span>;
    if (sec.id === "global" || sec.id === "twitch") return <span className="emote-tab-glyph">TW</span>;
    return <span className="emote-tab-glyph">{sec.label.charAt(0).toUpperCase()}</span>;
  };

  return (
    <div className="emote-input">
      {suggestions.length > 0 && (
        <div className="emote-sug" role="listbox">
          {suggestions.map((n, i) => (
            <button
              key={n}
              type="button"
              className={`emote-sug-row ${i === sugIndex ? "on" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                insertEmote(n, "word");
              }}
              onMouseEnter={() => setSugIndex(i)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={emotes[n].url} alt="" loading="lazy" />
              <span>{n}</span>
            </button>
          ))}
        </div>
      )}

      {pickerOpen && (
        <div className="emote-picker">
          <div className="emote-picker-main">
            <input
              className="emote-picker-search"
              autoFocus
              value={pickerQuery}
              onChange={(e) => setPickerQuery(e.target.value)}
              placeholder="Search emotes…"
            />
            <div className="emote-picker-scroll" ref={scrollRef}>
              {searchHits ? (
                <div className="emote-grid">
                  {searchHits.map((e) => (
                    <button
                      key={e.name}
                      type="button"
                      className="emote-cell"
                      title={e.name}
                      onClick={() => insertEmote(e.name, "caret", true)}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={e.url} alt={e.name} loading="lazy" />
                    </button>
                  ))}
                  {searchHits.length === 0 && <span className="emote-picker-empty">No emotes</span>}
                </div>
              ) : (
                sections.map((sec) => (
                  <div
                    key={sec.id}
                    className="emote-section"
                    ref={(el) => {
                      secRefs.current[sec.id] = el;
                    }}
                  >
                    <div className="emote-section-head">
                      {sec.icon && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={sec.icon} alt="" />
                      )}
                      <span>{sec.label}</span>
                    </div>
                    <div className="emote-grid">
                      {sec.emotes.map((e) => (
                        <button
                          key={e.name}
                          type="button"
                          className="emote-cell"
                          title={e.name}
                          onClick={() => insertEmote(e.name, "caret", true)}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={e.url} alt={e.name} loading="lazy" />
                        </button>
                      ))}
                    </div>
                  </div>
                ))
              )}
              {sections.length === 0 && (
                <span className="emote-picker-empty">Log in with Twitch to load your emotes.</span>
              )}
            </div>
          </div>

          {sections.length > 1 && (
            <div className="emote-picker-tabs">
              {sections.map((sec) => (
                <button
                  key={sec.id}
                  type="button"
                  className={`emote-tab ${sec.id === "7tv" ? "is-7tv" : sec.id === "kick" ? "is-kick" : ""}`}
                  title={sec.label}
                  onClick={() => jumpTo(sec.id)}
                >
                  {tabIcon(sec)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="reader-composer">
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            requestAnimationFrame(syncCaret);
          }}
          onKeyUp={syncCaret}
          onClick={syncCaret}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
        />
        {hasEmotes && (
          <button
            type="button"
            className={`emote-btn ${pickerOpen ? "on" : ""}`}
            onClick={() => setPickerOpen((o) => !o)}
            title="Emotes"
            aria-label="Emotes"
          >
            ☺
          </button>
        )}
        <button onClick={submit} disabled={disabled}>
          Send
        </button>
      </div>
    </div>
  );
}
