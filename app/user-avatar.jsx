// A person's profile picture: their square photo, or their initials.
const initials = (name) =>
  (name || "?")
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0])
    .join("")
    .toUpperCase();

export default function UserAvatar({ id, name, v, size = 38, className = "" }) {
  if (v)
    return (
      <img
        className={"u-avatar " + className}
        src={`/api/avatars/${id}?v=${v}`}
        alt=""
        width={size}
        height={size}
      />
    );
  return (
    <span
      className={"u-avatar initials " + className}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.34) }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}
