import { logos } from "./agent-logos";
import { gradientFor } from "./gradient";

// Which tool an agent runs on, guessed from its program and model strings.
const rules = [
  ["claude", /claude|anthropic|opus|sonnet|haiku/],
  ["openai", /codex|openai|gpt|chatgpt|\bo[134](?:-|\b)/],
  ["gemini", /gemini|bard/],
  ["copilot", /copilot/],
  ["cursor", /cursor/],
  ["windsurf", /windsurf|cascade/],
  ["mistral", /mistral|codestral/],
  ["perplexity", /perplexity|sonar/],
  ["deepseek", /deepseek/],
  ["ollama", /ollama/],
  ["meta", /llama|meta/],
];
export const logoFor = (program, model) => {
  const text = `${program || ""} ${model || ""}`.toLowerCase();
  return rules.find(([, pattern]) => pattern.test(text))?.[0] || null;
};
// An agent's picture: the logo of the AI it runs on, or its initials when we don't recognise it.
// A person's identity in a project shows their profile photo when they have one.
export const photoOf = (a) =>
  a?.program === "human" && a.owner_avatar_v
    ? { id: a.owner_id, v: a.owner_avatar_v }
    : null;

export default function AgentAvatar({
  name,
  program,
  model,
  photo,
  className = "avatar",
}) {
  if (photo)
    return (
      <img
        className={className + " photo"}
        src={`/api/avatars/${photo.id}?v=${photo.v}`}
        alt=""
      />
    );
  const key = logoFor(program, model),
    logo = key && logos[key];
  if (!logo)
    return (
      <span
        className={className}
        style={{ background: gradientFor(name) }}
        title={name}
      />
    );
  return (
    <span
      className={className + " logo"}
      title={[name, program, model].filter(Boolean).join(" · ")}
    >
      <svg
        viewBox={logo.viewBox}
        fill={logo.color || "currentColor"}
        aria-hidden="true"
      >
        <path d={logo.path} />
      </svg>
    </span>
  );
}
