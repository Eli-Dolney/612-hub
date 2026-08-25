import { useEffect, useRef, useState } from "react";
import type { Clip, Range } from "./types";

function timeAt(clientX: number, box: DOMRect, duration: number) {
  return Math.max(0, Math.min(duration, ((clientX - box.left) / box.width) * duration));
}

export default function Waveform({
  peaks,
  duration,
  current = 0,
  ranges = [],
  clips = [],
  markIn = null,
  markOut = null,
  onSeek,
  onSelectRange,
}: {
  peaks: number[];
  duration: number;
  current?: number;
  ranges?: Range[];
  clips?: Clip[];
  markIn?: number | null;
  markOut?: number | null;
  onSeek?: (time: number) => void;
  onSelectRange?: (start: number, end: number) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ startT: number; lastT: number; moved: boolean } | null>(null);
  const [draft, setDraft] = useState<[number, number] | null>(null);

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
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const xOf = (t: number) => (duration > 0 ? (t / duration) * width : 0);

    if (!clips.length) {
      ctx.fillStyle = "rgba(251, 191, 36, 0.12)";
      for (const range of ranges) {
        if (!duration) continue;
        const x = xOf(range.start);
        const w = Math.max(2, xOf(range.end) - x);
        ctx.fillRect(x, 0, w, height);
      }
    }

    for (const clip of clips) {
      if (!duration) continue;
      const x = xOf(clip.start);
      const w = Math.max(3, xOf(clip.end) - x);
      ctx.fillStyle = clip.kept ? "rgba(251, 191, 36, 0.22)" : "rgba(255, 107, 122, 0.16)";
      ctx.fillRect(x, 0, w, height);
      ctx.fillStyle = clip.kept ? "#f5a524" : "rgba(255, 107, 122, 0.7)";
      ctx.fillRect(x, height - 3, w, 3);
      if (w > 36) {
        ctx.fillStyle = "rgba(244, 239, 230, 0.85)";
        ctx.font = "10px Inter, system-ui, sans-serif";
        ctx.fillText(clip.label, x + 4, 12, w - 8);
      }
    }

    const selA = draft ? draft[0] : markIn;
    const selB = draft ? draft[1] : markOut;
    if (duration && selA != null && selB != null && Math.abs(selB - selA) >= 0.04) {
      const a = Math.min(selA, selB);
      const b = Math.max(selA, selB);
      ctx.fillStyle = "rgba(252, 211, 77, 0.18)";
      ctx.fillRect(xOf(a), 0, Math.max(2, xOf(b) - xOf(a)), height);
    }
    if (duration && selA != null) {
      ctx.fillStyle = "#4ade80";
      ctx.fillRect(xOf(selA), 0, 2, height);
    }
    if (duration && selB != null) {
      ctx.fillStyle = "#ff6b7a";
      ctx.fillRect(xOf(selB), 0, 2, height);
    }

    const data = peaks.length ? peaks : Array.from({ length: 120 }, () => 0.08);
    const gap = 1;
    const bar = Math.max(1, width / data.length - gap);
    const mid = height / 2;
    const progress = duration > 0 ? current / duration : 0;
    data.forEach((p, i) => {
      const x = (i / data.length) * width;
      const h = Math.max(2, p * (height * 0.86));
      const played = i / data.length <= progress;
      ctx.fillStyle = played ? "#f5a524" : "rgba(236,238,243,0.22)";
      ctx.fillRect(x, mid - h / 2, bar, h);
    });

    if (duration > 0) {
      const px = progress * width;
      ctx.fillStyle = "#fff6d8";
      ctx.fillRect(px, 0, 1.5, height);
    }
  }, [peaks, duration, current, ranges, clips, markIn, markOut, draft]);

  return (
    <canvas
      ref={ref}
      className="wave"
      onPointerDown={(event) => {
        if (!duration) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        const t = timeAt(event.clientX, event.currentTarget.getBoundingClientRect(), duration);
        drag.current = { startT: t, lastT: t, moved: false };
        setDraft(null);
      }}
      onPointerMove={(event) => {
        if (!drag.current || !duration) return;
        const t = timeAt(event.clientX, event.currentTarget.getBoundingClientRect(), duration);
        if (Math.abs(t - drag.current.startT) > 0.08) drag.current.moved = true;
        drag.current.lastT = t;
        if (drag.current.moved) {
          setDraft([Math.min(drag.current.startT, t), Math.max(drag.current.startT, t)]);
        }
      }}
      onPointerUp={() => {
        const state = drag.current;
        drag.current = null;
        setDraft(null);
        if (!state || !duration) return;
        if (state.moved && onSelectRange) {
          const a = Math.min(state.startT, state.lastT);
          const b = Math.max(state.startT, state.lastT);
          if (b - a >= 0.05) onSelectRange(a, b);
          return;
        }
        onSeek?.(state.startT);
      }}
    />
  );
}
