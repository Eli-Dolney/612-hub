import {
  defaultAdjustments,
  type BlendMode,
  type EditorDocument,
  type FillLayer,
  type ImageLayer,
  type Layer,
  type ShapeKind,
  type ShapeLayer,
  type TextLayer,
} from "../types";
import { uid } from "./ids";

export const cloneDoc = (doc: EditorDocument): EditorDocument =>
  structuredClone(doc);

export const createDocument = (
  name: string,
  width: number,
  height: number,
  background = "#111318",
): EditorDocument => ({
  id: uid(),
  name,
  width,
  height,
  background,
  layers: [
    {
      id: uid(),
      type: "fill",
      name: "Background",
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: "source-over",
      x: 0,
      y: 0,
      width,
      height,
      rotation: 0,
      fill: background,
    },
  ],
});

const base = (
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
): Omit<Layer, "type"> & { blendMode: BlendMode } => ({
  id: uid(),
  name,
  visible: true,
  locked: false,
  opacity: 1,
  blendMode: "source-over",
  x,
  y,
  width,
  height,
  rotation: 0,
});

export const createFill = (
  name: string,
  width: number,
  height: number,
  fill: string,
  gradient?: FillLayer["gradient"],
): FillLayer => ({
  ...base(name, 0, 0, width, height),
  type: "fill",
  fill,
  gradient,
});

export const createImageLayer = (
  name: string,
  src: string,
  x: number,
  y: number,
  width: number,
  height: number,
): ImageLayer => ({
  ...base(name, x, y, width, height),
  type: "image",
  src,
  adjustments: defaultAdjustments(),
  flipH: false,
  flipV: false,
});

export const createTextLayer = (
  text: string,
  x: number,
  y: number,
  partial?: Partial<TextLayer>,
): TextLayer => ({
  ...base(text.slice(0, 18) || "Text", x, y, 640, 120),
  type: "text",
  text,
  fontFamily: "Anton",
  fontSize: 96,
  fontWeight: "400",
  align: "center",
  color: "#ffffff",
  letterSpacing: 0,
  lineHeight: 1.05,
  outline: { enabled: true, color: "#111111", width: 8 },
  shadow: { enabled: true, color: "rgba(0,0,0,0.55)", blur: 12, x: 0, y: 6 },
  glow: { enabled: false, color: "#ffcc00", size: 18 },
  ...partial,
});

export const createShapeLayer = (
  shape: ShapeKind,
  x: number,
  y: number,
  width: number,
  height: number,
  extra?: Partial<ShapeLayer>,
): ShapeLayer => ({
  ...base(shape, x, y, width, height),
  type: "shape",
  shape,
  fill: "#ff2d2d",
  stroke: "#ffffff",
  strokeWidth: shape === "line" || shape === "arrow" ? 10 : 0,
  sides: 5,
  radius: 16,
  ...extra,
});

export const selectedLayer = (doc: EditorDocument, id: string | null) =>
  doc.layers.find((l) => l.id === id) ?? null;

export const updateLayer = (
  doc: EditorDocument,
  id: string,
  patch: Partial<Layer>,
): EditorDocument => ({
  ...doc,
  layers: doc.layers.map((l) => (l.id === id ? ({ ...l, ...patch } as Layer) : l)),
});

export const addLayer = (doc: EditorDocument, layer: Layer): EditorDocument => ({
  ...doc,
  layers: [...doc.layers, layer],
});

export const addLayers = (doc: EditorDocument, layers: Layer[]): EditorDocument => ({
  ...doc,
  layers: [...doc.layers, ...layers],
});

export const removeLayer = (doc: EditorDocument, id: string): EditorDocument => ({
  ...doc,
  layers: doc.layers.filter((l) => l.id !== id),
});

export const duplicateLayer = (doc: EditorDocument, id: string): { doc: EditorDocument; id: string } | null => {
  const layer = doc.layers.find((l) => l.id === id);
  if (!layer) return null;
  const copy = { ...structuredClone(layer), id: uid(), name: `${layer.name} copy`, x: layer.x + 24, y: layer.y + 24 };
  const index = doc.layers.findIndex((l) => l.id === id);
  const layers = [...doc.layers];
  layers.splice(index + 1, 0, copy);
  return { doc: { ...doc, layers }, id: copy.id };
};

export const reorderLayer = (doc: EditorDocument, id: string, dir: 1 | -1): EditorDocument => {
  const i = doc.layers.findIndex((l) => l.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= doc.layers.length) return doc;
  const layers = [...doc.layers];
  const [item] = layers.splice(i, 1);
  layers.splice(j, 0, item);
  return { ...doc, layers };
};

export const fitImageInCanvas = (
  imgW: number,
  imgH: number,
  canvasW: number,
  canvasH: number,
  mode: "contain" | "cover" = "cover",
) => {
  const scale =
    mode === "cover"
      ? Math.max(canvasW / imgW, canvasH / imgH)
      : Math.min(canvasW / imgW, canvasH / imgH);
  const width = imgW * scale;
  const height = imgH * scale;
  return {
    x: (canvasW - width) / 2,
    y: (canvasH - height) / 2,
    width,
    height,
  };
};
