"use client";
import { useEffect, useRef, useState } from "react";
import { ImagePlus, Minus, Plus, X } from "lucide-react";

const PREVIEW = 360,
  OUTPUT = 512;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// A crop dialog with a square frame: drag the photo, zoom with the slider or wheel, save a square.
export default function PhotoEditor({ onSave, onCancel, busy }) {
  const [image, setImage] = useState(null),
    [zoom, setZoom] = useState(1),
    [pos, setPos] = useState({ x: 0, y: 0 }), // image offset as a fraction of the frame, 0 = centered
    [error, setError] = useState(""),
    canvas = useRef(null),
    drag = useRef(null);

  // Cover-fits the image in a square, scaled by zoom and shifted by pos, never leaving gaps.
  function draw(target, size) {
    const ctx = target.getContext("2d"),
      scale = (size / Math.min(image.width, image.height)) * zoom,
      w = image.width * scale,
      h = image.height * scale,
      left = clamp((size - w) / 2 + pos.x * size, size - w, 0),
      top = clamp((size - h) / 2 + pos.y * size, size - h, 0);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(image, left, top, w, h);
  }
  useEffect(() => {
    if (image && canvas.current) draw(canvas.current, PREVIEW);
  }, [image, zoom, pos]);
  useEffect(() => {
    const esc = (e) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);

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
        setPos({ x: 0, y: 0 });
      };
      img.onerror = () => setError("That file could not be read as an image.");
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  }
  function down(e) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, pos };
  }
  function move(e) {
    const d = drag.current;
    if (!d) return;
    const box = e.currentTarget.getBoundingClientRect().width;
    setPos({
      x: d.pos.x + (e.clientX - d.x) / box,
      y: d.pos.y + (e.clientY - d.y) / box,
    });
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
    <div
      className="photo-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Edit profile photo"
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="photo-dialog">
        <div className="photo-head">
          <h3>Edit profile photo</h3>
          <button
            type="button"
            className="icon-button"
            aria-label="Close"
            onClick={onCancel}
          >
            <X size={16} />
          </button>
        </div>
        {!image ? (
          <label className="photo-drop">
            <ImagePlus size={26} />
            <strong>Upload a photo</strong>
            <span>
              PNG, JPEG, WebP or GIF. You'll crop it to a square next.
            </span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={choose}
            />
          </label>
        ) : (
          <>
            <div
              className="photo-stage"
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={() => (drag.current = null)}
              onWheel={(e) => setZoom((z) => clamp(z - e.deltaY / 500, 1, 4))}
            >
              <canvas
                ref={canvas}
                width={PREVIEW}
                height={PREVIEW}
                aria-label="Photo preview"
              />
              <i className="photo-grid" />
            </div>
            <p className="photo-hint">
              Drag to reposition. Scroll or use the slider to zoom.
            </p>
            <div className="photo-zoom">
              <Minus size={14} />
              <input
                type="range"
                aria-label="Zoom"
                min="1"
                max="4"
                step="0.01"
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
              />
              <Plus size={14} />
            </div>
          </>
        )}
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        <div className="photo-actions">
          {image && (
            <button
              type="button"
              className="subtle-button"
              onClick={() => setImage(null)}
            >
              Choose another
            </button>
          )}
          <span />
          <button type="button" className="subtle-button" onClick={onCancel}>
            Cancel
          </button>
          {image && (
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={save}
            >
              Save photo
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
