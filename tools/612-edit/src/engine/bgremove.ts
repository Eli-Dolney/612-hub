import { loadImage } from "./images";

const colorDist = (r: number, g: number, b: number, tr: number, tg: number, tb: number) => {
  const dr = r - tr;
  const dg = g - tg;
  const db = b - tb;
  return Math.sqrt(dr * dr + dg * dg + db * db);
};

export async function removeSimilarColor(
  src: string,
  rgb: [number, number, number],
  tolerance: number,
): Promise<string> {
  const img = await loadImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    if (colorDist(px[i], px[i + 1], px[i + 2], rgb[0], rgb[1], rgb[2]) <= tolerance) {
      px[i + 3] = 0;
    }
  }
  ctx.putImageData(data, 0, 0);
  return canvas.toDataURL("image/png");
}

export async function floodRemove(
  src: string,
  nx: number,
  ny: number,
  tolerance: number,
): Promise<string> {
  const img = await loadImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  const w = canvas.width;
  const h = canvas.height;
  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;
  const x = Math.max(0, Math.min(w - 1, Math.round(nx * w)));
  const y = Math.max(0, Math.min(h - 1, Math.round(ny * h)));
  const i0 = (y * w + x) * 4;
  const tr = px[i0];
  const tg = px[i0 + 1];
  const tb = px[i0 + 2];
  const seen = new Uint8Array(w * h);
  const stack = [x, y];
  while (stack.length) {
    const cy = stack.pop()!;
    const cx = stack.pop()!;
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
    const idx = cy * w + cx;
    if (seen[idx]) continue;
    seen[idx] = 1;
    const i = idx * 4;
    if (colorDist(px[i], px[i + 1], px[i + 2], tr, tg, tb) > tolerance) continue;
    px[i + 3] = 0;
    stack.push(cx + 1, cy, cx - 1, cy, cx, cy + 1, cx, cy - 1);
  }
  ctx.putImageData(data, 0, 0);
  return canvas.toDataURL("image/png");
}

export function samplePixel(
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
): [number, number, number, number] {
  const ctx = canvas.getContext("2d")!;
  const p = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
  return [p[0], p[1], p[2], p[3]];
}

export const rgbToHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
