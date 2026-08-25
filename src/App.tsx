import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  Clapperboard,
  Download,
  FolderOpen,
  ImagePlus,
  LoaderCircle,
  Pause,
  Play,
  Scissors,
  Search,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { api, events, fmtBytes, fmtDur, mediaUrl } from "./api";
import type { Clip, Detail, Health, Job, PullFile, Segment, Summary } from "./types";
import ClipBin from "./ClipBin";
import FitStage from "./FitStage";
import Pipeline from "./Pipeline";
import Waveform from "./Waveform";

function kindLabel(job: Job) {
  if (job.kind === "order") return job.title || "Order";
  if (job.kind === "clip") return job.title || "Save clip";
  return { probe: "Probe", transcribe: "Whisper", export: "Export" }[job.kind];
}

function inRange(t: number, start: number, end: number) {
  return t >= start && t < end;
}

function captionWordsAt(segments: Segment[], t: number, maxWords = 4) {
  const limit = Math.max(1, Math.min(6, maxWords));
  const words = segments
    .filter((s) => s.kept)
    .flatMap((s) => (s.words?.length ? s.words : [{ word: s.text, start: s.start, end: s.end }]))
    .filter((w) => w.word.trim());
  if (!words.length) return [];
  const cues: typeof words[] = [];
  let bucket: typeof words = [];
  for (const word of words) {
    if (!bucket.length) {
      bucket = [word];
      continue;
    }
    const long = word.end - bucket[0].start > 2;
    const many = bucket.length >= limit;
    const punct = /[.?!]$/.test(bucket[bucket.length - 1].word);
    const gap = word.start - bucket[bucket.length - 1].end > 0.45;
    if (long || many || punct || gap) {
      cues.push(bucket);
      bucket = [word];
    } else {
      bucket.push(word);
    }
  }
  if (bucket.length) cues.push(bucket);
  return cues.find((cue) => t >= cue[0].start && t < cue[cue.length - 1].end + 0.12) || [];
}

const CAPTION_PRESETS: Record<
  string,
  {
    caption_style: string;
    caption_position: string;
    caption_active: string;
    caption_rest: string;
    caption_size: string;
    caption_words: number;
    caption_karaoke: boolean;
    caption_uppercase: boolean;
  }
