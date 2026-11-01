import { gradientFor } from "./gradient";

// A person's profile picture: their square photo, or a gradient.
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
      style={{ width: size, height: size, background: gradientFor(name) }}
      aria-hidden="true"
    />
  );
}
