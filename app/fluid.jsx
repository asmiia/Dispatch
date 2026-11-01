"use client";
import { useRef } from "react";

// A list whose hover highlight is one shape that glides to the row nearest the pointer, instead of each row
// lighting up on its own. It sets in a little before you reach a row, which makes small targets easier to hit.
export default function Fluid({
  as: Tag = "div",
  item = "button",
  className = "",
  children,
  ...rest
}) {
  const box = useRef(null),
    glow = useRef(null);
  const move = (e) => {
    const root = box.current,
      shape = glow.current;
    if (!root || !shape) return;
    let best = null,
      near = Infinity;
    for (const el of root.querySelectorAll(item)) {
      const r = el.getBoundingClientRect(),
        gap =
          e.clientY < r.top
            ? r.top - e.clientY
            : e.clientY > r.bottom
              ? e.clientY - r.bottom
              : 0;
      if (gap < near) {
        near = gap;
        best = el;
      }
    }
    if (!best || near > 24) return void (shape.style.opacity = 0);
    const a = root.getBoundingClientRect(),
      r = best.getBoundingClientRect();
    shape.style.width = r.width + "px";
    shape.style.height = r.height + "px";
    shape.style.transform = `translate(${r.left - a.left + root.scrollLeft}px, ${r.top - a.top + root.scrollTop}px)`;
    shape.style.opacity = 1;
  };
  return (
    <Tag
      ref={box}
      className={"fluid " + className}
      onPointerMove={move}
      onPointerLeave={() => glow.current && (glow.current.style.opacity = 0)}
      {...rest}
    >
      {children}
      <span ref={glow} className="fluid-hl" aria-hidden="true" />
    </Tag>
  );
}
