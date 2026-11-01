// Three colors that suit a profile picture, for the background behind it. Pictures are same-origin, so the canvas stays readable.
const cache = new Map();
const hsl = (r, g, b) => {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [((h * 60) + 360) % 360, s, l];
};
export function avatarTint(src) {
  if (cache.has(src)) return cache.get(src);
  const job = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = c.height = 24;
        const x = c.getContext("2d", { willReadFrequently: true });
        x.drawImage(img, 0, 0, 24, 24);
        const px = x.getImageData(0, 0, 24, 24).data, buckets = Array.from({ length: 12 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
        for (let i = 0; i < px.length; i += 4) {
          const [h, s, l] = hsl(px[i], px[i + 1], px[i + 2]);
          if (px[i + 3] < 128 || s < 0.2 || l < 0.12 || l > 0.88) continue;
          const b = buckets[Math.floor(h / 30) % 12], w = s;
          b.w += w; b.r += px[i] * w; b.g += px[i + 1] * w; b.b += px[i + 2] * w;
        }
        const top = buckets.filter((b) => b.w > 0).sort((a, b) => b.w - a.w).slice(0, 3)
          .map((b) => hsl(b.r / b.w, b.g / b.w, b.b / b.w));
        if (!top.length) return resolve(null);
        while (top.length < 3) top.push([(top[0][0] + 40 * top.length) % 360, top[0][1], top[0][2]]);
        resolve(top.map(([h, s]) => [Math.round(h), Math.round(Math.min(0.7, Math.max(0.35, s)) * 100)]));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
  cache.set(src, job);
  return job;
}
