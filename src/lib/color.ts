export async function shrinkCover(input: Blob, size = 360): Promise<Blob> {
  const bmp = await createImageBitmap(input);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const scale = Math.max(size / bmp.width, size / bmp.height);
  const w = bmp.width * scale;
  const h = bmp.height * scale;
  ctx.drawImage(bmp, (size - w) / 2, (size - h) / 2, w, h);
  bmp.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("cover encode failed"))), "image/jpeg", 0.86);
  });
}

export function glowFromImage(img: HTMLImageElement | HTMLCanvasElement) {
  const c = document.createElement("canvas");
  c.width = 12;
  c.height = 12;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0, 12, 12);
  const data = ctx.getImageData(0, 0, 12, 12).data;
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    const lum = data[i] * 0.32 + data[i + 1] * 0.5 + data[i + 2] * 0.18;
    if (lum < 18 || lum > 230) continue;
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    n++;
  }
  if (!n) return "#c9893a";
  r /= n;
  g /= n;
  b /= n;
  return `rgb(${r | 0} ${g | 0} ${b | 0})`;
}

const urlCache = new Map<string, string>();

export function cachedObjectUrl(id: string, blob: Blob) {
  const prev = urlCache.get(id);
  if (prev) return prev;
  const url = URL.createObjectURL(blob);
  urlCache.set(id, url);
  return url;
}

export function dropObjectUrl(id: string) {
  const prev = urlCache.get(id);
  if (prev) {
    URL.revokeObjectURL(prev);
    urlCache.delete(id);
  }
}
