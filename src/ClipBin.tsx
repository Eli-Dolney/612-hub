import { useEffect, useState } from "react";
import { Flag, Plus, Trash2 } from "lucide-react";
import { fmtDur, parseTime } from "./api";
import type { Clip } from "./types";

const QUICK: { label: string; seconds: number | "first_min" }[] = [
  { label: "2s", seconds: 2 },
  { label: "5s", seconds: 5 },
  { label: "10s", seconds: 10 },
  { label: "30s", seconds: 30 },
  { label: "1m", seconds: 60 },
  { label: "First minute", seconds: "first_min" },
];

function ClipRow({
  clip,
  index,
  duration,
  busy,
  onSeek,
  onToggle,
  onSave,
  onDelete,
  onPatch,
}: {
  clip: Clip;
  index: number;
  duration: number;
  busy: boolean;
  onSeek: (time: number) => void;
  onToggle: (clip: Clip) => void;
  onSave: (clip: Clip) => void;
  onDelete: (clip: Clip) => void;
  onPatch: (clip: Clip, start: number, end: number) => void;
}) {
  const [startDraft, setStartDraft] = useState(clip.start.toFixed(1));
  const [endDraft, setEndDraft] = useState(clip.end.toFixed(1));

  useEffect(() => {
    setStartDraft(clip.start.toFixed(1));
    setEndDraft(clip.end.toFixed(1));
  }, [clip.start, clip.end]);

  const commit = (which: "start" | "end", raw: string) => {
    const parsed = parseTime(raw, duration);
    if (parsed == null) {
      if (which === "start") setStartDraft(clip.start.toFixed(1));
      else setEndDraft(clip.end.toFixed(1));
      return;
    }
    const start = which === "start" ? parsed : clip.start;
    const end = which === "end" ? parsed : clip.end;
    if (Math.abs(start - clip.start) < 0.01 && Math.abs(end - clip.end) < 0.01) return;
    if (Math.abs(end - start) < 0.05) {
      setStartDraft(clip.start.toFixed(1));
      setEndDraft(clip.end.toFixed(1));
      return;
    }
    onPatch(clip, Math.min(start, end), Math.max(start, end));
  };

  return (
    <li className={clip.kept ? "kept" : "skipped"}>
      <button className="time" onClick={() => onSeek(clip.start)}>
        {index + 1}
      </button>
      <div className="clip-row-body">
        <button className="text" onClick={() => onSeek(clip.start)}>
          <strong>{clip.label}</strong>
          <em>{fmtDur(clip.duration)}</em>
        </button>
        <div className="clip-row-times">
          <input
            className="clip-time"
            value={startDraft}
            onChange={(e) => setStartDraft(e.target.value)}
            onBlur={(e) => commit("start", e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && commit("start", startDraft)}
            title="Start"
          />
          <span className="muted">–</span>
          <input
            className="clip-time"
            value={endDraft}
            onChange={(e) => setEndDraft(e.target.value)}
            onBlur={(e) => commit("end", e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && commit("end", endDraft)}
            title="End"
          />
        </div>
      </div>
      <button className={clip.kept ? "tiny on" : "tiny"} onClick={() => onToggle(clip)}>
        {clip.kept ? "Keep" : "Drop"}
      </button>
      <button className="tiny" disabled={busy} onClick={() => onSave(clip)}>
        Save
      </button>
      <button className="tiny danger" onClick={() => onDelete(clip)} aria-label="Remove clip">
        <Trash2 size={12} />
      </button>
    </li>
  );
}

export default function ClipBin({
  clips,
  duration,
  current,
  markIn,
  markOut,
  busy,
  onMarkIn,
  onMarkOut,
  onSetMarks,
  onAdd,
  onQuickAdd,
  onToggle,
  onDelete,
  onSave,
  onSeek,
  onPatch,
}: {
  clips: Clip[];
  duration: number;
  current: number;
  markIn: number | null;
  markOut: number | null;
  busy: boolean;
  onMarkIn: () => void;
  onMarkOut: () => void;
  onSetMarks: (start: number | null, end: number | null) => void;
  onAdd: () => void;
  onQuickAdd: (start: number, end: number) => void;
  onToggle: (clip: Clip) => void;
  onDelete: (clip: Clip) => void;
  onSave: (clip: Clip) => void;
  onSeek: (time: number) => void;
  onPatch: (clip: Clip, start: number, end: number) => void;
}) {
  const [inDraft, setInDraft] = useState("");
  const [outDraft, setOutDraft] = useState("");
  const span = markIn != null && markOut != null ? Math.abs(markOut - markIn) : 0;
  const canAdd = markIn != null && markOut != null && span >= 0.05 && !busy;

  useEffect(() => {
    setInDraft(markIn == null ? "" : markIn.toFixed(1));
    setOutDraft(markOut == null ? "" : markOut.toFixed(1));
  }, [markIn, markOut]);

  const commit = (which: "in" | "out", raw: string) => {
    const parsed = parseTime(raw, duration);
    if (parsed == null) {
      if (which === "in") setInDraft(markIn == null ? "" : markIn.toFixed(1));
      else setOutDraft(markOut == null ? "" : markOut.toFixed(1));
      return;
    }
    if (which === "in") onSetMarks(parsed, markOut);
    else onSetMarks(markIn, parsed);
  };

  const quick = (seconds: number | "first_min") => {
    if (busy || !duration) return;
    if (seconds === "first_min") {
      const end = Math.min(60, duration);
      if (end < 0.05) return;
      onQuickAdd(0, end);
      return;
    }
    const start = Math.max(0, Math.min(current, Math.max(0, duration - 0.05)));
    const end = Math.min(duration, start + seconds);
    if (end - start < 0.05) return;
    onQuickAdd(start, end);
  };

  return (
    <div className="clip-bin">
      <div className="clip-marks">
        <button className="tiny" onClick={onMarkIn} title="I — mark in at playhead">
          <Flag size={12} />
          In
        </button>
        <button className="tiny" onClick={onMarkOut} title="O — mark out at playhead">
          <Flag size={12} />
          Out
        </button>
        <input
          className="clip-time"
          value={inDraft}
          placeholder="start s"
          onChange={(e) => setInDraft(e.target.value)}
          onBlur={(e) => commit("in", e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && commit("in", inDraft)}
        />
        <span className="muted">–</span>
        <input
          className="clip-time"
          value={outDraft}
          placeholder="end s"
          onChange={(e) => setOutDraft(e.target.value)}
          onBlur={(e) => commit("out", e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && commit("out", outDraft)}
        />
        <em>{span >= 0.05 ? fmtDur(span) : fmtDur(current)}</em>
        <button className="pull" disabled={!canAdd} onClick={onAdd} title="Enter — add clip">
          <Plus size={14} />
          Add clip
        </button>
        <button
          className="tiny"
          disabled={markIn == null && markOut == null}
          onClick={() => onSetMarks(null, null)}
        >
          Clear
        </button>
      </div>
      <div className="chip-row wrap clip-quick">
        {QUICK.map((row) => (
          <button
            key={row.label}
            className="tiny"
            disabled={busy || !duration}
            onClick={() => quick(row.seconds)}
            title={
              row.seconds === "first_min"
                ? "Add 0:00–1:00"
                : `Add ${row.label} from playhead`
            }
          >
            {row.label}
          </button>
        ))}
      </div>
      <p className="hint clip-hint">
        Chips grab from the playhead (or the first minute). In/Out and drag still work for odd lengths. Edit start/end on
        a row. <b>Save</b> writes one file; <b>Export kept clips</b> concatenates kept ranges.
      </p>
      {clips.length > 0 && (
        <ul className="clip-list">
          {clips.map((clip, i) => (
            <ClipRow
              key={clip.id}
              clip={clip}
              index={i}
              duration={duration}
              busy={busy}
              onSeek={onSeek}
              onToggle={onToggle}
              onSave={onSave}
              onDelete={onDelete}
              onPatch={onPatch}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
