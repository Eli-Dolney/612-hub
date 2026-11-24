import { useEffect, useState, type FormEvent } from "react";
import { Flag, Play, Plus, Trash2 } from "lucide-react";
import { fmtDur, parseClipRanges, parseTime, type ClipRange } from "./api";
import type { Clip, Segment } from "./types";

const QUICK: { label: string; seconds: number | "first_min" }[] = [
  { label: "2s", seconds: 2 },
  { label: "5s", seconds: 5 },
  { label: "10s", seconds: 10 },
  { label: "30s", seconds: 30 },
  { label: "1m", seconds: 60 },
  { label: "First minute", seconds: "first_min" },
];

export function clipCaptionHint(clip: Clip, segments: Segment[], captionsOn: boolean): "burn" | "broll" | "need" | "off" {
  const kind = clip.kind || "talk";
  if (kind === "broll") return "broll";
  if (!captionsOn && kind !== "intro") return "off";
  const speech = segments.some((s) => s.end > clip.start && s.start < clip.end && s.text.trim());
  return speech ? "burn" : "need";
}

function ClipRow({
  clip,
  index,
  duration,
  busy,
  selected,
  hint,
  onToggle,
  onSave,
  onDelete,
  onPatch,
  onKind,
  onRename,
  onSelect,
}: {
  clip: Clip;
  index: number;
  duration: number;
  busy: boolean;
  selected: boolean;
  hint: ReturnType<typeof clipCaptionHint>;
  onToggle: (clip: Clip) => void;
  onSave: (clip: Clip) => void;
  onDelete: (clip: Clip) => void;
  onPatch: (clip: Clip, start: number, end: number) => void;
  onKind: (clip: Clip, kind: string) => void;
  onRename: (clip: Clip, label: string) => void;
  onSelect: (clip: Clip) => void;
}) {
  const [startDraft, setStartDraft] = useState(String(clip.start));
  const [endDraft, setEndDraft] = useState(String(clip.end));
  const [labelDraft, setLabelDraft] = useState(clip.label);

  useEffect(() => {
    setStartDraft(String(clip.start));
    setEndDraft(String(clip.end));
  }, [clip.start, clip.end]);

  useEffect(() => {
    setLabelDraft(clip.label);
  }, [clip.label]);

  const commit = (which: "start" | "end", raw: string) => {
    const parsed = parseTime(raw, duration);
    if (parsed == null) {
      if (which === "start") setStartDraft(String(clip.start));
      else setEndDraft(String(clip.end));
      return;
    }
    const start = which === "start" ? parsed : clip.start;
    const end = which === "end" ? parsed : clip.end;
    if (Math.abs(start - clip.start) < 0.001 && Math.abs(end - clip.end) < 0.001) return;
    if (Math.abs(end - start) < 0.05) {
      setStartDraft(String(clip.start));
      setEndDraft(String(clip.end));
      return;
    }
    onPatch(clip, Math.min(start, end), Math.max(start, end));
  };

  const hintLabel =
    hint === "burn" ? "will burn" : hint === "broll" ? "silent" : hint === "need" ? "transcribe first" : "no burn";

  return (
    <li className={`${clip.kept ? "kept" : "skipped"}${selected ? " on" : ""}`}>
      <button className="time" aria-label={"Select " + clip.label} aria-pressed={selected} onClick={() => onSelect(clip)}>
        {index + 1}
      </button>
      <div className="clip-row-body">
        <input
          className="clip-label"
          aria-label={"Name of clip " + (index + 1)}
          value={labelDraft}
          onChange={(e) => setLabelDraft(e.target.value)}
          onBlur={() => {
            const next = labelDraft.trim() || clip.label;
            setLabelDraft(next);
            if (next !== clip.label) onRename(clip, next);
          }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
        <div className="clip-row-times">
          <input
            className="clip-time"
            value={startDraft}
            onChange={(e) => setStartDraft(e.target.value)}
            onBlur={(e) => commit("start", e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && commit("start", startDraft)}
            title="Start"
            aria-label={"Start of clip " + (index + 1)}
          />
          <span className="muted">–</span>
          <input
            className="clip-time"
            value={endDraft}
            onChange={(e) => setEndDraft(e.target.value)}
            onBlur={(e) => commit("end", e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && commit("end", endDraft)}
            title="End"
            aria-label={"End of clip " + (index + 1)}
          />
          <em>{fmtDur(clip.duration)}</em>
          <span className={`clip-cap ${hint}`}>{hintLabel}</span>
        </div>
      </div>
      <select
        className="clip-kind"
        value={clip.kind || "talk"}
        onChange={(e) => onKind(clip, e.target.value)}
        title="Talk burns captions. B-roll stays silent. Intro uses the hook look."
      >
        <option value="talk">Talk</option>
        <option value="broll">B-roll</option>
        <option value="intro">Intro</option>
      </select>
      <button className={clip.kept ? "tiny on" : "tiny"} aria-label={(clip.kept ? "Exclude " : "Include ") + clip.label} onClick={() => onToggle(clip)}>
        {clip.kept ? "Kept" : "Excluded"}
      </button>
      <button className="tiny" title="Save this clip to the project bundle" disabled={busy} onClick={() => onSave(clip)}>
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
  segments,
  captionsOn,
  duration,
  current,
  markIn,
  markOut,
  busy,
  selectedId,
  onMarkIn,
  onMarkOut,
  onSetMarks,
  onAdd,
  onAddRanges,
  onQuickAdd,
  onToggle,
  onDelete,
  onSave,
  onPreview,
  canPreview,
  reviewing,
  onPatch,
  onKind,
  onRename,
  onSelect,
}: {
  clips: Clip[];
  segments: Segment[];
  captionsOn: boolean;
  duration: number;
  current: number;
  markIn: number | null;
  markOut: number | null;
  busy: boolean;
  selectedId: number | null;
  onMarkIn: () => void;
  onMarkOut: () => void;
  onSetMarks: (start: number | null, end: number | null) => void;
  onAdd: () => void;
  onAddRanges: (ranges: ClipRange[]) => Promise<void>;
  onQuickAdd: (start: number, end: number) => void;
  onToggle: (clip: Clip) => void;
  onDelete: (clip: Clip) => void;
  onSave: (clip: Clip) => void;
  onPreview: () => void;
  canPreview: boolean;
  reviewing: boolean;
  onPatch: (clip: Clip, start: number, end: number) => void;
  onKind: (clip: Clip, kind: string) => void;
  onRename: (clip: Clip, label: string) => void;
  onSelect: (clip: Clip) => void;
}) {
  const [inDraft, setInDraft] = useState("");
  const [outDraft, setOutDraft] = useState("");
  const [rangeDraft, setRangeDraft] = useState("");
  const [rangeError, setRangeError] = useState("");
  const [addingRanges, setAddingRanges] = useState(false);
  const span = markIn != null && markOut != null ? Math.abs(markOut - markIn) : 0;
  const canAdd = markIn != null && markOut != null && span >= 0.05 && !busy;
  const kept = clips.filter((c) => c.kept).length;

  useEffect(() => {
    setInDraft(markIn == null ? "" : String(Number(markIn.toFixed(3))));
    setOutDraft(markOut == null ? "" : String(Number(markOut.toFixed(3))));
  }, [markIn, markOut]);

  const commit = (which: "in" | "out", raw: string) => {
    const parsed = parseTime(raw, duration);
    if (parsed == null) {
      if (which === "in") setInDraft(markIn == null ? "" : String(Number(markIn.toFixed(3))));
      else setOutDraft(markOut == null ? "" : String(Number(markOut.toFixed(3))));
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

  const addRanges = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !duration || addingRanges) return;
    setRangeError("");
    setAddingRanges(true);
    try {
      await onAddRanges(parseClipRanges(rangeDraft, duration));
      setRangeDraft("");
    } catch (err) {
      setRangeError(err instanceof Error ? err.message : "Could not add the clip ranges.");
    } finally {
      setAddingRanges(false);
    }
  };

  return (
    <div className="clip-bin">
      <div className="selection-head">
        <h3>Trim a range</h3>
        <span className="hint">Drag on the waveform or mark In and Out.</span>
      </div>
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
          aria-label="In time"
          value={inDraft}
          placeholder="start s"
          onChange={(e) => setInDraft(e.target.value)}
          onBlur={(e) => commit("in", e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && commit("in", inDraft)}
        />
        <span className="muted">–</span>
        <input
          className="clip-time"
          aria-label="Out time"
          value={outDraft}
          placeholder="end s"
          onChange={(e) => setOutDraft(e.target.value)}
          onBlur={(e) => commit("out", e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && commit("out", outDraft)}
        />
        <em>{span >= 0.05 ? fmtDur(span) : "—"}</em>
        <button type="button" className="ghost" disabled={!canPreview} onClick={onPreview}>
          <Play size={14} /> {reviewing ? "Stop preview" : "Preview range"}
        </button>
        <button className="pull" disabled={!canAdd} onClick={onAdd} title="Enter — add clip">
          <Plus size={14} />
          Add to bin
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
            title={row.seconds === "first_min" ? "Add 0:00–1:00" : `Add ${row.label} from playhead`}
          >
            {row.label}
          </button>
        ))}
      </div>
      <details className="range-entry">
      <summary>Enter exact time ranges</summary>
      <form className="clip-ranges" onSubmit={(event) => void addRanges(event)}>
        <label htmlFor="clip-ranges">Time ranges</label>
        <div>
          <textarea
            id="clip-ranges"
            className="line-edit"
            rows={2}
            placeholder="1-15, 33-40, 1:00-1:20"
            value={rangeDraft}
            disabled={addingRanges}
            aria-invalid={Boolean(rangeError)}
            aria-describedby={rangeError ? "clip-range-error" : "clip-range-help"}
            onChange={(event) => {
              setRangeDraft(event.target.value);
              setRangeError("");
            }}
          />
          <button type="submit" className="ghost" disabled={busy || !duration || addingRanges || !rangeDraft.trim()}>
            <Plus size={14} />
            {addingRanges ? "Adding…" : "Add ranges"}
          </button>
        </div>
        {rangeError ? (
          <p className="hint clip-range-error" id="clip-range-error" role="alert">{rangeError}</p>
        ) : (
          <p className="hint" id="clip-range-help">Use seconds or minutes:seconds. Separate ranges with commas or new lines.</p>
        )}
      </form>
      </details>
      <div className="selection-head clip-bin-heading">
        <h3>Clip bin</h3>
        <span className="hint">{kept} of {clips.length} kept</span>
      </div>
      {clips.length > 0 && (
        <ul className="clip-list">
          {clips.map((clip, i) => (
            <ClipRow
              key={clip.id}
              clip={clip}
              index={i}
              duration={duration}
              busy={busy}
              selected={selectedId === clip.id}
              hint={clipCaptionHint(clip, segments, captionsOn)}
              onToggle={onToggle}
              onSave={onSave}
              onDelete={onDelete}
              onPatch={onPatch}
              onKind={onKind}
              onRename={onRename}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
      {!clips.length && <p className="clip-bin-empty hint">Add a range to start your clip bin.</p>}
    </div>
  );
}
