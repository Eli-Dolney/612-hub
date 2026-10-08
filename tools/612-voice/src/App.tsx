import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  Clapperboard,
  LoaderCircle,
  Mic,
  Pause,
  Play,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  Youtube,
} from "lucide-react";
import { api, events, fmtDur, mediaUrl } from "./api";
import type { Health, Job, Line, ShowDetail, ShowSummary, Voice } from "./types";
import Waveform from "./Waveform";

const SPEAKERS = ["A", "B", "C", "D"] as const;
const SPEAKER_COLOR: Record<string, string> = {
  A: "#f0b429",
  B: "#67e8f9",
  C: "#86efac",
  D: "#c4b5fd",
};

function kindLabel(kind: Job["kind"]) {
  return { render: "Render", concat: "Concat", effects: "Effects", youtube: "YouTube" }[kind];
}

function toSummary(show: ShowDetail | ShowSummary): ShowSummary {
  return {
    name: show.name,
    title: show.title,
    mode: show.mode,
    engine: show.engine,
    lines: Array.isArray((show as ShowDetail).lines) ? (show as ShowDetail).lines.length : (show as ShowSummary).lines,
    rendered: show.rendered,
    has_mix: show.has_mix,
    created_at: show.created_at,
    duration: show.duration,
  };
}

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [shows, setShows] = useState<ShowSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<ShowDetail | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [status, setStatus] = useState("Add a voice, then write a line, a script, or a four-speaker story.");
  const [dropOver, setDropOver] = useState(false);
  const [mode, setMode] = useState<"line" | "script" | "story">("line");
  const [draft, setDraft] = useState("");
  const [story, setStory] = useState(
    "Speaker 1: Welcome back. This whole episode stays on this Mac.\nSpeaker 2: Clone a voice, render the script, concat a mix. No cloud bill.",
  );
  const [activeLine, setActiveLine] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [ytUrl, setYtUrl] = useState("");
  const [ytName, setYtName] = useState("");
  const [ytStart, setYtStart] = useState("0:00");
  const [gain, setGain] = useState(0);
  const [pitch, setPitch] = useState(0);
  const [reverb, setReverb] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const loadVoices = useCallback(async () => {
    const data = await api.voices();
    setVoices(data.voices);
    return data.voices;
  }, []);

  const loadShows = useCallback(async () => {
    const data = await api.shows();
    setShows(data.shows);
    return data.shows;
  }, []);

  const loadDetail = useCallback(async (name: string) => {
    const data = await api.show(name);
    setDetail(data);
    setVoices(data.voices || []);
    setShows((prev) => prev.map((s) => (s.name === name ? toSummary(data) : s)));
    if (data.story_text) setStory(data.story_text);
    if (data.mode === "story" || data.mode === "script" || data.mode === "line") {
      setMode(data.mode === "line" ? "line" : data.mode);
    }
    return data;
  }, []);

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth(null));
    const tick = window.setInterval(() => {
      api.health().then(setHealth).catch(() => setHealth(null));
    }, 8000);
    loadVoices().catch(() => undefined);
    loadShows().catch(() => undefined);
    api.queue().then((q) => setJobs(q.jobs)).catch(() => undefined);
    const stop = events((data) => {
      if (data.type === "snapshot" && Array.isArray(data.jobs)) setJobs(data.jobs as Job[]);
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
          if (job.project && job.project !== "_voices") loadDetail(job.project).catch(() => undefined);
          loadShows().catch(() => undefined);
          loadVoices().catch(() => undefined);
        }
        if (job.status === "running") setStatus(`${kindLabel(job.kind)} · ${job.step}`);
        if (job.status === "done") setStatus(`${kindLabel(job.kind)} finished`);
        if (job.status === "error") setStatus(job.error || "Job failed");
      }
      if (data.type === "show" && data.show) {
        const show = data.show as ShowDetail;
        setDetail((prev) => (prev && prev.name === show.name ? show : prev));
        setShows((prev) => {
          const i = prev.findIndex((s) => s.name === show.name);
          if (i === -1) return [toSummary(show), ...prev];
          const copy = prev.slice();
          copy[i] = toSummary(show);
          return copy;
        });
      }
      if (data.type === "voice") loadVoices().catch(() => undefined);
    });
    return () => {
      window.clearInterval(tick);
      stop();
    };
  }, [loadDetail, loadShows, loadVoices]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    loadDetail(selected).catch((err) => setStatus(err instanceof Error ? err.message : "Could not load show"));
  }, [selected, loadDetail]);

  const activeJob = useMemo(
    () => jobs.find((j) => (j.project === selected || j.project === "_voices") && (j.status === "running" || j.status === "queued")) || null,
    [jobs, selected],
  );
  const busy = Boolean(activeJob);

  const currentLine = detail?.lines.find((ln) => ln.index === activeLine) || detail?.lines[0] || null;
  const playSrc = currentLine?.file && selected ? mediaUrl(selected, currentLine.file) : detail?.mix_file && selected ? mediaUrl(selected, detail.mix_file) : "";

  const ingestVoices = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length) return;
    try {
      for (const file of list) {
        await api.uploadVoice(file, file.name.replace(/\.[^.]+$/, ""));
      }
      await loadVoices();
      setStatus("Voice prompt saved locally.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Upload failed");
    }
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDropOver(false);
    if (event.dataTransfer.files?.length) ingestVoices(event.dataTransfer.files);
  };

  const ensureShow = async () => {
    if (selected && detail) return detail;
    const created = await api.createShow("Untitled show");
    await loadShows();
    setSelected(created.name);
    const data = await loadDetail(created.name);
    return data;
  };

  const generateDraft = async () => {
    const text = draft.trim();
    if (!text) return;
    try {
      const show = await ensureShow();
      const next: Line[] = [
        ...(show.lines || []),
        {
          index: (show.lines?.length || 0) + 1,
          text,
          speaker: "A",
          voice: show.cast?.A || voices[0]?.id || "",
          filename: "",
          exaggeration: 0.5,
          cfg_weight: 0.5,
          temperature: 0.8,
        },
      ];
      const patched = await api.patchShow(show.name, { lines: next, mode: "line" });
      setDetail(patched);
      const idx = patched.lines[patched.lines.length - 1]?.index;
      setActiveLine(idx);
      await api.render(patched.name, idx ? [idx] : undefined);
      setDraft("");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Generate failed");
    }
  };

  const splitDraft = async () => {
    const text = draft.trim();
    if (!text || !selected) return;
    try {
      const data = await api.split(selected, text, "sentence");
      setDetail(data);
      setMode("script");
      setStatus(`Split into ${data.lines.length} lines`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Split failed");
    }
  };

  const applyStory = async () => {
    const show = await ensureShow();
    const data = await api.story(show.name, story);
    setDetail(data);
    setSelected(data.name);
    setMode("story");
  };

  const renderAll = async () => {
    if (!selected) return;
    if (mode === "story") await applyStory();
    await api.render(selected);
  };

  const selectedIndices = activeLine ? [activeLine] : [];

  return (
    <div
      className={`app${dropOver ? " drop" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDropOver(true);
      }}
      onDragLeave={() => setDropOver(false)}
      onDrop={onDrop}
    >
      <header className="topbar">
        <div className="brand">
          <b>612 Voice</b>
          <span>local studio</span>
        </div>
        <div className="grow" />
        <span className={`pill ${health?.chatterbox ? "ok" : "warn"}`}>
          {health?.device || "…"} {health?.chatterbox ? "Chatterbox" : "no clone engine"}
        </span>
        {health?.macos_say ? <span className="pill">Say</span> : null}
        <button className="ghost" onClick={() => fileRef.current?.click()}>
          <Upload size={14} /> Voice
        </button>
        <button
          className="pull"
          onClick={async () => {
            const created = await api.createShow("New show");
            await loadShows();
            setSelected(created.name);
          }}
        >
          <Plus size={14} /> Show
        </button>
        <input
          ref={fileRef}
          type="file"
          hidden
          accept="audio/*,.wav,.mp3,.m4a"
          onChange={(e) => {
            if (e.target.files) ingestVoices(e.target.files);
            e.target.value = "";
          }}
        />
      </header>

      <div className="studio">
        <aside className="library">
          <div className="pane-head">Voices</div>
          <button className="dropzone" onClick={() => fileRef.current?.click()}>
            Drop a 5–15s WAV, or import YouTube below.
          </button>
          <div className="yt">
            <input value={ytUrl} onChange={(e) => setYtUrl(e.target.value)} placeholder="YouTube URL" />
            <input value={ytName} onChange={(e) => setYtName(e.target.value)} placeholder="Name" />
            <div className="yt-row">
              <input value={ytStart} onChange={(e) => setYtStart(e.target.value)} placeholder="0:12" />
              <button
                className="tiny"
                disabled={!ytUrl || busy}
                onClick={async () => {
                  await api.youtubeVoice({ url: ytUrl, name: ytName, start: ytStart, duration: 15 });
                  setStatus("Downloading voice clip…");
                }}
              >
                <Youtube size={12} /> Grab
              </button>
            </div>
          </div>
          <ul className="project-list">
            {voices.map((voice) => (
              <li key={voice.id}>
                <button
                  className="project"
                  onClick={() => {
                    if (selected && detail) {
                      api.patchShow(selected, { cast: { ...detail.cast, A: voice.id } }).then(setDetail);
                    }
                  }}
                >
                  <strong>{voice.name}</strong>
                  <em>
                    {voice.source} · {fmtDur(voice.duration)}
                  </em>
                </button>
              </li>
            ))}
            {!voices.length ? <p className="empty">No cloned voices yet.</p> : null}
          </ul>

          <div className="pane-head">Shows</div>
          <ul className="project-list">
            {shows.map((show) => (
              <li key={show.name}>
                <button className={`project${selected === show.name ? " on" : ""}`} onClick={() => setSelected(show.name)}>
                  <strong>{show.title}</strong>
                  <em>
                    {show.rendered}/{show.lines} lines {show.has_mix ? "· mix" : ""}
                  </em>
                </button>
              </li>
            ))}
            {!shows.length ? <p className="empty">New show to start a script.</p> : null}
          </ul>
        </aside>

        <main className="stage">
          {!detail ? (
            <div className="empty-stage">
              <Mic size={28} />
              <h1>Free local voice for content</h1>
              <p>
                Same job as TTS-MAc — clone, batch-render, concat — with a studio layout closer to Voicebox and Speaker 1–4
                stories in the spirit of VibeVoice. Chatterbox stays on this Mac.
              </p>
            </div>
          ) : (
            <>
              <div className="stage-head">
                <div>
                  <h1>{detail.title}</h1>
                  <p>
                    {detail.rendered}/{detail.lines.length} rendered
                    {detail.has_mix ? ` · mix ${fmtDur(detail.duration)}` : ""}
                  </p>
                </div>
                <div className="actions">
                  <button className={mode === "line" ? "tiny on" : "tiny"} onClick={() => setMode("line")}>
                    Line
                  </button>
                  <button className={mode === "script" ? "tiny on" : "tiny"} onClick={() => setMode("script")}>
                    Script
                  </button>
                  <button className={mode === "story" ? "tiny on" : "tiny"} onClick={() => setMode("story")}>
                    Story
                  </button>
                  <button className="ghost" disabled={busy || !detail.lines.length} onClick={renderAll}>
                    {busy ? <LoaderCircle size={14} className="spin" /> : <Sparkles size={14} />} Render
                  </button>
                  <button className="pull" disabled={busy || !detail.rendered} onClick={() => selected && api.concat(selected)}>
                    <Clapperboard size={14} /> Concat
                  </button>
                </div>
              </div>

              {mode === "line" ? (
                <div className="card compose-card">
                  <textarea
                    className="compose"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Write one narration line. Generate clones it. Split turns a paste into a script."
                  />
                  <div className="actions">
                    <button className="pull" disabled={!draft.trim() || busy} onClick={generateDraft}>
                      Generate
                    </button>
                    <button className="ghost" disabled={!draft.trim() || !selected} onClick={splitDraft}>
                      Split to script
                    </button>
                  </div>
                </div>
              ) : null}

              {mode === "script" ? (
                <div className="card">
                  <textarea
                    className="compose short"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Paste a narration. Split into sentences, then render."
                  />
                  <div className="actions">
                    <button className="ghost" disabled={!draft.trim() || !selected} onClick={splitDraft}>
                      Split
                    </button>
                  </div>
                  <LineTable
                    detail={detail}
                    activeLine={activeLine}
                    voices={voices}
                    onSelect={setActiveLine}
                    onChange={async (lines) => {
                      if (!selected) return;
                      setDetail(await api.patchShow(selected, { lines }));
                    }}
                  />
                </div>
              ) : null}

              {mode === "story" ? (
                <div className="card">
                  <p className="hint">
                    Label turns like Voicebox stories / VibeVoice podcasts: <code>Speaker 1:</code> through{" "}
                    <code>Speaker 4:</code>. Each maps to a cloned voice. Render is sequential Chatterbox, not Microsoft’s
                    pulled TTS code.
                  </p>
                  <textarea className="compose" value={story} onChange={(e) => setStory(e.target.value)} />
                  <div className="cast">
                    {SPEAKERS.map((slot) => (
                      <label key={slot} className="field">
                        Speaker {slot}
                        <select
                          value={detail.cast?.[slot] || ""}
                          onChange={async (e) => {
                            if (!selected) return;
                            setDetail(await api.patchShow(selected, { cast: { ...detail.cast, [slot]: e.target.value } }));
                          }}
                        >
                          <option value="">—</option>
                          {voices.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                  <button className="ghost" onClick={applyStory}>
                    Parse speakers
                  </button>
                  <div className="timeline">
                    {detail.lines.map((ln) => (
                      <button
                        key={ln.index}
                        className={`clip${activeLine === ln.index ? " on" : ""}`}
                        style={{ borderColor: SPEAKER_COLOR[ln.speaker] || "var(--line)" }}
                        onClick={() => setActiveLine(ln.index)}
                      >
                        <b style={{ color: SPEAKER_COLOR[ln.speaker] }}>{ln.speaker}</b>
                        <span>{ln.text}</span>
                        <em>{ln.has_audio ? fmtDur(ln.duration) : "empty"}</em>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="card wave-card">
                <header className="player-toolbar">
                  <button
                    className="ghost"
                    disabled={!playSrc}
                    onClick={() => {
                      const el = audioRef.current;
                      if (!el) return;
                      if (playing) {
                        el.pause();
                        setPlaying(false);
                      } else {
                        el.play();
                        setPlaying(true);
                      }
                    }}
                  >
                    {playing ? <Pause size={14} /> : <Play size={14} />}
                  </button>
                  <span className="hint">
                    {currentLine ? `Line ${currentLine.index}` : "Mix"} {currentLine?.qc ? `· ${currentLine.qc}` : ""}
                  </span>
                </header>
                <Waveform
                  peaks={currentLine?.peaks?.length ? currentLine.peaks : detail.mix_peaks}
                  color={SPEAKER_COLOR[currentLine?.speaker || "A"]}
                />
                {playSrc ? (
                  <audio
                    ref={audioRef}
                    className="source-audio"
                    src={playSrc}
                    controls
                    onPlay={() => setPlaying(true)}
                    onPause={() => setPlaying(false)}
                    onEnded={() => setPlaying(false)}
                  />
                ) : null}
                {activeJob ? (
                  <div className="job-line">
                    <span>
                      {kindLabel(activeJob.kind)} · {activeJob.step}
                    </span>
                    <span>{Math.round(activeJob.progress * 100)}%</span>
                    <div className="bar">
                      <i style={{ width: `${Math.round(activeJob.progress * 100)}%` }} />
                    </div>
                  </div>
                ) : null}
              </div>
            </>
          )}
        </main>

        <aside className="inspector">
          <div className="pane-head">Engine</div>
          <label className="field">
            Synthesis
            <select
              value={detail?.engine || "chatterbox"}
              disabled={!detail}
              onChange={async (e) => {
                if (!selected) return;
                setDetail(await api.patchShow(selected, { engine: e.target.value }));
              }}
            >
              <option value="chatterbox">Chatterbox clone</option>
              <option value="macos">macOS Say (scratch)</option>
            </select>
          </label>
          <p className="hint">
            Chatterbox is the production engine. Say is for checking the UI without loading the 3 GB model.
          </p>

          <div className="pane-head">Emphasis</div>
          <div className="actions wrap">
            {["normal", "emphasis", "dramatic", "calm", "whisper"].map((preset) => (
              <button
                key={preset}
                className="tiny"
                disabled={!selected || !selectedIndices.length}
                onClick={async () => {
                  if (!selected || !activeLine) return;
                  setDetail(await api.emphasis(selected, [activeLine], preset));
                }}
              >
                {preset}
              </button>
            ))}
          </div>

          <div className="pane-head">Delivery</div>
          {currentLine && selected ? (
            <>
              <label className="field">
                Exaggeration {currentLine.exaggeration.toFixed(2)}
                <input
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={currentLine.exaggeration}
                  onChange={(e) => {
                    const lines = detail!.lines.map((ln) =>
                      ln.index === currentLine.index ? { ...ln, exaggeration: Number(e.target.value) } : ln,
                    );
                    setDetail({ ...detail!, lines });
                  }}
                  onMouseUp={() => selected && api.patchShow(selected, { lines: detail!.lines }).then(setDetail)}
                />
              </label>
              <label className="field">
                CFG {currentLine.cfg_weight.toFixed(2)}
                <input
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={currentLine.cfg_weight}
                  onChange={(e) => {
                    const lines = detail!.lines.map((ln) =>
                      ln.index === currentLine.index ? { ...ln, cfg_weight: Number(e.target.value) } : ln,
                    );
                    setDetail({ ...detail!, lines });
                  }}
                  onMouseUp={() => selected && api.patchShow(selected, { lines: detail!.lines }).then(setDetail)}
                />
              </label>
            </>
          ) : (
            <p className="hint">Select a line to tune exaggeration and pacing.</p>
          )}

          <div className="pane-head">Mix</div>
          {detail ? (
            <>
              <label className="field">
                Gap {Number(detail.settings.gap ?? 0.35).toFixed(2)}s
                <input
                  type="range"
                  min={0}
                  max={1.2}
                  step={0.05}
                  value={detail.settings.gap ?? 0.35}
                  onChange={async (e) => {
                    if (!selected) return;
                    setDetail(await api.patchShow(selected, { settings: { ...detail.settings, gap: Number(e.target.value) } }));
                  }}
                />
              </label>
              <label className="field">
                <span>
                  <input
                    type="checkbox"
                    checked={detail.settings.qc !== false}
                    onChange={async (e) => {
                      if (!selected) return;
                      setDetail(await api.patchShow(selected, { settings: { ...detail.settings, qc: e.target.checked } }));
                    }}
                  />{" "}
                  QC + retry
                </span>
              </label>
            </>
          ) : null}

          <div className="pane-head">Effects</div>
          <label className="field">
            Gain {gain} dB
            <input type="range" min={-12} max={12} step={1} value={gain} onChange={(e) => setGain(Number(e.target.value))} />
          </label>
          <label className="field">
            Pitch {pitch}
            <input type="range" min={-7} max={7} step={1} value={pitch} onChange={(e) => setPitch(Number(e.target.value))} />
          </label>
          <label className="field">
            Reverb {reverb.toFixed(2)}
            <input type="range" min={0} max={0.6} step={0.05} value={reverb} onChange={(e) => setReverb(Number(e.target.value))} />
          </label>
          <button
            className="ghost wide"
            disabled={!selected || !activeLine || busy}
            onClick={() =>
              selected &&
              activeLine &&
              api.effects(selected, { index: activeLine, gain_db: gain, pitch_semitones: pitch, reverb })
            }
          >
            Apply to take
          </button>

          <div className="pane-head">Queue</div>
          <ul className="jobs">
            {jobs.slice(0, 8).map((job) => (
              <li key={job.id}>
                <em className={job.status}>{job.status}</em>
                <span>
                  {kindLabel(job.kind)} {job.project === "_voices" ? "" : job.project}
                </span>
                {(job.status === "queued" || job.status === "running") && (
                  <button className="tiny" onClick={() => api.cancel(job.id)}>
                    x
                  </button>
                )}
              </li>
            ))}
            {!jobs.length ? <p className="empty">Idle.</p> : null}
          </ul>

          {selected ? (
            <button
              className="ghost danger wide"
              onClick={async () => {
                await api.removeShow(selected);
                setSelected(null);
                setDetail(null);
                await loadShows();
              }}
            >
              <Trash2 size={14} /> Delete show
            </button>
          ) : null}
        </aside>
      </div>

      <footer className="status">
        <span>{status}</span>
        <span>
          {voices.length} voices · {shows.length} shows
        </span>
      </footer>
    </div>
  );
}

function LineTable({
  detail,
  activeLine,
  voices,
  onSelect,
  onChange,
}: {
  detail: ShowDetail;
  activeLine: number | null;
  voices: Voice[];
  onSelect: (index: number) => void;
  onChange: (lines: Line[]) => void;
}) {
  return (
    <table className="lines">
      <thead>
        <tr>
          <th>#</th>
          <th>Text</th>
          <th>Voice</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {detail.lines.map((ln) => (
          <tr key={ln.index} className={activeLine === ln.index ? "on" : ""} onClick={() => onSelect(ln.index)}>
            <td>{ln.index}</td>
            <td>
              <input
                value={ln.text}
                onChange={(e) =>
                  onChange(detail.lines.map((row) => (row.index === ln.index ? { ...row, text: e.target.value } : row)))
                }
              />
            </td>
            <td>
              <select
                value={ln.voice}
                onChange={(e) =>
                  onChange(detail.lines.map((row) => (row.index === ln.index ? { ...row, voice: e.target.value } : row)))
                }
              >
                {voices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </td>
            <td>{ln.has_audio ? fmtDur(ln.duration) : ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
