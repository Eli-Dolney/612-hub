import type { VisMode } from "./types";

const freq = new Uint8Array(1024);
const time = new Uint8Array(2048);
const particles: { x: number; y: number; vx: number; vy: number; life: number }[] = [];

function color(ctx: CanvasRenderingContext2D) {
  const glow = getComputedStyle(document.documentElement).getPropertyValue("--glow").trim() || "#e8a54b";
  return glow;
}

export function drawVis(
  ctx: CanvasRenderingContext2D,
  analyser: AnalyserNode,
  mode: VisMode,
  w: number,
  h: number,
  playing: boolean,
) {
  analyser.getByteFrequencyData(freq);
  analyser.getByteTimeDomainData(time);
  const glow = color(ctx);
  ctx.clearRect(0, 0, w, h);

  if (mode === "bars") {
    const n = 72;
    const gap = 2;
    const bw = (w - gap * n) / n;
    ctx.fillStyle = glow;
    for (let i = 0; i < n; i++) {
      const v = freq[Math.floor((i / n) * 90)] / 255;
      const bh = Math.max(2, v * v * h * 0.72);
      const x = i * (bw + gap);
      const y = h - bh;
      ctx.globalAlpha = 0.35 + v * 0.65;
      roundRect(ctx, x, y, bw, bh, 3);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    return;
  }

  if (mode === "wave") {
    ctx.beginPath();
    ctx.lineWidth = 2;
    ctx.strokeStyle = glow;
    const slice = w / time.length;
    for (let i = 0; i < time.length; i++) {
      const v = (time[i] - 128) / 128;
      const x = i * slice;
      const y = h / 2 + v * h * 0.38;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.globalAlpha = 0.9;
    ctx.stroke();
    ctx.globalAlpha = 0.18;
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = glow;
    ctx.fill();
    ctx.globalAlpha = 1;
    return;
  }

  if (mode === "radial") {
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(w, h) * 0.18;
    const n = 96;
    ctx.strokeStyle = glow;
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    for (let i = 0; i < n; i++) {
      const v = freq[Math.floor((i / n) * 100)] / 255;
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      const inner = r;
      const outer = r + v * Math.min(w, h) * 0.28;
      ctx.globalAlpha = 0.3 + v * 0.7;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      ctx.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    return;
  }

  if (mode === "particles") {
    const bass = (freq[2] + freq[4] + freq[8]) / 3 / 255;
    if (playing && Math.random() < 0.35 + bass * 0.6) {
      for (let i = 0; i < 3; i++) {
        particles.push({
          x: w / 2,
          y: h / 2,
          vx: (Math.random() - 0.5) * (1.4 + bass * 6),
          vy: (Math.random() - 0.5) * (1.4 + bass * 6),
          life: 1,
        });
      }
    }
    ctx.fillStyle = glow;
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 0.01;
      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      ctx.globalAlpha = p.life * 0.8;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.6 + bass * 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (particles.length > 400) particles.splice(0, particles.length - 400);
    return;
  }

  if (mode === "aurora") {
    const bands = 5;
    for (let b = 0; b < bands; b++) {
      ctx.beginPath();
      const base = h * (0.35 + b * 0.1);
      ctx.moveTo(0, h);
      for (let x = 0; x <= w; x += 8) {
        const idx = Math.floor((x / w) * 80) + b * 8;
        const v = freq[idx] / 255;
        const y = base - v * h * 0.28 - Math.sin(x * 0.01 + b) * 8;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.globalAlpha = 0.12 + b * 0.05;
      ctx.fillStyle = glow;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    return;
  }

  // spectrogram-ish columns
  const colW = 3;
  const img = ctx.getImageData(colW, 0, Math.max(1, w - colW), h);
  ctx.putImageData(img, 0, 0);
  const rgb = parseRgb(glow);
  for (let y = 0; y < h; y++) {
    const idx = Math.floor((1 - y / h) * 90);
    const v = freq[idx] / 255;
    ctx.fillStyle = `rgba(${rgb}, ${v * 0.85})`;
    ctx.fillRect(w - colW, y, colW, 1);
  }
}

function parseRgb(c: string) {
  const m = c.match(/(\d+)[^\d]+(\d+)[^\d]+(\d+)/);
  if (!m) return "232, 165, 75";
  return `${m[1]}, ${m[2]}, ${m[3]}`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}
