"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Right-click menu at the cursor. items: [{ label, icon, onClick, danger, disabled } | "-"]
export default function ContextMenu({ menu, onClose }) {
  const ref = useRef(null),
    [pos, setPos] = useState({ left: menu.x, top: menu.y });
  // Keep the menu inside the window.
  useEffect(() => {
    const r = ref.current.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(menu.x, innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(menu.y, innerHeight - r.height - 8)),
    });
  }, [menu]);
  useEffect(() => {
    const close = () => onClose(),
      key = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [onClose]);
  // In full screen only the full-screen element is visible, so the menu has to live inside it.
  return createPortal(
    <div
      className="ctx-backdrop"
      onMouseDown={onClose}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div
        ref={ref}
        className="ctx-menu"
        role="menu"
        style={pos}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {menu.items.map((it, i) =>
          it === "-" ? (
            <div className="ctx-sep" key={i} />
          ) : (
            <button
              key={i}
              role="menuitem"
              className={it.danger ? "danger" : ""}
              disabled={it.disabled}
              onClick={() => {
                onClose();
                it.onClick();
              }}
            >
              {it.icon}
              {it.label}
            </button>
          ),
        )}
      </div>
    </div>,
    document.fullscreenElement || document.body,
  );
}
