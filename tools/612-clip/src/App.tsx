import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  Download,
  LoaderCircle,
  Pause,
  Play,
  Scissors,
  Search,
  Sparkles,
  Upload,
} from "lucide-react";
import { api, events, fmtBytes, fmtDur, mediaUrl } from "./api";
import type { Clip, Detail, Health, Job, PullFile, Segment, Summary } from "./types";
import ClipBin from "./ClipBin";
import FitStage from "./FitStage";
import Inspector from "./Inspector";
import Waveform from "./Waveform";

function kindLabel(job: Job) {
  if (job.kind === "order") return job.title || "Order";
  if (job.kind === "clip") return job.title || "Save clip";
  if (job.kind === "clips") return "Save kept";
  if (job.kind === "suggest") return job.title || "Suggest";
  return { probe: "Probe", transcribe: "Whisper", export: "Concat bundle" }[job.kind];
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
  const [selectedClipId, setSelectedClipId] = useState<number | null>(null);
  const [pullQuery, setPullQuery] = useState("");
  const [inboxRecipe, setInboxRecipe] = useState<"suggest" | "shorts" | "silent" | string>("shorts");
  const [safeZones, setSafeZones] = useState(true);
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
    api.inbox().then((i) => setInboxRecipe(i.recipe || "shorts")).catch(() => undefined);
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
          if (job.project) loadDetail(job.project).catch(() => undefined);
          loadList().catch(() => undefined);
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
        if (last && inboxRecipe) {
          // Multi-drop follows the active inbox recipe after probe (probe auto-queues on upload)
          const steps =
            inboxRecipe === "suggest"
              ? ([
                  { id: "t1", op: "transcribe" as const },
                  { id: "s1", op: "suggest" as const, mode: "hooks" as const, target_s: 30 },
                ] as const)
              : inboxRecipe === "silent"
                ? ([
                    { id: "tr1", op: "trim" as const, mode: "keep" as const, start: 0, duration: 30 },
                    { id: "e1", op: "export" as const, captions: false },
                  ] as const)
                : ([
                    { id: "t1", op: "transcribe" as const },
                    { id: "e1", op: "export" as const, captions: true },
                  ] as const);
          if (list.length > 1 || inboxRecipe !== "shorts") {
            // For multi-file drops, queue recipe; single drop with shorts still probe-first so user can chop
            if (list.length > 1) {
              await api.order({
                name: `Drop · ${inboxRecipe}`,
                source: { kind: "project", slug: last.slug },
                steps: steps.map((s) => ({ ...s })),
              });
            }
          }
        }
      }
      if (last) {
        await loadList();
        await loadDetail(last.slug);
        setStatus(
          list.length > 1
            ? `Queued ${list.length} files · ${inboxRecipe} recipe`
            : "Probing — Whisper waits until you hit Transcribe",
        );
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
      setStatus("Imported from 612 Pull. Probing…");
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
    setSelectedClipId(null);
  }, [selected]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!detail) return;
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (event.key === " " || event.code === "Space") {
        event.preventDefault();
        const video = videoRef.current;
        if (!video) return;
        if (video.paused) void video.play();
        else video.pause();
        return;
      }
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

  const saveKept = async () => {
    if (!detail) return;
    await api.exportKeptClips(detail.slug);
    setStatus("Saving kept clips…");
  };

  const patchClipKind = async (clip: Clip, kind: string) => {
    if (!detail) return;
    const next = await api.patchClip(detail.slug, clip.id, { kind: kind as Clip["kind"] });
    setDetail(next);
  };

  const renameClip = async (clip: Clip, label: string) => {
    if (!detail) return;
    const next = await api.patchClip(detail.slug, clip.id, { label });
    setDetail(next);
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
          <b>612 Clip</b>
          <span>chop keepers</span>
        </div>
        <div className="grow" />
        {health && (
          <>
            <span className={health.ffmpeg ? "pill ok" : "pill warn"}>{health.ffmpeg ? "ffmpeg" : "no ffmpeg"}</span>
            <span className={health.whisper ? "pill ok" : "pill warn"}>{health.whisper ? health.device : "whisper?"}</span>
            {health.videotoolbox && <span className="pill ok">VideoToolbox</span>}
            {health.ytdlp && <span className="pill ok">yt-dlp</span>}
            {health.grokedit && <span className="pill ok">612 Edit</span>}
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

      {health && (!health.ffmpeg || !health.whisper) && (
        <div className="callout banner">
          {!health.ffmpeg && (
            <span>
              Install FFmpeg: <code>brew install ffmpeg</code>
            </span>
          )}
          {!health.whisper && (
            <span>
              Install Whisper: <code>.venv/bin/pip install faster-whisper</code>
            </span>
          )}
        </div>
      )}

      <div className="studio">
        <aside className="library">
          <div className="pane-head">Library</div>
          <button className="dropzone" onClick={() => fileRef.current?.click()}>
            Drop a file, or pick a 612 Pull download. Probe first — Whisper waits.
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
            {!projects.length && <li className="muted">No projects yet — drop a video or open the inbox.</li>}
          </ul>
          {pulls.length > 0 && (
            <>
              <div className="pane-head">612 Pull</div>
              <input
                className="pull-search"
                placeholder="Search downloads"
                value={pullQuery}
                onChange={(e) => setPullQuery(e.target.value)}
              />
              <ul className="project-list pull-list">
                {pulls
                  .filter((f) => !pullQuery.trim() || f.name.toLowerCase().includes(pullQuery.trim().toLowerCase()))
                  .map((f) => (
                    <li key={f.path}>
                      <button className="project" onClick={() => void importPull(f.path, f.name)} disabled={uploading}>
                        <strong>{f.name}</strong>
                        <em>
                          {f.duration ? `${fmtDur(f.duration)} · ` : ""}
                          {fmtBytes(f.size)}
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
              <h1>Chop the download</h1>
              <p>
                Open a 612 Pull file on the left. Mark the first 30s, jump around a long video, add only the bits you
                will use. Save kept clips — unused minutes stay in the source. Transcribe talking clips if you need
                captions you can edit.
              </p>
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
                  <button
                    className="ghost"
                    disabled={busy || !detail.duration}
                    onClick={() => api.transcribe(detail.slug, clips.some((c) => c.kept) ? "kept" : "all")}
                  >
                    {busy && running?.kind === "transcribe" ? <LoaderCircle size={14} className="spin" /> : <Sparkles size={14} />}
                    Transcribe
                  </button>
                  <button
                    className="pull"
                    disabled={busy || !clips.some((c) => c.kept)}
                    onClick={() => {
                      void api.exportKeptClips(detail.slug);
                      setStatus("Saving kept clips…");
                    }}
                  >
                    {busy && running?.kind === "clips" ? <LoaderCircle size={14} className="spin" /> : <Download size={14} />}
                    Save kept clips
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
                      showSafeZones={safeZones}
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
                  <button className={safeZones ? "tiny on" : "tiny"} onClick={() => setSafeZones((v) => !v)}>
                    Safe zones
                  </button>
                  <span className="muted keys">
                    {fmtDur(current)} · Space · I/O · Enter
                    {liveCaption.length ? " · captions" : ""}
                  </span>
                </div>
                <p className="hint clip-hint">
                  {clips.length && !clips.some((c) => c.kept)
                    ? "Every clip is dropped, so export uses transcript lines instead. Keep a clip, or delete it."
                    : segments.length
                      ? "Play to preview captions. Click a line to fix Whisper. Save kept clips writes only those files."
                      : "Mark In/Out keepers first. Transcribe if you need words. B-roll skips captions."}
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
                  segments={segments}
                  captionsOn={Boolean(detail.settings.captions)}
                  duration={duration}
                  current={current}
                  markIn={markIn}
                  markOut={markOut}
                  busy={busy}
                  selectedId={selectedClipId}
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
                  onSaveKept={() => void saveKept()}
                  onSeek={seek}
                  onPatch={(clip, start, end) => void patchClipTimes(clip, start, end)}
                  onKind={(clip, kind) => void patchClipKind(clip, kind)}
                  onRename={(clip, label) => void renameClip(clip, label)}
                  onSelect={(clip) => setSelectedClipId(clip.id)}
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
                    <LineText
                      seg={seg}
                      slug={detail.slug}
                      onSeek={seek}
                      onDetail={setDetail}
                      onStatus={setStatus}
                    />
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

        <Inspector
          detail={detail}
          health={health}
          clips={clips}
          segments={segments}
          jobs={jobs}
          busy={busy}
          creditDraft={creditDraft}
          logoRef={logoRef}
          selectedClipId={selectedClipId}
          inboxRecipe={inboxRecipe}
          onCredit={setCreditDraft}
          onPatchSetting={(key, value) => void patchSetting(key, value)}
          onPatchSettings={(settings) => void patchSettings(settings)}
          onStatus={setStatus}
          onDeleted={() => {
            setDetail(null);
            setSelected(null);
            loadList();
          }}
          onTranscribe={(scope) => {
            if (!detail) return;
            void api.transcribe(detail.slug, scope);
            setStatus(scope === "kept" ? "Transcribing kept clips…" : "Transcribing whole file…");
          }}
          onSaveKept={() => void saveKept()}
          onExportBundle={async () => {
            if (!detail) return;
            if (creditDraft !== (detail.settings.credit || "")) {
              await api.patch(detail.slug, { settings: { credit: creditDraft } });
            }
            await api.export(detail.slug);
            setStatus("Concat bundle queued");
          }}
          onDetail={setDetail}
          onInboxRecipe={setInboxRecipe}
        />
      </div>

      <footer className="status">
        <span>{status}</span>
        <span>{queuedCount ? `${queuedCount} in queue` : "Local"}</span>
      </footer>
    </div>
  );
}

function LineText({
  seg,
  slug,
  onSeek,
  onDetail,
  onStatus,
}: {
  seg: Segment;
  slug: string;
  onSeek: (time: number) => void;
  onDetail: (next: Detail) => void;
  onStatus: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(seg.text);
  useEffect(() => {
    setDraft(seg.text);
  }, [seg.text]);
  if (!editing) {
    return (
      <button
        className="text"
        onClick={() => onSeek(seg.start)}
        onDoubleClick={() => setEditing(true)}
        title="Double-click to edit caption text"
      >
        {seg.text}
      </button>
    );
  }
  return (
    <input
      className="line-edit"
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setDraft(seg.text);
          setEditing(false);
        }
      }}
      onBlur={async () => {
        setEditing(false);
        if (draft.trim() === seg.text.trim()) return;
        try {
          const next = await api.patchSegment(slug, seg.id, draft);
          onDetail(next);
          onStatus("Caption line updated");
        } catch (err) {
          onStatus(err instanceof Error ? err.message : "Could not edit line");
          setDraft(seg.text);
        }
      }}
    />
  );
}
