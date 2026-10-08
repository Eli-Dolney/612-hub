import type { EditorDocument, Layer } from "../types";

const rotatePoint = (px: number, py: number, cx: number, cy: number, deg: number) => {
  const r = (deg * Math.PI) / 180;
  const x = px - cx;
  const y = py - cy;
  return {
    x: cx + x * Math.cos(r) - y * Math.sin(r),
    y: cy + x * Math.sin(r) + y * Math.cos(r),
  };
};

export const layerBounds = (layer: Layer) => ({
  x: layer.x,
  y: layer.y,
  w: layer.width,
  h: layer.height,
  cx: layer.x + layer.width / 2,
  cy: layer.y + layer.height / 2,
});

export const pointInLayer = (layer: Layer, x: number, y: number) => {
  const { cx, cy } = layerBounds(layer);
  const p = rotatePoint(x, y, cx, cy, -layer.rotation);
  return p.x >= layer.x && p.x <= layer.x + layer.width && p.y >= layer.y && p.y <= layer.y + layer.height;
};

export const hitTest = (doc: EditorDocument, x: number, y: number): Layer | null => {
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const layer = doc.layers[i];
    if (!layer.visible || layer.locked) continue;
    if (pointInLayer(layer, x, y)) return layer;
  }
  return null;
};

export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "rotate";

export const handlePositions = (layer: Layer, zoom: number) => {
  const { cx, cy } = layerBounds(layer);
  const local = [
    ["nw", layer.x, layer.y],
    ["n", cx, layer.y],
    ["ne", layer.x + layer.width, layer.y],
    ["e", layer.x + layer.width, cy],
    ["se", layer.x + layer.width, layer.y + layer.height],
    ["s", cx, layer.y + layer.height],
    ["sw", layer.x, layer.y + layer.height],
    ["w", layer.x, cy],
    ["rotate", cx, layer.y - 28 / zoom],
  ] as const;
  const out: Record<Handle, { x: number; y: number }> = {} as Record<Handle, { x: number; y: number }>;
  for (const [name, px, py] of local) {
    out[name] = rotatePoint(px, py, cx, cy, layer.rotation);
  }
  return out;
};

export const hitHandle = (layer: Layer, x: number, y: number, zoom: number): Handle | null => {
  const handles = handlePositions(layer, zoom);
  const thresh = 10 / zoom;
  for (const [name, p] of Object.entries(handles) as [Handle, { x: number; y: number }][]) {
    if (Math.hypot(p.x - x, p.y - y) <= thresh) return name;
  }
  return null;
};

export const applyResize = (
  layer: Layer,
  handle: Handle,
  dx: number,
  dy: number,
): Partial<Layer> => {
  let { x, y, width, height } = layer;
  const min = 12;
  if (handle.includes("w")) {
    const nw = Math.max(min, width - dx);
    x += width - nw;
    width = nw;
  }
  if (handle.includes("e")) width = Math.max(min, width + dx);
  if (handle.includes("n")) {
    const nh = Math.max(min, height - dy);
    y += height - nh;
    height = nh;
  }
  if (handle.includes("s")) height = Math.max(min, height + dy);
  return { x, y, width, height };
};
