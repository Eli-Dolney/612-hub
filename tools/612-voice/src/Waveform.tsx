import { useEffect, useRef } from "react";

export default function Waveform({
  peaks,
  progress = 0,
  color = "#f0b429",
}: {
  peaks: number[];
  progress?: number;
  color?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    const dpr = window.devicePixelRatio || 1;
    const width = parent?.clientWidth || 600;
    const height = 72;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);
    const data = peaks.length ? peaks : Array.from({ length: 120 }, () => 0.08);
    const gap = 1;
    const bar = Math.max(1, width / data.length - gap);
    const mid = height / 2;
    data.forEach((p, i) => {
      const x = (i / data.length) * width;
      const h = Math.max(2, p * (height * 0.86));
      const played = i / data.length <= progress;
      ctx.fillStyle = played ? color : "rgba(236,238,243,0.22)";
      ctx.fillRect(x, mid - h / 2, bar, h);
    });
  }, [peaks, progress, color]);

  return <canvas ref={ref} className="wave" />;
}
