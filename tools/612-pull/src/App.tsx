import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  Check,
  ChevronRight,
  Cookie,
  Download,
  FolderOpen,
  ListMusic,
  LoaderCircle,
  Music2,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { api, events, fmtDur, fmtEta, fmtSize, fmtSpeed, fmtViews, shortPath } from "./api";
import type { Health, Job, Probe, Settings } from "./types";
import Watch from "./Watch";

const EMPTY_SETTINGS: Settings = {
  video_folder: "",
  music_folder: "",
  mode: "video",
  quality: "Best Available",
  audio_quality: "Best (original)",
  container: "Auto",
  playlist: false,
  subtitles: true,
  sponsorblock: "off",
  auto_open: false,
  cookies_browser: "None",
  cookie_file: "",
};

export default function App() {
  const [settings, setSettings] = useState<Settings>(EMPTY_SETTINGS);
  const [health, setHealth] = useState<Health | null>(null);
  const [draft, setDraft] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [probes, setProbes] = useState<Probe[]>([]);
  const [probeErrors, setProbeErrors] = useState<{ url: string; error: string }[]>([]);
  const [probing, setProbing] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "active" | "done">("all");
  const [status, setStatus] = useState("Paste a URL. 612 Pull probes it before anything hits disk.");
  const [dropOver, setDropOver] = useState(false);
  const [screen, setScreen] = useState<"pull" | "watch">("pull");
  const [watchPath, setWatchPath] = useState<string | null>(null);
  const probeTimer = useRef<number | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const patchSettings = useCallback(async (next: Partial<Settings>) => {
    setSettings((prev) => ({ ...prev, ...next }));
    try {
      const saved = await api.saveSettings(next);
      setSettings(saved);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Could not save settings");
    }
  }, []);

  useEffect(() => {
    const loadHealth = () => {
      api
        .health()
        .then(setHealth)
        .catch(() => setHealth(null));
    };
    loadHealth();
    const tick = window.setInterval(loadHealth, 4000);
    api.settings().then(setSettings).catch(() => undefined);
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
      }
      if (data.type === "removed" && typeof data.id === "string") {
        setJobs((prev) => prev.filter((j) => j.id !== data.id));
      }
    });
    return () => {
      window.clearInterval(tick);
      stop();
    };
  }, []);

  const runProbe = useCallback(
    async (text: string, playlist = settings.playlist) => {
      const trimmed = text.trim();
      if (!/^https?:/m.test(trimmed)) {
        setProbes([]);
        setProbeErrors([]);
        return;
      }
      setProbing(true);
      setStatus("Reading metadata…");
      try {
        const result = await api.probe(trimmed, playlist);
        setProbes(result.items);
        setProbeErrors(result.errors);
        if (result.items[0]?.suggested_mode && result.items[0].suggested_mode !== settings.mode) {
          await patchSettings({ mode: result.items[0].suggested_mode as "audio" | "video" });
        }
        const n = result.items.length;
        const err = result.errors.length;
        setStatus(
          n
            ? `Ready: ${n} source${n === 1 ? "" : "s"}${err ? ` · ${err} failed` : ""}`
            : result.errors[0]?.error || "Nothing readable in that paste.",
        );
      } catch (err) {
        setStatus(err instanceof Error ? err.message : "Probe failed");
      } finally {
        setProbing(false);
      }
    },
    [patchSettings, settings.mode, settings.playlist],
  );

  const scheduleProbe = (text: string) => {
    if (probeTimer.current) window.clearTimeout(probeTimer.current);
    probeTimer.current = window.setTimeout(() => runProbe(text), 450);
  };

  const onDraft = (value: string) => {
    setDraft(value);
    scheduleProbe(value);
  };

  const selectedEntries = probes[0]?.entries ?? [];
  const playlistSelection = selectedEntries.filter((e) => e.selected).map((e) => e.index);
  const playlistItems =
    probes[0]?.is_playlist && playlistSelection.length && playlistSelection.length !== selectedEntries.length
      ? playlistSelection.join(",")
      : undefined;

  const videoQualities = health?.qualities.video?.length
    ? health.qualities.video
    : ["Best Available", "8K", "4K HDR", "4K / 2160p", "1440p", "1080p", "720p", "Social / Fast", "480p", "360p"];
  const audioQualities = health?.qualities.audio?.length
    ? health.qualities.audio
    : ["Best (original)", "320kbps", "256kbps", "192kbps", "128kbps", "96kbps", "64kbps"];
  const containers = health?.qualities.containers?.length
    ? health.qualities.containers
    : ["Auto", "MP4", "MKV", "WebM"];

  const pull = async () => {
    const items =
      probes.length > 0
        ? probes.map((p) => ({
            url: p.webpage_url || p.url,
            title: p.title,
            thumbnail: p.thumbnail,
            uploader: p.uploader,
            duration: p.duration,
            playlist_items: p.is_playlist ? playlistItems : undefined,
          }))
        : draft
            .split(/\s+/)
            .filter((u) => /^https?:/i.test(u))
            .map((url) => ({ url }));
    if (!items.length) {
      setStatus("Paste a URL first.");
      return;
    }
    setPulling(true);
    try {
      const result = await api.enqueue({ items, overrides: settings });
      setSelectedId(result.jobs[0]?.id ?? null);
      setStatus(`Queued ${result.jobs.length} pull${result.jobs.length === 1 ? "" : "s"}.`);
      setFilter("active");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Could not queue");
    } finally {
      setPulling(false);
    }
  };

  const pullRef = useRef(pull);
  pullRef.current = pull;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void pullRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const visible = useMemo(() => {
    if (filter === "active") return jobs.filter((j) => j.status === "queued" || j.status === "downloading" || j.status === "postprocessing");
    if (filter === "done") return jobs.filter((j) => j.status === "done" || j.status === "error" || j.status === "cancelled");
    return jobs;
  }, [filter, jobs]);

  const selectedJob = jobs.find((j) => j.id === selectedId) || null;
  const inspectProbe = probes[0] || null;
  const activeCount = jobs.filter((j) => j.status === "queued" || j.status === "downloading" || j.status === "postprocessing").length;

  const pasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) {
        setDraft(text.trim());
        await runProbe(text.trim());
      }
    } catch {
      areaRef.current?.focus();
      setStatus("Clipboard blocked — paste into the box (⌘V).");
    }
  };

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    setDropOver(false);
    const file = e.dataTransfer.files[0];
    const text = e.dataTransfer.getData("text/plain") || e.dataTransfer.getData("text/uri-list");
    if (file && (file.type.startsWith("text") || file.name.endsWith(".txt"))) {
      const body = await file.text();
      setDraft(body);
      await runProbe(body);
      return;
    }
    if (text.trim()) {
      setDraft(text.trim());
      await runProbe(text.trim());
    }
  };

  const updateYtdlp = async () => {
    setUpdating(true);
    setStatus("Updating yt-dlp…");
    try {
      const res = await api.updateYtdlp();
      setHealth((h) => (h ? { ...h, ytdlp: res.version } : h));
      setStatus(`yt-dlp ${res.version}`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Update failed");
    } finally {
      setUpdating(false);
    }
  };

  const browse = async (which: "video_folder" | "music_folder") => {
    const { path } = await api.browseFolder();
    if (path) await patchSettings({ [which]: path });
  };

  const loadCookies = async () => {
    const { path } = await api.browseFile();
    if (path) await patchSettings({ cookie_file: path, cookies_browser: "None" });
  };

  const toggleEntry = (index: number) => {
    setProbes((prev) =>
      prev.map((p, i) =>
        i === 0
          ? { ...p, entries: p.entries.map((e) => (e.index === index ? { ...e, selected: !e.selected } : e)) }
          : p,
      ),
    );
  };

  const missing = health && (!health.ffmpeg || !health.node);

  return (
    <div
      className="app"
      onDragOver={(e) => {
        e.preventDefault();
        if (screen === "pull") setDropOver(true);
      }}
      onDragLeave={() => setDropOver(false)}
      onDrop={onDrop}
    >
      <header className="topbar">
        <div className="brand">
          <b>612 Pull</b>
          <span>local · yt-dlp</span>
        </div>
        <div className="seg" role="tablist">
          <button className={screen === "pull" ? "on" : ""} onClick={() => setScreen("pull")}>
            <Download size={14} /> Pull
          </button>
          <button
            className={screen === "watch" ? "on" : ""}
            onClick={() => {
              setScreen("watch");
              setStatus("Watch plays MKV / VP9 / AV1 / Opus that QuickTime refuses.");
            }}
          >
            <Play size={14} /> Watch
          </button>
        </div>
        {screen === "pull" && (
          <div className="seg" role="tablist">
            <button
              className={settings.mode === "video" ? "on" : ""}
              onClick={() => patchSettings({ mode: "video" })}
            >
              <Video size={14} /> Video
            </button>
            <button
              className={settings.mode === "audio" ? "on audio" : ""}
              onClick={() => patchSettings({ mode: "audio" })}
            >
              <Music2 size={14} /> Audio
            </button>
          </div>
        )}
        <div className="grow" />
        <div className="health">
          {!health ? (
            <span className="bad">API offline — start with ./run.sh</span>
          ) : (
            <>
              <span className={health.ffmpeg ? "ok" : "bad"}>ffmpeg {health.ffmpeg ? "ready" : "missing"}</span>
              <span className={health.node ? "ok" : "bad"}>node {health.node ? "ready" : "missing"}</span>
              <span className={health.pot ? "ok" : "bad"}>youtube {health.pot ? "ready" : "needs helper"}</span>
              <span>yt-dlp {health.ytdlp || "—"}</span>
            </>
          )}
        </div>
        <button className="ghost" onClick={updateYtdlp} disabled={updating}>
          <RefreshCw size={14} className={updating ? "spin" : ""} /> Update yt-dlp
        </button>
      </header>

      {screen === "watch" ? (
        <Watch initialPath={watchPath} onStatus={setStatus} />
      ) : (
      <div className={`workspace ${dropOver ? "drop" : ""}`}>
        <aside className="composer">
          <div className="block-label">Source</div>
          <textarea
            ref={areaRef}
            value={draft}
            onChange={(e) => onDraft(e.target.value)}
            placeholder="Paste YouTube, TikTok, Twitch, SoundCloud, Vimeo… one URL or a whole list."
            spellCheck={false}
          />
          <div className="row wrap">
            <button className="ghost" onClick={pasteClipboard}>
              Paste
            </button>
            <button className="ghost" onClick={() => runProbe(draft)} disabled={probing}>
              {probing ? <LoaderCircle size={14} className="spin" /> : null}
              Probe
            </button>
            <label className="check">
              <input
                type="checkbox"
                checked={settings.playlist}
                onChange={(e) => {
                  void patchSettings({ playlist: e.target.checked });
                  if (draft.trim()) void runProbe(draft, e.target.checked);
                }}
              />
              Full playlist
            </label>
          </div>

          {inspectProbe && (
            <div className="probe-mini">
              {inspectProbe.thumbnail ? <img src={inspectProbe.thumbnail} alt="" /> : <div className="ph" />}
              <div>
                <strong>{inspectProbe.title}</strong>
                <span>
                  {inspectProbe.platform.name}
                  {inspectProbe.uploader ? ` · ${inspectProbe.uploader}` : ""}
                  {inspectProbe.duration ? ` · ${fmtDur(inspectProbe.duration)}` : ""}
                  {inspectProbe.max_height ? ` · ${inspectProbe.max_height}p` : ""}
                  {inspectProbe.has_hdr ? " · HDR" : ""}
                  {inspectProbe.is_playlist ? ` · ${inspectProbe.playlist_count} items` : ""}
                </span>
              </div>
            </div>
          )}
          {probes.length > 1 && (
            <div className="muted tiny">{probes.length} sources probed — Pull queues all of them.</div>
          )}

          <div className="block-label">{settings.mode === "audio" ? "Audio quality" : "Video quality"}</div>
          <div className="chips">
            {(settings.mode === "audio" ? audioQualities : videoQualities).map((q) => {
              const on = settings.mode === "audio" ? settings.audio_quality === q : settings.quality === q;
              return (
                <button
                  key={q}
                  className={`chip ${on ? "on" : ""}`}
                  onClick={() =>
                    patchSettings(settings.mode === "audio" ? { audio_quality: q } : { quality: q })
                  }
                >
                  {q}
                </button>
              );
            })}
          </div>

          {settings.mode === "video" && (
            <>
              <div className="block-label">Container</div>
              <div className="chips">
                {containers.map((c) => (
                  <button
                    key={c}
                    className={`chip ${settings.container === c ? "on" : ""}`}
                    onClick={() => patchSettings({ container: c })}
                  >
                    {c}
                  </button>
                ))}
              </div>
              <p className="muted tiny">
                Auto/MKV keeps YouTube VP9/AV1. QuickTime cannot play that — use Watch, or Save QuickTime MP4.
              </p>
            </>
          )}

          <div className="block-label">Folders</div>
          <button className="path-btn" onClick={() => browse("video_folder")} title={settings.video_folder}>
            <FolderOpen size={14} />
            <span>Video · {shortPath(settings.video_folder)}</span>
          </button>
          <button className="path-btn" onClick={() => browse("music_folder")} title={settings.music_folder}>
            <Music2 size={14} />
            <span>Music · {shortPath(settings.music_folder)}</span>
          </button>

          <div className="block-label">Cookies</div>
          <div className="row wrap">
            <select
              value={settings.cookies_browser}
              onChange={(e) => patchSettings({ cookies_browser: e.target.value })}
            >
              {(health?.qualities.browsers || ["None"]).map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
            <button className="ghost" onClick={loadCookies}>
              <Cookie size={14} /> File
            </button>
            {settings.cookie_file ? (
              <button className="ghost" onClick={() => patchSettings({ cookie_file: "" })}>
                Clear
              </button>
            ) : null}
          </div>
          {settings.cookie_file ? <div className="muted tiny">{settings.cookie_file.split("/").pop()}</div> : null}

          <div className="toggles">
            <label className="check">
              <input
                type="checkbox"
                checked={settings.subtitles}
                onChange={(e) => patchSettings({ subtitles: e.target.checked })}
              />
              Subtitles + transcript
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={settings.auto_open}
                onChange={(e) => patchSettings({ auto_open: e.target.checked })}
              />
              Open folder when done
            </label>
            <div className="row gap">
              <span className="muted tiny">SponsorBlock</span>
              <select
                value={settings.sponsorblock}
                onChange={(e) => patchSettings({ sponsorblock: e.target.value as Settings["sponsorblock"] })}
              >
                <option value="off">Off</option>
                <option value="mark">Mark chapters</option>
                <option value="remove">Strip sponsor</option>
              </select>
            </div>
          </div>

          <button className="pull" onClick={() => void pull()} disabled={pulling || probing}>
            {pulling ? <LoaderCircle size={16} className="spin" /> : <Download size={16} />}
            Pull {probes.length > 1 ? `${probes.length} URLs` : inspectProbe?.is_playlist ? "playlist" : "now"}
          </button>
          <div className="hint">⌘/Ctrl + Return</div>
        </aside>

        <main className="queue">
          <div className="queue-head">
            <div className="block-label flush">Queue {activeCount ? `· ${activeCount} live` : ""}</div>
            <div className="seg small">
              {(["all", "active", "done"] as const).map((f) => (
                <button key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>
                  {f}
                </button>
              ))}
            </div>
          </div>
          {visible.length === 0 ? (
            <div className="empty">
              <Download size={28} />
              <h2>Nothing in the queue</h2>
              <p>
                Probe first — 612 Pull shows title, duration, and the formats yt-dlp can actually get — then pull.
                Drop a URL or a .txt list anywhere.
              </p>
            </div>
          ) : (
            <ul className="cards">
              {visible.map((job) => (
                <li key={job.id}>
                  <button
                    className={`card ${selectedId === job.id ? "sel" : ""} ${job.status}`}
                    onClick={() => setSelectedId(job.id)}
                  >
                    {job.thumbnail ? <img src={job.thumbnail} alt="" /> : <div className="ph" />}
                    <div className="card-body">
                      <div className="card-top">
                        <strong>{job.title}</strong>
                        <em>{job.status}</em>
                      </div>
                      <div className="meta">
                        {job.platform?.name}
                        {job.uploader ? ` · ${job.uploader}` : ""}
                        {job.duration ? ` · ${fmtDur(job.duration)}` : ""}
                        {job.mode === "audio" ? ` · ${job.audio_quality}` : ` · ${job.quality}`}
                      </div>
                      {(job.status === "downloading" || job.status === "postprocessing" || job.status === "queued") && (
                        <div className="bar-wrap">
                          <div className="bar">
                            <i style={{ width: `${job.percent}%` }} />
                          </div>
                          <span>
                            {job.percent}%
                            {job.status === "downloading" ? ` · ${fmtSpeed(job.speed)} · ETA ${fmtEta(job.eta)}` : ""}
                          </span>
                        </div>
                      )}
                      {job.status === "done" && job.quality_note ? <div className="note">{job.quality_note}</div> : null}
                      {job.status === "error" ? <div className="err">{job.error}</div> : null}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </main>

        <aside className="inspector">
          {selectedJob ? (
            <JobInspect
              job={selectedJob}
              onWatch={(path) => {
                setWatchPath(path);
                setScreen("watch");
              }}
            />
          ) : inspectProbe ? (
            <ProbeInspect
              probe={inspectProbe}
              onToggle={toggleEntry}
              onSelectAll={(on) =>
                setProbes((prev) =>
                  prev.map((p, i) => (i === 0 ? { ...p, entries: p.entries.map((e) => ({ ...e, selected: on })) } : p)),
                )
              }
            />
          ) : (
            <div className="empty inspect">
              <ListMusic size={22} />
              <h2>Inspector</h2>
              <p>Formats, chapters, and playlist picks land here after a probe. Select a queue card to manage a job.</p>
            </div>
          )}
        </aside>
      </div>
      )}

      <footer className="status">
        {missing ? (
          <span className="bad">Install ffmpeg and Node.js (Homebrew) for 4K merges, Watch, and YouTube PO tokens.</span>
        ) : !health ? (
          <span className="bad">Local API is down. From 612-pull run ./run.sh</span>
        ) : null}
        <span>{status}</span>
        {probeErrors[0] ? <span className="bad">{probeErrors[0].error}</span> : null}
      </footer>
    </div>
  );
}

function JobInspect({ job, onWatch }: { job: Job; onWatch: (path: string) => void }) {
  return (
    <div className="inspect-body">
      <div className="block-label flush">Job</div>
      {job.thumbnail ? <img className="hero" src={job.thumbnail} alt="" /> : null}
      <h3>{job.title}</h3>
      <p className="muted">
        {job.platform?.name} · {job.mode} · {job.mode === "audio" ? job.audio_quality : `${job.quality} · ${job.container}`}
      </p>
      <div className="row wrap">
        {(job.status === "queued" || job.status === "downloading") && (
          <button className="ghost" onClick={() => api.cancel(job.id)}>
            <Pause size={14} /> Cancel
          </button>
        )}
        {(job.status === "error" || job.status === "cancelled") && (
          <button className="ghost" onClick={() => api.retry(job.id)}>
            <RotateCcw size={14} /> Retry
          </button>
        )}
        {job.folder && (
          <button className="ghost" onClick={() => api.open(job.folder)}>
            <FolderOpen size={14} /> Folder
          </button>
        )}
        {job.filename && (
          <button className="ghost" onClick={() => onWatch(job.filename)}>
            <Play size={14} /> Watch
          </button>
        )}
        {job.filename && (
          <button className="ghost" onClick={() => api.open(job.filename, true)}>
            <ChevronRight size={14} /> Reveal
          </button>
        )}
        <button className="ghost danger" onClick={() => api.remove(job.id)}>
          <Trash2 size={14} /> Remove
        </button>
      </div>
      {job.quality_note ? <div className="note">{job.quality_note}</div> : null}
      {job.error ? <div className="err">{job.error}</div> : null}
      {job.filename ? <div className="tiny muted break">{job.filename}</div> : null}
    </div>
  );
}

function ProbeInspect({
  probe,
  onToggle,
  onSelectAll,
}: {
  probe: Probe;
  onToggle: (index: number) => void;
  onSelectAll: (on: boolean) => void;
}) {
  const videoFormats = probe.formats.filter((f) => f.vcodec && f.height);
  const audioFormats = probe.formats.filter((f) => f.acodec && !f.vcodec);
  return (
    <div className="inspect-body">
      <div className="block-label flush">Inspector</div>
      {probe.thumbnail ? <img className="hero" src={probe.thumbnail} alt="" /> : null}
      <h3>{probe.title}</h3>
      <p className="muted">
        {probe.platform.name}
        {probe.uploader ? ` · ${probe.uploader}` : ""}
        {probe.duration ? ` · ${fmtDur(probe.duration)}` : ""}
        {probe.max_height ? ` · max ${probe.max_height}p` : ""}
        {probe.has_hdr ? " · HDR" : ""}
        {probe.view_count ? ` · ${fmtViews(probe.view_count)}` : ""}
      </p>
      {probe.platform.id === "music.youtube.com" && (
        <p className="desc">
          YouTube Music is audio. 612 Pull switches to Audio and saves m4a/opus with cover art. Video only works
          when the track has a real music video — Auto merges that to MKV, not a leftover .webm.part.
        </p>
      )}
      {probe.description ? <p className="desc">{probe.description}</p> : null}

      {probe.is_playlist && (
        <>
          <div className="row spread">
            <div className="block-label flush">Playlist · {probe.entries.filter((e) => e.selected).length}/{probe.entries.length}</div>
            <div className="row">
              <button className="ghost tiny-btn" onClick={() => onSelectAll(true)}>
                All
              </button>
              <button className="ghost tiny-btn" onClick={() => onSelectAll(false)}>
                None
              </button>
            </div>
          </div>
          <ul className="entries">
            {probe.entries.map((entry) => (
              <li key={entry.index}>
                <button className={entry.selected ? "on" : ""} onClick={() => onToggle(entry.index)}>
                  {entry.selected ? <Check size={12} /> : <X size={12} />}
                  <span className="idx">{entry.index}</span>
                  <span className="grow">{entry.title}</span>
                  <span className="muted">{fmtDur(entry.duration)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {videoFormats.length > 0 && (
        <>
          <div className="block-label">Video formats yt-dlp can see</div>
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Res</th>
                <th>FPS</th>
                <th>Codec</th>
                <th>Size</th>
                <th>DR</th>
              </tr>
            </thead>
            <tbody>
              {videoFormats.slice(0, 18).map((f) => (
                <tr key={f.id}>
                  <td>{f.id}</td>
                  <td>{f.height ? `${f.height}p` : f.note || "—"}</td>
                  <td>{f.fps || "—"}</td>
                  <td>{(f.vcodec || "").split(".")[0]}</td>
                  <td>{fmtSize(f.size)}</td>
                  <td>{f.dynamic_range === "SDR" ? "" : f.dynamic_range}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {audioFormats.length > 0 && (
        <>
          <div className="block-label">Audio</div>
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Ext</th>
                <th>Codec</th>
                <th>kbps</th>
                <th>Size</th>
              </tr>
            </thead>
            <tbody>
              {audioFormats.slice(0, 10).map((f) => (
                <tr key={f.id}>
                  <td>{f.id}</td>
                  <td>{f.ext}</td>
                  <td>{f.acodec}</td>
                  <td>{f.abr ? Math.round(f.abr) : "—"}</td>
                  <td>{fmtSize(f.size)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {probe.chapters.length > 0 && (
        <>
          <div className="block-label">Chapters</div>
          <ul className="chapters">
            {probe.chapters.map((c, i) => (
              <li key={i}>
                <span>{fmtDur(c.start)}</span> {c.title}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
