import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Minus, Plus, ScanLine } from "lucide-react";
import { fmtDur } from "./api";
import type { Clip, Range } from "./types";

type Times = { start: number; end: number };
type Edge = "start" | "end";
type Gesture = { x: number; anchor: number; edge?: Edge; trim?: Times };
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const ZOOM = [1, 2, 4, 8, 16, 32, 64];

export default function Waveform({
  peaks, duration, current, ranges, clips, markIn, markOut, selected, busy,
  onSeek, onSelectRange, onSelectClip, onTrimClip,
}: {
  peaks: number[];
  duration: number;
  current: number;
  ranges: Range[];
  clips: Clip[];
  markIn: number | null;
  markOut: number | null;
  selected?: Clip;
  busy: boolean;
  onSeek: (time: number) => void;
  onSelectRange: (start: number, end: number) => void;
  onSelectClip: (clip: Clip) => void;
  onTrimClip: (clip: Clip, start: number, end: number) => void;
}) {
  const plot = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [zoom, setZoom] = useState(0);
  const [offset, setOffset] = useState(0);
  const [draft, setDraft] = useState<Times | null>(null);
  const span = duration / ZOOM[zoom];
  const maxOffset = Math.max(0, duration - span);
  const start = clamp(offset, 0, maxOffset);
  const end = start + span;
  const percent = (t: number) => span > 0 ? (t - start) * 100 / span : 0;
  const marks = markIn != null && markOut != null && markIn !== markOut
    ? { start: Math.min(markIn, markOut), end: Math.max(markIn, markOut) } : null;
  const bounds = draft ?? marks ?? selected;
  const step = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600].find((t) => t >= span / 7) ?? span / 7;
  const ticks = duration ? Array.from({ length: 8 }, (_, index) => (Math.ceil(start / step) + index) * step)
    .filter((time) => time <= end) : [];
  const visible = clips.filter((clip) => clip.end > start && clip.start < end);
  const laneEnds: number[] = [];
  const blocks = visible.map((clip) => {
    let lane = laneEnds.findIndex((time) => time <= clip.start);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = clip.end;
    return { clip, lane };
  });

  useEffect(() => {
    if (selected && (selected.start < start || selected.start >= end)) {
      setOffset(clamp(selected.start - span * 0.14, 0, maxOffset));
    }
    // Follow a newly selected clip. Panning should remain independent afterward.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  useEffect(() => {
    const node = canvas.current;
    if (!node || !node.parentElement) return;
    const draw = () => {
      const width = node.clientWidth;
      const height = node.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      if (!width || !height) return;
      node.width = Math.round(width * dpr);
      node.height = Math.round(height * dpr);
      const ctx = node.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.fillStyle = "#8293a9";
      ctx.globalAlpha = 0.63;
      const stride = 3;
      for (let x = 1; x < width; x += stride) {
        const t = start + span * x / width;
        const index = Math.min(peaks.length - 1, Math.floor(t / duration * peaks.length));
        const h = Math.max(2, (peaks[index] || 0) * (height - 14));
        ctx.fillRect(x, (height - h) / 2, 1.5, h);
      }
    };
    draw();
    const resize = new ResizeObserver(draw);
    resize.observe(node);
    return () => resize.disconnect();
  }, [duration, peaks, span, start]);

  const timeAt = (x: number) => {
    const box = plot.current?.getBoundingClientRect();
    return box?.width ? start + clamp((x - box.left) / box.width, 0, 1) * span : start;
  };
  const changeZoom = (next: number) => {
    const nextSpan = duration / ZOOM[next];
    const anchor = current >= start && current <= end ? current : (start + end) / 2;
    setOffset(clamp(anchor - nextSpan / 2, 0, duration - nextSpan));
    setZoom(next);
  };
  const trim = (range: Times, edge: Edge, time: number) => edge === "start"
    ? { ...range, start: clamp(time, 0, range.end - 0.05) }
    : { ...range, end: clamp(time, range.start + 0.05, duration) };
  const commit = (range: Times, editingSavedClip: boolean) => {
    if (editingSavedClip && selected) onTrimClip(selected, range.start, range.end);
    else onSelectRange(range.start, range.end);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const drag = gesture.current;
    if (!drag || Math.abs(event.clientX - drag.x) < 3 && !draft) return;
    const time = timeAt(event.clientX);
    setDraft(drag.edge && drag.trim
      ? trim(drag.trim, drag.edge, time)
      : { start: Math.min(drag.anchor, time), end: Math.max(drag.anchor, time) });
  };
  const reset = () => { gesture.current = null; setDraft(null); };

  return (
    <section className="timeline" aria-label="Clip timeline">
      <div className="timeline-head">
        <h2>Timeline</h2>
        <span className="timeline-window">{fmtDur(start)} – {fmtDur(end)}</span>
        <div className="timeline-tools">
          <button type="button" className="ghost icon" aria-label="Zoom out" disabled={!zoom || !duration} onClick={() => changeZoom(zoom - 1)}><Minus size={15} /></button>
          <span className="zoom-value">{ZOOM[zoom]}×</span>
          <button type="button" className="ghost icon" aria-label="Zoom in" disabled={zoom === ZOOM.length - 1 || span <= 0.5} onClick={() => changeZoom(zoom + 1)}><Plus size={15} /></button>
          <button type="button" className="ghost" disabled={!zoom} onClick={() => changeZoom(0)}><ScanLine size={14} /> Fit</button>
        </div>
      </div>
      <div className="timeline-ruler" aria-hidden="true">
        {ticks.map((t) => <span key={t} style={{ left: clamp(percent(t), 0, 100) + "%" }}>{fmtDur(t)}</span>)}
      </div>
      <div
        className="timeline-plot"
        ref={plot}
        role="group"
        aria-label="Waveform"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget || !duration) return;
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            onSeek(clamp(current + (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 5 : 0.1), 0, duration));
          }
        }}
        onPointerDown={(event) => {
          if (!duration || event.button !== 0) return;
          const time = timeAt(event.clientX);
          gesture.current = { x: event.clientX, anchor: time };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={move}
        onPointerCancel={reset}
        onLostPointerCapture={reset}
        onPointerUp={(event) => {
          const drag = gesture.current;
          if (!drag) return;
          const moved = Math.abs(event.clientX - drag.x) >= 3 || draft !== null;
          const time = timeAt(event.clientX);
          reset();
          if (drag.edge && drag.trim) {
            if (moved) commit(trim(drag.trim, drag.edge, time), !marks);
          } else if (moved && Math.abs(time - drag.anchor) >= 0.05) {
            onSelectRange(Math.min(time, drag.anchor), Math.max(time, drag.anchor));
          } else onSeek(drag.anchor);
        }}
      >
        <canvas className="wave" ref={canvas} aria-hidden="true" />
        {ticks.map((t) => <i className="timeline-gridline" key={t} style={{ left: percent(t) + "%" }} />)}
        {!clips.length && ranges.filter((range) => range.end > start && range.start < end).map((range, index) => (
          <i key={index} className="timeline-guided" style={{ left: Math.max(0, percent(range.start)) + "%", right: Math.max(0, 100 - percent(range.end)) + "%" }} />
        ))}
        {bounds && bounds.end > start && bounds.start < end && (
          <div className="timeline-selection" style={{ left: Math.max(0, percent(bounds.start)) + "%", right: Math.max(0, 100 - percent(bounds.end)) + "%" }} />
        )}
        {!bounds && (markIn ?? markOut) != null && <i className="timeline-mark" style={{ left: percent((markIn ?? markOut)!) + "%" }} />}
        {duration > 0 && current >= start && current <= end && <i className="timeline-playhead" style={{ left: percent(current) + "%" }} />}
        {bounds && (marks || selected) && (["start", "end"] as const).map((edge) => {
          const position = percent(bounds[edge]);
          if (position < 0 || position > 100) return null;
          return (
            <button
              type="button" key={edge} className={"timeline-handle " + edge}
              aria-label={"Trim " + edge} title={(edge === "start" ? "Start " : "End ") + fmtDur(bounds[edge])}
              style={{ left: position + "%" }} disabled={busy && !marks}
              onPointerDown={(event) => {
                event.stopPropagation();
                if (event.button !== 0) return;
                gesture.current = { x: event.clientX, anchor: bounds[edge], edge, trim: bounds };
                plot.current?.setPointerCapture(event.pointerId);
              }}
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                event.preventDefault();
                const delta = (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 1 : 0.1);
                commit(trim(bounds, edge, bounds[edge] + delta), !marks);
              }}
            />
          );
        })}
      </div>
      {blocks.length > 0 && (
        <div className="timeline-tracks" aria-label="Saved clips">
          <div style={{ height: laneEnds.length * 29 }}>
            {blocks.map(({ clip, lane }) => (
              <button
                type="button" key={clip.id}
                className={"timeline-clip" + (clip.id === selected?.id ? " active" : "") + (clip.kept ? "" : " omitted")}
                aria-pressed={clip.id === selected?.id}
                title={clip.label + " · " + fmtDur(clip.start) + " to " + fmtDur(clip.end)}
                style={{ left: Math.max(0, percent(clip.start)) + "%", right: Math.max(0, 100 - percent(clip.end)) + "%", top: lane * 29 }}
                onClick={() => onSelectClip(clip)}
              >
                {clip.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {zoom > 0 && <input className="timeline-scroll" type="range" min={0} max={maxOffset} step="any" value={start} aria-label="Scroll timeline" onChange={(e) => setOffset(e.target.valueAsNumber)} />}
    </section>
  );
}