> = {
  hook: {
    caption_style: "hook",
    caption_position: "blur",
    caption_active: "#f5a524",
    caption_rest: "#ffffff",
    caption_size: "m",
    caption_words: 4,
    caption_karaoke: true,
    caption_uppercase: false,
  },
  boxed: {
    caption_style: "boxed",
    caption_position: "lower",
    caption_active: "#ffffff",
    caption_rest: "#ffffff",
    caption_size: "m",
    caption_words: 5,
    caption_karaoke: false,
    caption_uppercase: true,
  },
  minimal: {
    caption_style: "minimal",
    caption_position: "lower",
    caption_active: "#ffffff",
    caption_rest: "#cccccc",
    caption_size: "s",
    caption_words: 6,
    caption_karaoke: false,
    caption_uppercase: false,
  },
};

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [projects, setProjects] = useState<Summary[]>([]);
  const [pulls, setPulls] = useState<PullFile[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [status, setStatus] = useState("Drop a long video. Probe first. Whisper when you say so.");
  const [dropOver, setDropOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [query, setQuery] = useState("");
  const [previewKept, setPreviewKept] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [creditDraft, setCreditDraft] = useState("");
  const [markIn, setMarkIn] = useState<number | null>(null);
  const [markOut, setMarkOut] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const logoRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const loadList = useCallback(async () => {
    const data = await api.projects();
    setProjects(data.projects);
    return data.projects;
  }, []);

  const loadDetail = useCallback(async (slug: string) => {
    const data = await api.project(slug);
    setDetail(data);
    setSelected(slug);
    setCreditDraft(data.settings.credit || "");
    return data;
  }, []);

  useEffect(() => {
    api.health().then(setHealth).catch((err) => setStatus(String(err)));
    loadList().catch((err) => setStatus(String(err)));
    api.pulls().then((d) => setPulls(d.files)).catch(() => undefined);
    api.queue().then((q) => setJobs(q.jobs)).catch(() => undefined);
    return events((event) => {
      if (event.type === "snapshot" && Array.isArray(event.jobs)) {
        setJobs(event.jobs as Job[]);
      }
      if (event.type === "job" && event.job) {
        const job = event.job as Job;
        setJobs((prev) => {
          const next = prev.filter((j) => j.id !== job.id);
          next.unshift(job);
          return next.slice(0, 24);
        });
        if (job.status === "running") setStatus(`${kindLabel(job)} · ${job.step}`);
        if (job.status === "done") {
          setStatus(`${kindLabel(job)} · ${job.step}`);
          if (job.project) loadDetail(job.project).then(() => loadList());
        }
        if (job.status === "error") setStatus(job.error || "Job failed");
      }
      if (event.type === "project") {
        loadList();
        const summary = event.project as Summary | undefined;
        if (summary?.slug && summary.slug === selected) loadDetail(summary.slug);
      }
    });
  }, [loadDetail, loadList, selected]);

  const running = useMemo(() => jobs.find((j) => j.status === "running") || null, [jobs]);
  const queuedCount = useMemo(
    () => jobs.filter((j) => j.status === "running" || j.status === "queued").length,
    [jobs],
  );
  const workerBusy = queuedCount > 0;
  const busy = workerBusy;
  const segments = detail?.transcript.segments || [];
  const ranges = detail?.ranges || [];
  const clips = detail?.clips || [];
  const duration = detail?.duration || 0;
  const windowRange = detail?.window || null;
  const waveRanges = clips.length
    ? []
    : ranges.length
      ? ranges
      : windowRange
        ? [{ start: windowRange.start, end: windowRange.end, duration: windowRange.end - windowRange.start, text: "" }]
        : [];
  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () => (q ? segments.filter((s) => s.text.toLowerCase().includes(q)) : segments),
    [segments, q],
  );
  const currentSeg = useMemo(
    () => segments.find((s) => inRange(current, s.start, s.end)) || null,
    [segments, current],
  );
  const liveCaption = useMemo(
    () => captionWordsAt(segments, current, detail?.settings.caption_words ?? 4),
    [segments, current, detail?.settings.caption_words],
  );

  const ingest = async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type.startsWith("video") || /\.(mp4|mov|mkv|webm|m4v|avi)$/i.test(f.name));
    if (!list.length) {
      setStatus("Drop a video file");
      return;
    }
    setUploading(true);
    try {
      let last: Summary | null = null;
      for (const file of list) {
        last = await api.upload(file);
      }
      if (last) {
        await loadList();
        await loadDetail(last.slug);
        setStatus("Probing — Whisper waits until you hit Transcribe");
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const importPull = async (path: string, name: string) => {
    setUploading(true);
    try {
      const row = await api.importPath(path, name);
      await loadList();
      await loadDetail(row.slug);
      setStatus("Imported from GrokPull. Probing…");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Import failed");
    } finally {
      setUploading(false);
    }
  };

  const seek = (time: number) => {
    const video = videoRef.current;
    if (video) video.currentTime = time;
    setCurrent(time);
  };

  const addClipRange = useCallback(
    async (start: number, end: number, clearMarks = true) => {
      if (!detail) return;
      const a = Math.min(start, end);
      const b = Math.max(start, end);
      if (b - a < 0.05) {
        setStatus("Clip is too short");
        return;
      }
      try {
        const next = await api.addClip(detail.slug, { start: a, end: b });
        setDetail(next);
        if (clearMarks) {
          setMarkIn(null);
          setMarkOut(null);
        }
        setStatus(`Added clip ${fmtDur(a)}–${fmtDur(b)}`);
      } catch (err) {
        setStatus(err instanceof Error ? err.message : "Could not add clip");
      }
    },
    [detail],
  );

  const addClip = useCallback(async () => {
    if (markIn == null || markOut == null) return;
    await addClipRange(markIn, markOut, true);
  }, [addClipRange, markIn, markOut]);

  const patchClipTimes = async (clip: Clip, start: number, end: number) => {
    if (!detail) return;
    try {
      const next = await api.patchClip(detail.slug, clip.id, { start, end });
      setDetail(next);
      setStatus(`Updated ${clip.label} → ${fmtDur(start)}–${fmtDur(end)}`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Could not update clip");
    }
  };

  useEffect(() => {
    setMarkIn(null);
    setMarkOut(null);
  }, [selected]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!detail) return;
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (event.key === "i" || event.key === "I") {
        event.preventDefault();
        setMarkIn(current);
      } else if (event.key === "o" || event.key === "O") {
        event.preventDefault();
        setMarkOut(current);
      } else if (event.key === "Enter") {
        event.preventDefault();
        void addClip();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [addClip, current, detail]);

  const toggleClip = async (clip: Clip) => {
    if (!detail) return;
    const next = await api.patchClip(detail.slug, clip.id, { kept: !clip.kept });
    setDetail(next);
  };

  const removeClip = async (clip: Clip) => {
    if (!detail) return;
    const next = await api.removeClip(detail.slug, clip.id);
    setDetail(next);
  };

  const saveClip = async (clip: Clip) => {
    if (!detail) return;
    await api.exportClip(detail.slug, clip.id);
    setStatus(`Saving ${clip.label}…`);
  };

  const toggleKeep = async (seg: Segment) => {
    if (!detail) return;
    const next = await api.keep(detail.slug, [seg.id], !seg.kept);
    setDetail(next);
    setProjects((prev) => prev.map((p) => (p.slug === next.slug ? { ...p, ...next } : p)));
  };

  const keepVisible = async (kept: boolean) => {
    if (!detail) return;
    const ids = visible.map((s) => s.id);
    if (!ids.length) return;
    const next = await api.keep(detail.slug, ids, kept);
    setDetail(next);
  };

  const onTime = () => {
    const video = videoRef.current;
    if (!video) return;
    let t = video.currentTime;
    if (previewKept && ranges.length) {
      const here = ranges.find((r) => inRange(t, r.start, r.end - 0.04));
      if (!here) {
        const next = ranges.find((r) => r.start > t);
        if (next) {
          video.currentTime = next.start;
          t = next.start;
        } else {
          video.pause();
        }
      }
    } else if (previewKept && windowRange) {
      if (t < windowRange.start) {
        video.currentTime = windowRange.start;
        t = windowRange.start;
      } else if (t >= windowRange.end - 0.05) {
        video.pause();
      }
    }
    setCurrent(t);
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDropOver(false);
    if (event.dataTransfer.files.length) void ingest(event.dataTransfer.files);
  };

  const patchSetting = async (key: string, value: unknown) => {
    if (!detail) return;
    const next = await api.patch(detail.slug, { settings: { [key]: value } });
    setDetail(next);
  };

  const patchSettings = async (settings: Record<string, unknown>) => {
    if (!detail) return;
    const next = await api.patch(detail.slug, { settings });
    setDetail(next);
  };

  const sourceUrl = detail?.source ? mediaUrl(detail.slug, detail.source) : "";

  return (
    <div
      className={dropOver ? "app drop" : "app"}
      onDragOver={(e) => {
        e.preventDefault();
        setDropOver(true);
      }}
      onDragLeave={() => setDropOver(false)}
      onDrop={onDrop}
    >
      <header className="topbar">
        <div className="brand">
          <b>GrokClip</b>
          <span>keep the lines</span>
        </div>
        <div className="grow" />
        {health && (
          <>
            <span className={health.ffmpeg ? "pill ok" : "pill warn"}>{health.ffmpeg ? "ffmpeg" : "no ffmpeg"}</span>
            <span className={health.whisper ? "pill ok" : "pill warn"}>{health.whisper ? health.device : "whisper?"}</span>
            {health.videotoolbox && <span className="pill ok">VideoToolbox</span>}
            {health.ytdlp && <span className="pill ok">yt-dlp</span>}
            {health.grokedit && <span className="pill ok">GrokEdit</span>}
          </>
        )}
        <button className="ghost" onClick={() => fileRef.current?.click()} disabled={uploading}>
          {uploading ? <LoaderCircle size={14} className="spin" /> : <Upload size={14} />}
          Open video
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="video/*,.mp4,.mov,.mkv,.webm,.m4v"
          hidden
          multiple
          onChange={(e) => e.target.files && void ingest(e.target.files)}
        />
      </header>

      <div className="studio">
        <aside className="library">
          <div className="pane-head">Library</div>
          <button className="dropzone" onClick={() => fileRef.current?.click()}>
            Drop a long file, or a GrokPull download. Probe runs first — Whisper does not.
          </button>
          <ul className="project-list">
            {projects.map((p) => (
              <li key={p.slug}>
                <button className={p.slug === selected ? "project on" : "project"} onClick={() => loadDetail(p.slug)}>
                  <strong>{p.name}</strong>
                  <em>
                    {fmtDur(p.duration)} ·{" "}
                    {p.clip_count
                      ? `${p.kept_clips}/${p.clip_count} clips`
                      : `${p.kept_lines}/${p.lines || 0} lines`}{" "}
                    · {p.status}
                  </em>
                </button>
              </li>
            ))}
          </ul>
          {pulls.length > 0 && (
            <>
              <div className="pane-head">GrokPull</div>
              <ul className="project-list">
                {pulls.slice(0, 8).map((f) => (
                  <li key={f.path}>
                    <button className="project" onClick={() => void importPull(f.path, f.name)} disabled={uploading}>
                      <strong>{f.name}</strong>
                      <em>
                        {fmtDur(f.duration)} · {fmtBytes(f.size)}
                      </em>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>

        <main className="stage">
          {!detail ? (
            <div className="empty-stage">
              <Scissors size={36} />
              <h1>Queue the cut</h1>
              <p>
                For a talking short: drop the file, hit <b>Transcribe</b>, mark In/Out (or keep 30s), leave{" "}
                <b>Burn captions</b> on, then export. Karaoke captions sit in the blur under the picture.
              </p>
              <Pipeline detail={null} health={health} compact onStatus={setStatus} />
            </div>
          ) : (
            <>
              <div className="stage-head">
                <div>
                  <h1>{detail.name}</h1>
                  <p>
                    {detail.width}×{detail.height} · {fmtDur(duration)} source
                    {windowRange ? ` · keep ${fmtDur(windowRange.start)}–${fmtDur(windowRange.end)}` : ""}
                    {" · "}
                    {fmtDur(detail.kept_duration)} kept
                    {clips.length
                      ? ` · ${clips.filter((c) => c.kept).length}/${clips.length} clips`
                      : ` · ${detail.lines} lines · ${detail.ranges.length} cuts`}
                  </p>
                </div>
                <div className="actions">
                  <button className="ghost" disabled={busy || !detail.duration} onClick={() => api.transcribe(detail.slug)}>
                    {busy && running?.kind === "transcribe" ? <LoaderCircle size={14} className="spin" /> : <Sparkles size={14} />}
                    Transcribe
                  </button>
                  <button
                    className="pull"
                    disabled={busy || !detail.duration}
                    onClick={async () => {
                      if (creditDraft !== (detail.settings.credit || "")) {
                        await api.patch(detail.slug, { settings: { credit: creditDraft } });
                      }
                      await api.export(detail.slug);
                    }}
                  >
                    {busy && running?.kind === "export" ? <LoaderCircle size={14} className="spin" /> : <Download size={14} />}
                    {clips.length ? "Export kept clips" : "Export bundle"}
                  </button>
                </div>
              </div>

              {running && (
                <div className="job-line">
                  <span>
                    {kindLabel(running)} · {running.step}
                    {running.steps_total ? ` · ${Math.min((running.step_index || 0) + 1, running.steps_total)}/${running.steps_total}` : ""}
                  </span>
                  <button className="tiny" onClick={() => api.cancel(running.id)}>
                    Cancel
                  </button>
                  <div className="bar">
                    <i style={{ width: `${Math.round(running.progress * 100)}%` }} />
                  </div>
                </div>
              )}

              <div className="player-row">
                <div className="monitor">
                  {sourceUrl ? (
                    <FitStage
                      videoRef={videoRef}
                      src={sourceUrl}
                      poster={detail.poster ? mediaUrl(detail.slug, detail.poster) : undefined}
                      settings={{ ...detail.settings, credit: creditDraft }}
                      srcWidth={detail.width || 1920}
                      srcHeight={detail.height || 1080}
                      logoUrl={detail.settings.logo ? mediaUrl(detail.slug, detail.settings.logo) : undefined}
                      credit={creditDraft}
                      captionWords={detail.settings.captions ? liveCaption : []}
                      currentTime={current}
                      onTimeUpdate={onTime}
                      onPlay={() => setPlaying(true)}
                      onPause={() => setPlaying(false)}
                    />
                  ) : (
                    <div className="muted">No source</div>
                  )}
                </div>
                <div className="transport">
                  <button
                    className="ghost"
                    onClick={() => {
                      const video = videoRef.current;
                      if (!video) return;
                      if (video.paused) video.play();
                      else video.pause();
                    }}
                  >
                    {playing ? <Pause size={14} /> : <Play size={14} />}
                    {playing ? "Pause" : "Play"}
                  </button>
                  <button className={previewKept ? "tiny on" : "tiny"} onClick={() => setPreviewKept((v) => !v)}>
                    Skip unkept
                  </button>
                  <span className="muted">
                    {fmtDur(current)} · {detail.settings.frame} · {detail.settings.layout}
                    {liveCaption.length ? " · captions" : ""}
                  </span>
                </div>
                <p className="hint clip-hint">
                  {clips.length && !clips.some((c) => c.kept)
                    ? "Every clip is dropped, so export uses transcript lines instead. Keep a clip, or delete it."
                    : segments.length
                      ? "Play to hear karaoke captions in the blur. Mark In/Out for a 30s short, or keep/drop lines, then Export with Burn captions on."
                      : "Hit Transcribe first so the words can burn under the 9:16 plate. Then In/Out a range (or use Shorts 30s in the pipeline) and export."}
                </p>
              </div>

              <div className="card wave-card">
                <Waveform
                  peaks={detail.peaks}
                  duration={duration}
                  current={current}
                  ranges={waveRanges}
                  clips={clips}
                  markIn={markIn}
                  markOut={markOut}
                  onSeek={seek}
                  onSelectRange={(start, end) => {
                    setMarkIn(start);
                    setMarkOut(end);
                  }}
                />
                <ClipBin
                  clips={clips}
                  duration={duration}
                  current={current}
                  markIn={markIn}
                  markOut={markOut}
                  busy={busy}
                  onMarkIn={() => setMarkIn(current)}
                  onMarkOut={() => setMarkOut(current)}
                  onSetMarks={(start, end) => {
                    setMarkIn(start);
                    setMarkOut(end);
                  }}
                  onAdd={() => void addClip()}
                  onQuickAdd={(start, end) => void addClipRange(start, end, false)}
                  onToggle={(clip) => void toggleClip(clip)}
                  onDelete={(clip) => void removeClip(clip)}
                  onSave={(clip) => void saveClip(clip)}
                  onSeek={seek}
                  onPatch={(clip, start, end) => void patchClipTimes(clip, start, end)}
                />
              </div>

              <div className="transcript-bar">
                <Search size={14} />
                <input
                  ref={searchRef}
                  placeholder="Search transcript"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <button className="tiny" onClick={() => void keepVisible(true)} disabled={!visible.length}>
                  Keep shown
                </button>
                <button className="tiny" onClick={() => void keepVisible(false)} disabled={!visible.length}>
                  Drop shown
                </button>
                <button className="tiny" onClick={() => detail && api.keepAll(detail.slug, true).then(setDetail)}>
                  Keep all
                </button>
                <button className="tiny" onClick={() => detail && api.keepAll(detail.slug, false).then(setDetail)}>
                  Keep none
                </button>
              </div>

              <ul className="lines">
                {visible.map((seg) => (
                  <li key={seg.id} className={`${seg.kept ? "kept" : "skipped"} ${currentSeg?.id === seg.id ? "now" : ""}`}>
                    <button className="time" onClick={() => seek(seg.start)}>
                      {fmtDur(seg.start)}
                    </button>
                    <button className="text" onClick={() => seek(seg.start)}>
                      {seg.text}
                    </button>
                    <button className={seg.kept ? "tiny on" : "tiny"} onClick={() => void toggleKeep(seg)}>
                      {seg.kept ? "Keep" : "Off"}
                    </button>
                  </li>
                ))}
                {detail.status === "transcribed" && !segments.length && (
                  <li className="callout">
                    Whisper finished but heard no speech. That happens on music videos — the VAD treats singing as noise.
                    Hit <b>Transcribe</b> again; it will retry on the full audio.
                  </li>
                )}
                {detail.status !== "transcribed" && !segments.length && (
                  <li className="muted">
                    Mark In/Out on the playhead to cut without Whisper, or transcribe to keep and drop lines.
                  </li>
                )}
                {segments.length > 0 && !visible.length && <li className="muted">No lines match that search.</li>}
              </ul>
            </>
          )}
        </main>

        <aside className="inspector">
          {detail && (
            <Pipeline
              detail={detail}
              health={health}
              settings={{ ...detail.settings, credit: creditDraft }}
              onStatus={setStatus}
            />
          )}
          <div className="pane-head">Cut</div>
          {detail ? (
            <>
              <dl className="stats">
                <div>
                  <dt>Kept</dt>
                  <dd>{fmtDur(detail.kept_duration)}</dd>
                </div>
                <div>
                  <dt>Cuts</dt>
                  <dd>{clips.length ? `${detail.kept_clips}/${clips.length}` : detail.ranges.length}</dd>
                </div>
                <div>
                  <dt>Lines</dt>
                  <dd>
                    {detail.kept_lines}/{detail.lines}
                  </dd>
                </div>
                <div>
                  <dt>Model</dt>
                  <dd>{detail.settings.model}</dd>
                </div>
              </dl>

              <label className="field">
                Whisper
                <select
                  value={detail.settings.model}
                  onChange={(e) => void patchSetting("model", e.target.value)}
                  disabled={busy}
                >
                  {(health?.models || ["tiny", "base", "small"]).map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>

              <label className="check">
                <input
                  type="checkbox"
                  checked={detail.settings.remove_fillers}
                  onChange={(e) => void patchSetting("remove_fillers", e.target.checked)}
                />
                Drop um / uh / like
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={detail.settings.tighten_pauses}
                  onChange={(e) => void patchSetting("tighten_pauses", e.target.checked)}
                />
                Tighten long pauses
              </label>

              <label className="field">
                Frame
                <div className="chip-row">
                  {(["9:16", "16:9", "1:1", "4:5"] as const).map((frame) => (
                    <button
                      key={frame}
                      className={detail.settings.frame === frame ? "tiny on" : "tiny"}
                      onClick={() => void patchSetting("frame", frame)}
                    >
                      {frame}
                    </button>
                  ))}
                </div>
              </label>
              <label className="field">
                Fit
                <select
                  value={detail.settings.layout}
                  onChange={(e) => void patchSetting("layout", e.target.value)}
                >
                  <option value="blur">Blur fill</option>
                  <option value="crop">Face crop</option>
                </select>
              </label>

              <div className="pane-head">Captions</div>
              <label className="check">
                <input
                  type="checkbox"
                  checked={detail.settings.captions}
                  onChange={(e) => void patchSetting("captions", e.target.checked)}
                />
                Burn captions
              </label>
              <label className="field">
                Preset
                <div className="chip-row">
                  {(
                    [
                      ["hook", "Hook"],
                      ["boxed", "Boxed"],
                      ["minimal", "Minimal"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      className={detail.settings.caption_style === id ? "tiny on" : "tiny"}
                      onClick={() => void patchSettings(CAPTION_PRESETS[id])}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </label>
              <label className="field">
                Position
                <div className="chip-row">
                  {(
                    [
                      ["blur", "Blur"],
                      ["lower", "Lower third"],
                      ["center", "Center"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      className={(detail.settings.caption_position || "blur") === id ? "tiny on" : "tiny"}
                      onClick={() => void patchSetting("caption_position", id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </label>
              <label className="field">
                Size
                <div className="chip-row">
                  {(
                    [
                      ["s", "S"],
                      ["m", "M"],
                      ["l", "L"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      className={(detail.settings.caption_size || "m") === id ? "tiny on" : "tiny"}
                      onClick={() => void patchSetting("caption_size", id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </label>
              <label className="field">
                Active color
                <input
                  type="color"
                  className="swatch"
                  value={detail.settings.caption_active || "#f5a524"}
                  onChange={(e) => void patchSetting("caption_active", e.target.value)}
                />
              </label>
              <label className="field">
                Rest color
                <input
                  type="color"
                  className="swatch"
                  value={detail.settings.caption_rest || "#ffffff"}
                  onChange={(e) => void patchSetting("caption_rest", e.target.value)}
                />
              </label>
              <label className="field">
                Words per line
                <input
                  type="number"
                  min={1}
                  max={6}
                  value={detail.settings.caption_words ?? 4}
                  onChange={(e) =>
                    void patchSetting("caption_words", Math.max(1, Math.min(6, Number(e.target.value) || 4)))
                  }
                />
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={detail.settings.caption_karaoke !== false}
                  onChange={(e) => void patchSetting("caption_karaoke", e.target.checked)}
                />
                Karaoke highlight
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={Boolean(detail.settings.caption_uppercase)}
                  onChange={(e) => void patchSetting("caption_uppercase", e.target.checked)}
                />
                Uppercase
              </label>

              <div className="pane-head">Brand</div>
              <label className="field">
                Credit
                <input
                  value={creditDraft}
                  placeholder="@yourhandle"
                  onChange={(e) => setCreditDraft(e.target.value)}
                  onBlur={() => {
                    if (creditDraft !== (detail.settings.credit || "")) {
                      void patchSetting("credit", creditDraft);
                    }
                  }}
                />
              </label>
              <label className="field">
                Credit corner
                <select
                  value={detail.settings.credit_corner}
                  onChange={(e) => void patchSetting("credit_corner", e.target.value)}
                >
                  <option value="bl">Lower left</option>
                  <option value="br">Lower right</option>
                </select>
              </label>
              <label className="field">
                Border
                <select
                  value={detail.settings.border}
                  onChange={(e) => void patchSetting("border", e.target.value)}
                >
                  <option value="none">None</option>
                  <option value="solid">Solid</option>
                  <option value="glow">Glow</option>
                </select>
              </label>
              <label className="field">
                Border color
                <input
                  type="color"
                  className="swatch"
                  value={detail.settings.border_color || "#c084fc"}
                  onChange={(e) => void patchSetting("border_color", e.target.value)}
                />
              </label>
              <div className="logo-row">
                {detail.settings.logo ? (
                  <img className="logo-thumb" src={mediaUrl(detail.slug, detail.settings.logo)} alt="Logo" />
                ) : (
                  <span className="muted">No logo</span>
                )}
                <button className="tiny" onClick={() => logoRef.current?.click()}>
                  <ImagePlus size={12} />
                  {detail.settings.logo ? "Replace" : "Logo"}
                </button>
                {detail.settings.logo && (
                  <button
                    className="tiny"
                    onClick={async () => {
                      const next = await api.clearLogo(detail.slug);
                      setDetail(next);
                    }}
                  >
                    Clear
                  </button>
                )}
                <input
                  ref={logoRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  hidden
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    try {
                      const next = await api.uploadLogo(detail.slug, file);
                      setDetail(next);
                      setStatus("Logo on the opposite corner from the credit");
                    } catch (err) {
                      setStatus(err instanceof Error ? err.message : "Logo upload failed");
                    }
                  }}
                />
              </div>
              <p className="hint">
                Blur fill letterboxes landscape into 9:16. Captions sit where you put them (blur / lower third /
                center) with karaoke colors you pick. Transcribe, keep lines or mark clips, leave Burn captions on, then
                export.
              </p>

              <div className="pane-head">Bundle</div>
              {detail.bundle ? (
                <div className="bundle">
                  {detail.bundle.thumbnail && (
                    <img src={mediaUrl(detail.slug, detail.bundle.thumbnail)} alt="Thumbnail" />
                  )}
                  <p className="hint">{detail.youtube?.title}</p>
                  {detail.bundle.clip_files && detail.bundle.clip_files.length > 0 && (
                    <p className="hint">{detail.bundle.clip_files.length} individual clip files</p>
                  )}
                  <button className="ghost wide" onClick={() => api.open(detail.slug)}>
                    <FolderOpen size={14} />
                    Reveal folder
                  </button>
                  <button className="pull wide" onClick={() => api.grokedit(detail.slug)}>
                    <Clapperboard size={14} />
                    Thumbnail → GrokEdit
                  </button>
                </div>
              ) : (
                <p className="hint">Export writes the chosen frame, 16:9, 9:16, each kept clip, captions.srt, youtube.txt, and a PNG for GrokEdit.</p>
              )}

              <button
                className="ghost wide danger"
                onClick={async () => {
                  await api.remove(detail.slug);
                  setDetail(null);
                  setSelected(null);
                  loadList();
                }}
              >
                <Trash2 size={14} />
                Delete project
              </button>
            </>
          ) : (
            <p className="hint">
              Probe draws a waveform before any model loads. Transcribe is a queued SSE job. Keep lines in the stage —
              that is the edit.
            </p>
          )}

          <div className="pane-head">Orders</div>
          <ul className="jobs">
            {jobs.slice(0, 10).map((job) => (
              <li key={job.id}>
                <em className={job.status}>{kindLabel(job)}</em>
                <span>{job.step}</span>
                <span>{job.status === "queued" || job.status === "running" ? `${Math.round(job.progress * 100)}%` : job.project}</span>
              </li>
            ))}
            {!jobs.length && <li className="muted">Idle — queue an order</li>}
          </ul>
        </aside>
      </div>

      <footer className="status">
        <span>{status}</span>
        <span>{queuedCount ? `${queuedCount} in queue` : "Local"}</span>
      </footer>
    </div>
  );
}
