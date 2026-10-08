import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  AudioLines,
  Copy,
  FolderOpen,
  LoaderCircle,
  Pause,
  Play,
  RefreshCw,
  Sparkles,
  Spline,
  Trash2,
  Upload,
  WandSparkles,
} from "lucide-react";
import { api, events, fmtBpm, fmtDur, mediaUrl } from "./api";
import type { Health, Job, ProjectDetail, ProjectSummary } from "./types";
import Waveform from "./Waveform";
import StrudelStage from "./StrudelStage";

const STEM_ORDER = ["drums", "bass", "other", "vocals", "piano"];
const LAYERS = ["drums", "bass", "melody", "chords"] as const;

function kindLabel(kind: Job["kind"]) {
  return { split: "Split", analyze: "Analyze", strudel: "Strudel", pipeline: "Run all" }[kind];
}

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [status, setStatus] = useState("Drop a track. 612 Mix probes it before Demucs starts.");
  const [dropOver, setDropOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pattern, setPattern] = useState("building_blocks.js");
  const [playing, setPlaying] = useState(false);
  const [liveCode, setLiveCode] = useState("");
  const [enabled, setEnabled] = useState<string[]>([...LAYERS]);
  const [sounds, setSounds] = useState<Record<string, string>>({
    drums: "default",
    bass: "default",
    melody: "default",
    chords: "default",
  });
  const [preset, setPreset] = useState("phat_analog");
  const [intensity, setIntensity] = useState(0.35);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 9999));
  const [remixing, setRemixing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [stemSolo, setStemSolo] = useState<string | null>(null);
  const [stemMute, setStemMute] = useState<Record<string, boolean>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  const loadList = useCallback(async () => {
    const data = await api.projects();
    setProjects(data.projects);
    return data.projects;
  }, []);

  const loadDetail = useCallback(async (name: string) => {
    const data = await api.project(name);
    setDetail(data);
    setProjects((prev) => prev.map((p) => (p.name === name ? data : p)));
    return data;
  }, []);

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth(null));
    const tick = window.setInterval(() => {
      api.health().then(setHealth).catch(() => setHealth(null));
    }, 6000);
    loadList().catch(() => undefined);
    api.queue().then((q) => setJobs(q.jobs)).catch(() => undefined);
    const stop = events((data) => {
      if (data.type === "snapshot" && Array.isArray(data.jobs)) {
        setJobs(data.jobs as Job[]);
      }
      if (data.type === "job" && data.job) {
        const job = data.job as Job;
        setJobs((prev) => {
          const i = prev.findIndex((j) => j.id === job.id);
          if (i === -1) return [job, ...prev];
          const copy = prev.slice();
          copy[i] = { ...copy[i], ...job };
          return copy;
        });
        if (job.status === "done" || job.status === "error") {
          if (job.project) loadDetail(job.project).catch(() => undefined);
          loadList().catch(() => undefined);
        }
        if (job.status === "running") setStatus(`${kindLabel(job.kind)} · ${job.step}`);
        if (job.status === "done") setStatus(`${kindLabel(job.kind)} finished for ${job.project}`);
        if (job.status === "error") setStatus(job.error || "Job failed");
      }
      if (data.type === "project" && data.project) {
        const summary = data.project as ProjectSummary;
        setProjects((prev) => {
          const i = prev.findIndex((p) => p.name === summary.name);
          if (i === -1) return [summary, ...prev];
          const copy = prev.slice();
          copy[i] = { ...copy[i], ...summary };
          return copy;
        });
      }
    });
    return () => {
      window.clearInterval(tick);
      stop();
    };
  }, [loadDetail, loadList]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    loadDetail(selected)
      .then((data) => {
        const keys = Object.keys(data.codes || {});
        const next = keys.includes("building_blocks.js")
          ? "building_blocks.js"
          : keys.includes("custom_remix.js")
            ? "custom_remix.js"
            : keys[0] || "";
        if (next) {
          setPattern(next);
          setLiveCode(data.codes[next] || "");
        }
        if (data.presets?.[0] && !data.presets.some((p) => p.id === preset)) {
          setPreset(data.presets[0].id);
        }
      })
      .catch((err) => setStatus(err instanceof Error ? err.message : "Could not load project"));
  }, [selected, loadDetail]);

  const activeJob = useMemo(
    () => jobs.find((j) => j.project === selected && (j.status === "running" || j.status === "queued")) || null,
    [jobs, selected],
  );
  const busy = Boolean(activeJob);

  const ingest = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length) return;
    setUploading(true);
    try {
      let last: ProjectSummary | null = null;
      for (const file of list) {
        setStatus(`Probing ${file.name}…`);
        last = await api.upload(file);
      }
      const all = await loadList();
      if (last) {
        setSelected(last.name);
        setStatus(`Probed ${last.filename} · ${fmtBpm(last.tempo)} · ${fmtDur(last.duration)} — Split when ready.`);
      } else if (all[0]) setSelected(all[0].name);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const onDrop = (ev: DragEvent) => {
    ev.preventDefault();
    setDropOver(false);
    if (ev.dataTransfer.files?.length) ingest(ev.dataTransfer.files);
  };

  const run = async (fn: (name: string) => Promise<Job>, label: string) => {
    if (!selected) return;
    try {
      setPlaying(false);
      const job = await fn(selected);
      setStatus(`${label} queued`);
      setJobs((prev) => [job, ...prev.filter((j) => j.id !== job.id)]);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : `${label} failed`);
    }
  };

  const playPattern = (name: string, code?: string) => {
    const src = code ?? detail?.codes?.[name] ?? "";
    setPattern(name);
    setLiveCode(src);
    setPlaying(Boolean(src));
  };

  const copyCode = async () => {
    if (!liveCode) return;
    await navigator.clipboard.writeText(liveCode);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  const bakeRemix = async () => {
    if (!selected) return;
    setRemixing(true);
    try {
      const result = await api.remix(selected, {
        preset_id: preset,
        enabled_layers: enabled,
        layer_sounds: sounds,
        intensity,
        seed,
      });
      setLiveCode(result.code);
      setPattern(result.filename);
      setPlaying(true);
      await loadDetail(selected);
      setStatus(`Remix baked · seed ${seed}`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Remix failed");
    } finally {
      setRemixing(false);
    }
  };

  const removeProject = async (name: string) => {
    if (!window.confirm(`Delete ${name}? Stems and analysis on disk go with it.`)) return;
    await api.remove(name);
    const next = await loadList();
    if (selected === name) setSelected(next[0]?.name || null);
  };

  const stems = STEM_ORDER.filter((s) => detail?.stems.includes(s));
  const codeNames = Object.keys(detail?.codes || {});
  const current = projects.find((p) => p.name === selected) || detail;

  return (
    <div
      className={`app ${dropOver ? "drop" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDropOver(true);
      }}
      onDragLeave={() => setDropOver(false)}
      onDrop={onDrop}
    >
      <header className="topbar">
        <div className="brand">
          <b>612 Mix</b>
          <span>local splitter + Strudel studio</span>
        </div>
        <div className="grow" />
        <button className="ghost" onClick={() => fileRef.current?.click()} disabled={uploading}>
          <Upload size={14} /> {uploading ? "Probing…" : "Open audio"}
        </button>
        <input
          ref={fileRef}
          type="file"
          hidden
          accept=".mp3,.wav,.flac,.m4a,.aac,.mp4"
          multiple
          onChange={(e) => e.target.files && ingest(e.target.files)}
        />
        <span className={`pill ${health?.demucs ? "ok" : "warn"}`}>
          {health?.device?.toUpperCase() || "…"} {health?.demucs ? "Demucs" : "no Demucs"}
        </span>
      </header>

      <main className="studio">
        <aside className="library">
          <div className="pane-head">Library</div>
          <button className="dropzone" onClick={() => fileRef.current?.click()}>
            <FolderOpen size={16} />
            Drop a song to probe BPM and waveform before splitting.
          </button>
          <ul className="project-list">
            {projects.map((p) => (
              <li key={p.name}>
                <button
                  className={`project ${selected === p.name ? "on" : ""}`}
                  onClick={() => setSelected(p.name)}
                >
                  <strong>{p.name.replaceAll("_", " ")}</strong>
                  <em>
                    {fmtBpm(p.tempo)} · {fmtDur(p.duration)} · {p.status}
                  </em>
                </button>
              </li>
            ))}
            {!projects.length && <li className="empty">No projects yet.</li>}
          </ul>
        </aside>

        <section className="stage">
          {!current ? (
            <div className="empty-stage">
              <AudioLines size={28} />
              <h1>Probe first. Split when you mean it.</h1>
              <p>Drop a track to see duration, a BPM guess, and a waveform. Demucs only runs when you hit Split or Run all.</p>
            </div>
          ) : (
            <>
              <div className="stage-head">
                <div>
                  <h1>{current.name.replaceAll("_", " ")}</h1>
                  <p>
                    {current.filename} · {fmtDur(current.duration)} · {fmtBpm(current.tempo)}
                    {current.key ? ` · ${current.key}` : ""}
                  </p>
                </div>
                <div className="actions">
                  <button className="ghost" disabled={busy} onClick={() => run(api.split, "Split")}>
                    <Spline size={14} /> Split
                  </button>
                  <button className="ghost" disabled={busy} onClick={() => run(api.analyze, "Analyze")}>
                    <WandSparkles size={14} /> Analyze
                  </button>
                  <button className="ghost" disabled={busy} onClick={() => run(api.strudel, "Strudel")}>
                    <Sparkles size={14} /> Strudel
                  </button>
                  <button className="pull" disabled={busy} onClick={() => run(api.pipeline, "Run all")}>
                    {busy ? <LoaderCircle size={14} className="spin" /> : <Play size={14} />}
                    Run all
                  </button>
                </div>
              </div>

              <div className="card wave-card">
                <Waveform peaks={current.peaks || []} progress={activeJob?.progress || 0} />
                {activeJob && (
                  <div className="job-line">
                    <span>
                      {kindLabel(activeJob.kind)} · {activeJob.step}
                    </span>
                    <b>{Math.round(activeJob.progress * 100)}%</b>
                    <div className="bar">
                      <i style={{ width: `${Math.round(activeJob.progress * 100)}%` }} />
                    </div>
                  </div>
                )}
              </div>

              {(current.source || current.filename) && (
                <audio
                  className="source-audio"
                  controls
                  src={mediaUrl(current.name, current.source || `source${extOf(current.filename)}`)}
                />
              )}

              {stems.length > 0 && (
                <div className="stems">
                  {stems.map((stem) => {
                    const muted = stemSolo ? stemSolo !== stem : Boolean(stemMute[stem]);
                    return (
                      <div key={stem} className={`stem ${muted ? "muted" : ""}`}>
                        <header>
                          <b>{stem}</b>
                          <div>
                            <button
                              className={`tiny ${stemSolo === stem ? "on" : ""}`}
                              onClick={() => setStemSolo((s) => (s === stem ? null : stem))}
                            >
                              S
                            </button>
                            <button
                              className={`tiny ${stemMute[stem] ? "on" : ""}`}
                              onClick={() => setStemMute((m) => ({ ...m, [stem]: !m[stem] }))}
                            >
                              M
                            </button>
                          </div>
                        </header>
                        <audio controls src={muted ? undefined : mediaUrl(current.name, `stems/${stem}.wav`)} />
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="player-card card">
                <div className="player-toolbar">
                  <select
                    value={pattern}
                    onChange={(e) => {
                      const name = e.target.value;
                      setPattern(name);
                      setLiveCode(detail?.codes?.[name] || "");
                      setPlaying(false);
                    }}
                  >
                    {codeNames.length ? (
                      codeNames.map((name) => (
                        <option key={name} value={name}>
                          {name.replace(".js", "").replaceAll("_", " ")}
                        </option>
                      ))
                    ) : (
                      <option value="">No patterns yet</option>
                    )}
                  </select>
                  <button className="pull" disabled={!liveCode} onClick={() => setPlaying((p) => !p)}>
                    {playing ? <Pause size={14} /> : <Play size={14} />}
                    {playing ? "Stop" : "Play"}
                  </button>
                  <button className="ghost" disabled={!liveCode} onClick={copyCode}>
                    <Copy size={14} /> {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                <StrudelStage code={liveCode} playing={playing} />
                <textarea
                  className="code"
                  value={liveCode}
                  onChange={(e) => setLiveCode(e.target.value)}
                  spellCheck={false}
                  placeholder="Generate Strudel to see mini-notation here."
                />
              </div>
            </>
          )}
        </section>

        <aside className="inspector">
          <div className="pane-head">Inspector</div>
          {detail ? (
            <>
              <dl className="stats">
                <div><dt>Tempo</dt><dd>{fmtBpm(detail.tempo)}</dd></div>
                <div><dt>Key</dt><dd>{detail.key || "—"}</dd></div>
                <div><dt>Beats</dt><dd>{detail.total_beats ?? "—"}</dd></div>
                <div><dt>Drums</dt><dd>{detail.drum_hits ?? "—"} hits</dd></div>
                <div><dt>Melody</dt><dd>{detail.melody_notes ?? "—"} notes</dd></div>
                <div><dt>Bass</dt><dd>{detail.bass_notes ?? "—"} notes</dd></div>
                <div className="wide"><dt>Chords</dt><dd>{(detail.chord_labels || []).join("  ") || "—"}</dd></div>
              </dl>

              <div className="pane-head">Remix Lab</div>
              <label className="field">
                Style
                <select value={preset} onChange={(e) => setPreset(e.target.value)}>
                  {(detail.presets || []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.emoji} {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="layers">
                {LAYERS.map((layer) => (
                  <label key={layer} className="layer">
                    <input
                      type="checkbox"
                      checked={enabled.includes(layer)}
                      onChange={() =>
                        setEnabled((cur) =>
                          cur.includes(layer) ? cur.filter((x) => x !== layer) : [...cur, layer],
                        )
                      }
                    />
                    <span>{layer}</span>
                    <select
                      value={sounds[layer] || "default"}
                      onChange={(e) => setSounds((s) => ({ ...s, [layer]: e.target.value }))}
                    >
                      {(detail.sounds?.[layer] || ["default"]).map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <label className="field">
                Variation {intensity.toFixed(2)}
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={intensity}
                  onChange={(e) => setIntensity(Number(e.target.value))}
                />
              </label>
              <div className="seed-row">
                <label className="field grow">
                  Seed
                  <input value={seed} onChange={(e) => setSeed(Number(e.target.value) || 0)} />
                </label>
                <button className="ghost" onClick={() => setSeed(Math.floor(Math.random() * 9999))}>
                  <RefreshCw size={14} />
                </button>
              </div>
              <button className="pull wide" disabled={!detail.has_analysis || remixing} onClick={bakeRemix}>
                {remixing ? <LoaderCircle size={14} className="spin" /> : <Sparkles size={14} />}
                Bake remix
              </button>
              <p className="hint">
                Remix Lab writes <code>custom_remix.js</code> and plays it in the stage. Stem slices use 612 Mix’s own sample URLs — no extra <code>serve_samples.py</code>.
              </p>
              <button className="ghost danger wide" onClick={() => removeProject(detail.name)}>
                <Trash2 size={14} /> Delete project
              </button>
            </>
          ) : (
            <p className="hint">Select a project to inspect stems, analysis, and remix controls.</p>
          )}

          <div className="pane-head">Jobs</div>
          <ul className="jobs">
            {jobs.slice(0, 8).map((job) => (
              <li key={job.id}>
                <b>{kindLabel(job.kind)}</b>
                <span>{job.project}</span>
                <em className={job.status}>{job.status}</em>
              </li>
            ))}
            {!jobs.length && <li className="empty">Idle.</li>}
          </ul>
        </aside>
      </main>

      <footer className="status">
        <span>{status}</span>
        <span>{health?.version ? `v${health.version}` : ""}</span>
      </footer>
    </div>
  );
}

function extOf(filename: string): string {
  const ext = filename.includes(".") ? filename.slice(filename.lastIndexOf(".")) : ".wav";
  return ext.toLowerCase();
}
