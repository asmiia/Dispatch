// A stable random-looking gradient per name, used instead of initials.
export const gradientFor = (name) => {
  let h = 0;
  for (const c of String(name || "?")) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const a = h % 360,
    b = (a + 40 + ((h >> 8) % 80)) % 360;
  return `linear-gradient(${(h >> 4) % 360}deg, hsl(${a} 75% 55%), hsl(${b} 80% 45%))`;
};

// Just the hue, for tinting a call tile behind someone's avatar.
export const hueFor = (name) => {
  let h = 0;
  for (const c of String(name || "?")) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
};
