"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { EmoteMap } from "../lib/useEmotes";

// The chat input with Twitch-style emote support:
//  - type-to-autocomplete: a popup of matching emotes appears as you type a
//    word (≥2 chars); ↑/↓ to move, Tab/Enter to insert, Esc to dismiss.
//  - an emote picker (😀) button: a searchable grid you can click to insert.
// Inserting just drops the emote's NAME into the text — that's what gets sent,
// and the hub renders it back as an image in everyone's feed.

const SUG_MAX = 8;
const PICKER_MAX = 200;

// The token the caret sits in: start/end offsets + the prefix up to the caret.
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
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  disabled?: boolean;
  emotes: EmoteMap;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const caretRef = useRef(0);
  const pendingCaret = useRef<number | null>(null);
  const [tick, setTick] = useState(0);
  const [sugIndex, setSugIndex] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");

  const names = useMemo(() => Object.keys(emotes), [emotes]);
  const hasEmotes = names.length > 0;

  // Suggestions for the word currently being typed.
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
    // re-run whenever the value OR caret position (tick) changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, names, tick]);

  useEffect(() => setSugIndex(0), [value]);

  // Restore the caret after a programmatic insert re-renders the input.
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
    setTick((n) => n + 1); // refresh suggestions for the new caret
  };

  // Replace the token at the caret (autocomplete) or insert at the caret
  // (picker) with the emote name + a trailing space.
  const insertEmote = (name: string, mode: "word" | "caret") => {
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
    setPickerOpen(false);
    inputRef.current?.focus();
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
        caretRef.current = -1; // hide suggestions until next keystroke
        setTick((n) => n + 1);
        return;
      }
    }
    if (e.key === "Enter") onSubmit();
  };

  const pickerList = useMemo(() => {
    if (!pickerOpen) return [];
    const q = pickerQuery.trim().toLowerCase();
    const arr = q ? names.filter((n) => n.toLowerCase().includes(q)) : names;
    return arr.slice(0, PICKER_MAX);
  }, [pickerOpen, pickerQuery, names]);

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
          <input
            className="emote-picker-search"
            autoFocus
            value={pickerQuery}
            onChange={(e) => setPickerQuery(e.target.value)}
            placeholder="Search emotes…"
          />
          <div className="emote-picker-grid">
            {pickerList.map((n) => (
              <button
                key={n}
                type="button"
                className="emote-picker-cell"
                title={n}
                onClick={() => insertEmote(n, "caret")}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={emotes[n].url} alt={n} loading="lazy" />
              </button>
            ))}
            {pickerList.length === 0 && <span className="emote-picker-empty">No emotes</span>}
          </div>
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
        <button onClick={onSubmit} disabled={disabled}>
          Send
        </button>
      </div>
    </div>
  );
}
