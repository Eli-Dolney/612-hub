import type { EditorDocument } from "../types";
import { flattenToCanvas } from "./render";

export const exportDocument = (
  doc: EditorDocument,
  format: "png" | "jpeg" | "webp",
  quality = 0.92,
  width?: number,
  height?: number,
) => {
  const src = flattenToCanvas(doc);
  let canvas = src;
  if (width && height && (width !== doc.width || height !== doc.height)) {
    canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    if (format !== "png") {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(src, 0, 0, width, height);
  } else if (format !== "png") {
    const filled = document.createElement("canvas");
    filled.width = src.width;
    filled.height = src.height;
    const ctx = filled.getContext("2d")!;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, filled.width, filled.height);
    ctx.drawImage(src, 0, 0);
    canvas = filled;
  }
  const mime = format === "png" ? "image/png" : format === "jpeg" ? "image/jpeg" : "image/webp";
  const url = canvas.toDataURL(mime, quality);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${doc.name.replace(/\s+/g, "-").toLowerCase()}.${format === "jpeg" ? "jpg" : format}`;
  a.click();
};

export const saveProject = (doc: EditorDocument) => {
  const blob = new Blob([JSON.stringify({ v: 1, doc }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${doc.name.replace(/\s+/g, "-").toLowerCase()}.grokedit.json`;
  a.click();
  URL.revokeObjectURL(a.href);
};

export const loadProject = (text: string): EditorDocument => {
  const parsed = JSON.parse(text);
  if (!parsed?.doc?.layers) throw new Error("Not a 612 Edit project");
  return parsed.doc as EditorDocument;
};
