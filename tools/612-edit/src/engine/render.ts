import type { Adjustments, DrawLayer, EditorDocument, Layer, ShapeLayer, TextLayer } from "../types";
import { getCachedImage } from "./images";

const checker = (ctx: CanvasRenderingContext2D, w: number, h: number, size = 16) => {
  ctx.save();
  ctx.fillStyle = "#2a2e38";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#23262f";
  for (let y = 0; y < h; y += size) {
    for (let x = 0; x < w; x += size) {
      if (((x / size) + (y / size)) % 2 === 0) ctx.fillRect(x, y, size, size);
    }
  }
  ctx.restore();
};

const cssFilter = (a: Adjustments) => {
  const parts = [
    `brightness(${1 + a.brightness / 100})`,
    `contrast(${1 + a.contrast / 100})`,
    `saturate(${1 + a.saturation / 100})`,
    `hue-rotate(${a.hue}deg)`,
    a.blur > 0 ? `blur(${a.blur}px)` : "",
  ];
  if (a.filter === "mono") parts.push("grayscale(1)");
  if (a.filter === "sepia") parts.push("sepia(0.85)");
  if (a.filter === "invert") parts.push("invert(1)");
  if (a.filter === "vintage") parts.push("sepia(0.35)", "contrast(1.1)", "saturate(0.85)");
  if (a.filter === "cool") parts.push("saturate(1.1)", "hue-rotate(12deg)");
  if (a.filter === "warm") parts.push("sepia(0.18)", "saturate(1.15)");
  if (a.filter === "dramatic") parts.push("contrast(1.35)", "saturate(1.2)");
  if (a.filter === "fade") parts.push("contrast(0.85)", "saturate(0.7)", "brightness(1.08)");
  return parts.filter(Boolean).join(" ");
};

const fillGradient = (
  ctx: CanvasRenderingContext2D,
  layer: Extract<Layer, { type: "fill" }>,
) => {
  if (!layer.gradient) {
    ctx.fillStyle = layer.fill;
    ctx.fillRect(0, 0, layer.width, layer.height);
    return;
  }
  const g = layer.gradient;
  if (g.kind === "radial") {
    const grd = ctx.createRadialGradient(
      layer.width / 2,
      layer.height / 2,
      8,
      layer.width / 2,
      layer.height / 2,
      Math.max(layer.width, layer.height) * 0.72,
    );
    grd.addColorStop(0, g.start);
    grd.addColorStop(1, g.end);
    ctx.fillStyle = grd;
  } else {
    const rad = (g.angle * Math.PI) / 180;
    const cx = layer.width / 2;
    const cy = layer.height / 2;
    const dx = Math.cos(rad) * cx;
    const dy = Math.sin(rad) * cy;
    const grd = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
    grd.addColorStop(0, g.start);
    grd.addColorStop(1, g.end);
    ctx.fillStyle = grd;
  }
  ctx.fillRect(0, 0, layer.width, layer.height);
};

const drawVignette = (ctx: CanvasRenderingContext2D, w: number, h: number, amount: number) => {
  if (amount <= 0) return;
  const grd = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.72);
  grd.addColorStop(0, "rgba(0,0,0,0)");
  grd.addColorStop(1, `rgba(0,0,0,${amount / 120})`);
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, w, h);
};

