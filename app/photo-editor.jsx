"use client";
import { useEffect, useRef, useState } from "react";
import { ImagePlus } from "lucide-react";

const PREVIEW = 240,
  OUTPUT = 512;

// Choose a photo and frame it as a square: zoom and move it, then save a 512 px JPEG.
export default function PhotoEditor({ onSave, onCancel, busy }) {
  const [image, setImage] = useState(null),
    [zoom, setZoom] = useState(1),
    [x, setX] = useState(0),
    [y, setY] = useState(0),
    [error, setError] = useState(""),
    canvas = useRef(null);

  // Draws the image "cover"-fitted into a square, then scaled and shifted by the sliders.
  function draw(target, size) {
    const ctx = target.getContext("2d"),
      cover = size / Math.min(image.width, image.height),
      scale = cover * zoom,
      w = image.width * scale,
      h = image.height * scale,
      spareX = Math.max(0, w - size),
      spareY = Math.max(0, h - size);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(
      image,
      -spareX / 2 - (x / 100) * (spareX / 2),
      -spareY / 2 - (y / 100) * (spareY / 2),
      w,
      h,
    );
  }
  useEffect(() => {
    if (image && canvas.current) draw(canvas.current, PREVIEW);
  }, [image, zoom, x, y]);

  function choose(e) {
    const file = e.target.files?.[0];
    setError("");
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type))
      return setError("Choose a PNG, JPEG, WebP or GIF image.");
    // Read the file as a data: URL; the page's security policy allows data: images but not blob: ones.
    const reader = new FileReader();
    reader.onerror = () => setError("That file could not be read.");
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        setImage(img);
        setZoom(1);
        setX(0);
        setY(0);
      };
      img.onerror = () => setError("That file could not be read as an image.");
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  }
  function save() {
    const out = document.createElement("canvas");
    out.width = out.height = OUTPUT;
    draw(out, OUTPUT);
    out.toBlob(
      (blob) => {
        const reader = new FileReader();
        reader.onload = () => onSave(String(reader.result).split(",")[1]);
        reader.readAsDataURL(blob);
      },
      "image/jpeg",
      0.9,
    );
  }

  return (
    <div className="photo-editor">
      {!image ? (
        <label className="photo-drop">
          <ImagePlus size={22} />
          <strong>Choose a photo</strong>
          <span>PNG, JPEG, WebP or GIF. You'll crop it to a square next.</span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={choose}
          />
        </label>
      ) : (
        <div className="photo-frame">
          <canvas
            ref={canvas}
            width={PREVIEW}
            height={PREVIEW}
            className="photo-canvas"
            aria-label="Photo preview"
          />
          <div className="photo-controls">
            <label>
              Zoom
              <input
                type="range"
                min="1"
                max="3"
                step="0.01"
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
              />
            </label>
            <label>
              Left / right
              <input
                type="range"
                min="-100"
                max="100"
                value={x}
                onChange={(e) => setX(Number(e.target.value))}
              />
            </label>
            <label>
              Up / down
              <input
                type="range"
                min="-100"
                max="100"
                value={y}
                onChange={(e) => setY(Number(e.target.value))}
              />
            </label>
            <div className="photo-actions">
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={save}
              >
                Save photo
              </button>
              <button
                type="button"
                className="subtle-button"
                onClick={() => setImage(null)}
              >
                Choose another
              </button>
              <button
                type="button"
                className="subtle-button"
                onClick={onCancel}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {!image && (
        <button type="button" className="subtle-button" onClick={onCancel}>
          Cancel
        </button>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
