"use client";
import { useState, Children, isValidElement } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkEmoji from "remark-emoji";
import { Check, Copy, ExternalLink } from "lucide-react";

// Only these link targets are clickable; anything else (javascript:, data:, ...) is shown as plain text.
const safe = (href = "") => /^(https?:|mailto:|#|\/)/i.test(href);

function A({ href, children }) {
  if (!safe(href)) return <span>{children}</span>;
  const external = /^https?:/i.test(href);
  return (
    <a
      href={href}
      {...(external
        ? { target: "_blank", rel: "noopener noreferrer nofollow" }
        : {})}
    >
      {children}
    </a>
  );
}

// A link on a line of its own becomes a small card. Nothing is fetched: it only shows the address.
function LinkCard({ href }) {
  let host = href,
    rest = "";
  try {
    const u = new URL(href);
    host = u.hostname.replace(/^www\./, "");
    rest = (u.pathname === "/" ? "" : u.pathname) + u.search;
  } catch {}
  return (
    <a
      className="link-card"
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
    >
      <span className="link-card-icon">
        <ExternalLink size={16} />
      </span>
      <span className="link-card-text">
        <strong>{host}</strong>
        <em>{rest || href}</em>
      </span>
    </a>
  );
}

function CodeBlock({ lang, text }) {
  const [done, setDone] = useState(false);
  return (
    <div className="code-block">
      <div className="code-head">
        <span>{lang || "text"}</span>
        <button
          type="button"
          aria-label="Copy code"
          onClick={async () => {
            await navigator.clipboard.writeText(text);
            setDone(true);
            setTimeout(() => setDone(false), 1600);
          }}
        >
          {done ? <Check size={13} /> : <Copy size={13} />}
          {done ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <code>{text}</code>
      </pre>
    </div>
  );
}

const components = {
  a: A,
  p({ children }) {
    const kids = Children.toArray(children);
    if (kids.length === 1 && isValidElement(kids[0]) && kids[0].type === A) {
      const { href, children: label } = kids[0].props;
      if (safe(href) && /^https?:/i.test(href) && String(label) === href)
        return <LinkCard href={href} />;
    }
    return <p>{children}</p>;
  },
  pre({ children }) {
    const code = Children.toArray(children)[0],
      lang = /language-([\w-]+)/.exec(code?.props?.className || "")?.[1],
      text = String(code?.props?.children ?? "").replace(/\n$/, "");
    return <CodeBlock lang={lang} text={text} />;
  },
  table({ children }) {
    return (
      <div className="md-table">
        <table>{children}</table>
      </div>
    );
  },
  // Pictures from other sites would be blocked by the page's security policy, so show a link instead.
  img({ src, alt }) {
    return /^(\/|data:image\/)/i.test(src || "") ? (
      <img src={src} alt={alt || ""} loading="lazy" />
    ) : (
      <A href={src}>{alt || src}</A>
    );
  },
};

export default function Markdown({ children }) {
  return (
    <div className="prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkEmoji]}
        components={components}
      >
        {children || ""}
      </ReactMarkdown>
    </div>
  );
}