const starPath = (ctx: CanvasRenderingContext2D, cx: number, cy: number, spikes: number, outer: number, inner: number) => {
  const step = Math.PI / spikes;
  ctx.beginPath();
  for (let i = 0; i < 2 * spikes; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = i * step - Math.PI / 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
};

const polygonPath = (ctx: CanvasRenderingContext2D, cx: number, cy: number, sides: number, r: number) => {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
};

const paintShape = (ctx: CanvasRenderingContext2D, layer: ShapeLayer) => {
  const w = layer.width;
  const h = layer.height;
  ctx.fillStyle = layer.fill;
  ctx.strokeStyle = layer.stroke;
  ctx.lineWidth = layer.strokeWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const stroke = () => {
    if (layer.strokeWidth > 0 && layer.stroke !== "transparent") ctx.stroke();
  };

  switch (layer.shape) {
    case "rect":
      ctx.beginPath();
      ctx.rect(0, 0, w, h);
      ctx.fill();
      stroke();
      break;
    case "roundRect":
    case "badge":
      ctx.beginPath();
      ctx.roundRect(0, 0, w, h, layer.shape === "badge" ? h / 2 : layer.radius);
      ctx.fill();
      stroke();
      break;
    case "ellipse":
      ctx.beginPath();
      ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      stroke();
      break;
    case "triangle":
      ctx.beginPath();
      ctx.moveTo(w / 2, 0);
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      ctx.fill();
      stroke();
      break;
    case "star":
      starPath(ctx, w / 2, h / 2, Math.max(3, layer.sides), Math.min(w, h) / 2, Math.min(w, h) / 4.4);
      ctx.fill();
      stroke();
      break;
    case "polygon":
      polygonPath(ctx, w / 2, h / 2, Math.max(3, layer.sides), Math.min(w, h) / 2);
      ctx.fill();
      stroke();
      break;
    case "line":
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();
      break;
    case "arrow": {
      const head = Math.min(w * 0.28, 48);
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(Math.max(0, w - head), h / 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(w, h / 2);
      ctx.lineTo(w - head, h * 0.12);
      ctx.lineTo(w - head, h * 0.88);
      ctx.closePath();
      ctx.fillStyle = layer.stroke;
      ctx.fill();
      break;
    }
  }
};

export const measureText = (layer: TextLayer) => {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  ctx.font = `${layer.fontWeight} ${layer.fontSize}px ${layer.fontFamily}, sans-serif`;
  const lines = layer.text.split("\n");
  const extra = (layer.outline.enabled ? layer.outline.width : 0) * 2 + (layer.glow.enabled ? layer.glow.size : 0);
  const width = Math.max(
    40,
    ...lines.map((line) => ctx.measureText(line).width + Math.abs(layer.letterSpacing) * line.length),
  ) + extra + 16;
  const height = Math.max(24, lines.length * layer.fontSize * layer.lineHeight + extra + 8);
  return { width, height };
};

const drawText = (ctx: CanvasRenderingContext2D, layer: TextLayer) => {
  const lines = layer.text.split("\n");
  ctx.font = `${layer.fontWeight} ${layer.fontSize}px ${layer.fontFamily}, sans-serif`;
  ctx.textBaseline = "top";
  ctx.textAlign = layer.align;
  (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${layer.letterSpacing}px`;
  const extra = (layer.outline.enabled ? layer.outline.width : 0) + (layer.glow.enabled ? layer.glow.size / 2 : 0);
  const originX = layer.align === "left" ? extra : layer.align === "right" ? layer.width - extra : layer.width / 2;
  const originY = extra;

  const paint = (fill: boolean, stroke: boolean) => {
    lines.forEach((line, i) => {
      const y = originY + i * layer.fontSize * layer.lineHeight;
      if (stroke && layer.outline.enabled) {
        ctx.strokeStyle = layer.outline.color;
        ctx.lineWidth = layer.outline.width * 2;
        ctx.lineJoin = "round";
        ctx.miterLimit = 2;
        ctx.strokeText(line, originX, y);
      }
      if (fill) {
        ctx.fillStyle = layer.color;
        ctx.fillText(line, originX, y);
      }
    });
  };

  if (layer.glow.enabled) {
    ctx.save();
    ctx.shadowColor = layer.glow.color;
    ctx.shadowBlur = layer.glow.size;
    paint(true, false);
    ctx.restore();
  }
  if (layer.shadow.enabled) {
    ctx.save();
    ctx.shadowColor = layer.shadow.color;
    ctx.shadowBlur = layer.shadow.blur;
    ctx.shadowOffsetX = layer.shadow.x;
    ctx.shadowOffsetY = layer.shadow.y;
    paint(true, false);
    ctx.restore();
  }
  paint(true, true);
};

const drawLayer = (ctx: CanvasRenderingContext2D, layer: Layer) => {
  if (layer.type === "fill") {
    fillGradient(ctx, layer);
    return;
  }
  if (layer.type === "shape") {
    paintShape(ctx, layer);
    return;
  }
  if (layer.type === "text") {
    drawText(ctx, layer);
    return;
  }
  if (layer.type === "draw") {
    const img = getCachedImage(layer.src);
    if (img) ctx.drawImage(img, 0, 0, layer.width, layer.height);
    return;
  }
  const img = getCachedImage(layer.src);
  if (!img) return;
  ctx.save();
  if (layer.flipH || layer.flipV) {
    ctx.translate(layer.flipH ? layer.width : 0, layer.flipV ? layer.height : 0);
    ctx.scale(layer.flipH ? -1 : 1, layer.flipV ? -1 : 1);
  }
  ctx.filter = cssFilter(layer.adjustments);
  ctx.drawImage(img, 0, 0, layer.width, layer.height);
  ctx.filter = "none";
  const temp = layer.adjustments.temperature;
  if (temp !== 0) {
    ctx.globalCompositeOperation = temp > 0 ? "soft-light" : "multiply";
    ctx.fillStyle = temp > 0 ? `rgba(255,160,60,${Math.min(0.45, temp / 180)})` : `rgba(60,120,255,${Math.min(0.35, -temp / 180)})`;
    ctx.fillRect(0, 0, layer.width, layer.height);
    ctx.globalCompositeOperation = "source-over";
  }
  drawVignette(ctx, layer.width, layer.height, layer.adjustments.vignette);
  ctx.restore();
};

export const renderDocument = (
  ctx: CanvasRenderingContext2D,
  doc: EditorDocument,
  opts?: { checkerboard?: boolean; clip?: boolean },
) => {
  if (opts?.checkerboard) checker(ctx, doc.width, doc.height);
  else {
    ctx.clearRect(0, 0, doc.width, doc.height);
  }
  ctx.save();
  if (opts?.clip !== false) {
    ctx.beginPath();
    ctx.rect(0, 0, doc.width, doc.height);
    ctx.clip();
  }
  for (const layer of doc.layers) {
    if (!layer.visible) continue;
    ctx.save();
    ctx.globalAlpha = layer.opacity;
    ctx.globalCompositeOperation = layer.blendMode;
    const cx = layer.x + layer.width / 2;
    const cy = layer.y + layer.height / 2;
    ctx.translate(cx, cy);
    ctx.rotate((layer.rotation * Math.PI) / 180);
    ctx.translate(-layer.width / 2, -layer.height / 2);
    drawLayer(ctx, layer);
    ctx.restore();
  }
  ctx.restore();
};

export const flattenToCanvas = (doc: EditorDocument) => {
  const canvas = document.createElement("canvas");
  canvas.width = doc.width;
  canvas.height = doc.height;
  const ctx = canvas.getContext("2d")!;
  renderDocument(ctx, doc, { checkerboard: false });
  return canvas;
};

export const rasterizeDrawLayer = (layer: DrawLayer) => {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(layer.width));
  canvas.height = Math.max(1, Math.round(layer.height));
  const ctx = canvas.getContext("2d")!;
  const img = getCachedImage(layer.src);
  if (img) ctx.drawImage(img, 0, 0);
  return canvas;
};
