"use client";
import { Phone, MessageSquare, X } from "lucide-react";

// Small pop-ups in the corner. Click one to open what it is about.
export default function Toasts({ list, onClose }) {
  if (!list.length) return null;
  return (
    <div className="toasts" role="region" aria-label="Notifications">
      {list.map((t) => (
        <div
          key={t.id}
          className={"toast " + (t.kind ? "kind-" + t.kind : "")}
          role="status"
          onClick={() => {
            t.onClick?.();
            onClose(t.id);
          }}
        >
          {t.kind === "plain" ? null : t.kind === "call" ? (
            <Phone size={18} />
          ) : (
            <MessageSquare size={18} />
          )}
          <div className="toast-body">
            <strong>{t.title}</strong>
            {t.body && <span>{t.body}</span>}
            {t.actions && (
              <div
                className="toast-actions"
                onClick={(e) => e.stopPropagation()}
              >
                {t.actions.map((a) => (
                  <button
                    key={a.label}
                    className={a.primary ? "primary" : "subtle-button"}
                    onClick={() => {
                      a.onClick();
                      onClose(t.id);
                    }}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            className="toast-x"
            aria-label="Dismiss"
            onClick={(e) => {
              e.stopPropagation();
              onClose(t.id);
            }}
          >
            <X size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}
