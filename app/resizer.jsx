"use client";
import { useEffect, useState } from "react";

// A size you can drag, remembered between visits.
export function useSize(key, fallback, min, max) {
  const [size, setSize] = useState(fallback);
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem("dispatch-size-" + key));
      if (saved) setSize(Math.min(max, Math.max(min, saved)));
    } catch {}
  }, []);
  const set = (value) => {
    const next = Math.min(max, Math.max(min, Math.round(value)));
    setSize(next);
    try {
      localStorage.setItem("dispatch-size-" + key, String(next));
    } catch {}
  };
  return [size, set, () => set(fallback)];
}

// A thin handle between two panels. Drag to resize, double-click to reset.
// grow = 1 when dragging right/down makes the panel bigger, -1 when it makes it smaller.
export default function Resizer({
  size,
  onChange,
  onReset,
  axis = "x",
  grow = 1,
  label,
}) {
  const down = (e) => {
    e.preventDefault();
    const start = axis === "x" ? e.clientX : e.clientY,
      from = size;
    const move = (ev) =>
      onChange(
        from + grow * ((axis === "x" ? ev.clientX : ev.clientY) - start),
      );
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("resizing");
    };
    document.body.classList.add("resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <div
      className={"resizer " + axis}
      role="separator"
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      aria-label={label}
      title="Drag to resize, double-click to reset"
      onPointerDown={down}
      onDoubleClick={onReset}
    />
  );
}
