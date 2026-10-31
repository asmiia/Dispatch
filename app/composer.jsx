"use client";
import { useRef, useState } from "react";
import {
  Bold,
  Code,
  Code2,
  Heading2,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  Strikethrough,
} from "lucide-react";
import Markdown from "./markdown";

// Wraps the selection (or inserts a placeholder), then restores the selection.
function wrap(el, value, set, before, after = before, placeholder = "text") {
  const a = el.selectionStart,
    b = el.selectionEnd,
    chosen = value.slice(a, b) || placeholder;
  set(value.slice(0, a) + before + chosen + after + value.slice(b));
  requestAnimationFrame(() => {
    el.focus();
    el.setSelectionRange(a + before.length, a + before.length + chosen.length);
  });
}
// Puts a prefix at the start of every selected line.
function prefix(el, value, set, make) {
  const a = el.selectionStart,
    b = el.selectionEnd,
    start = value.lastIndexOf("\n", a - 1) + 1,
    lines = value.slice(start, b).split("\n"),
    next = lines.map((l, i) => make(i) + l).join("\n");
  set(value.slice(0, start) + next + value.slice(b));
  requestAnimationFrame(() => {
    el.focus();
    el.setSelectionRange(start, start + next.length);
  });
}

// A message editor with a formatting bar and a live preview. Plain Markdown underneath.
export default function Composer({ value, onChange, placeholder }) {
  const ref = useRef(null),
    [preview, setPreview] = useState(false);
  const tools = [
    ["Bold (Ctrl+B)", Bold, (el) => wrap(el, value, onChange, "**")],
    ["Italic (Ctrl+I)", Italic, (el) => wrap(el, value, onChange, "_")],
    ["Strikethrough", Strikethrough, (el) => wrap(el, value, onChange, "~~")],
    ["Heading", Heading2, (el) => prefix(el, value, onChange, () => "## ")],
    ["Inline code", Code, (el) => wrap(el, value, onChange, "`")],
    [
      "Code block",
      Code2,
      (el) => wrap(el, value, onChange, "```\n", "\n```", "code"),
    ],
    [
      "Link (Ctrl+K)",
      Link2,
      (el) => wrap(el, value, onChange, "[", "](https://)", "link text"),
    ],
    ["Bulleted list", List, (el) => prefix(el, value, onChange, () => "- ")],
    [
      "Numbered list",
      ListOrdered,
      (el) => prefix(el, value, onChange, (i) => `${i + 1}. `),
    ],
    ["Quote", Quote, (el) => prefix(el, value, onChange, () => "> ")],
  ];
  function keys(e) {
    if (!(e.ctrlKey || e.metaKey)) return;
    const el = ref.current,
      map = { b: 0, i: 1, k: 6 };
    if (map[e.key] !== undefined) {
      e.preventDefault();
      tools[map[e.key]][2](el);
    }
  }
  return (
    <div className="composer">
      <div className="composer-bar">
        <div className="composer-tools" role="toolbar" aria-label="Formatting">
          {tools.map(([label, Icon, run]) => (
            <button
              key={label}
              type="button"
              title={label}
              aria-label={label}
              disabled={preview}
              onClick={() => run(ref.current)}
            >
              <Icon size={15} />
            </button>
          ))}
        </div>
        <div
          className="theme-switch"
          role="radiogroup"
          aria-label="Editor mode"
        >
          {[
            ["Write", false],
            ["Preview", true],
          ].map(([label, mode]) => (
            <button
              key={label}
              type="button"
              role="radio"
              aria-checked={preview === mode}
              className={preview === mode ? "active" : ""}
              onClick={() => setPreview(mode)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {preview ? (
        <div className="composer-preview">
          {value.trim() ? (
            <Markdown>{value}</Markdown>
          ) : (
            <p className="muted">Nothing to preview yet.</p>
          )}
        </div>
      ) : (
        <textarea
          id="body"
          ref={ref}
          required
          maxLength={100000}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={keys}
          placeholder={placeholder}
        />
      )}
    </div>
  );
}
