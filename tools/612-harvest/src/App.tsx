import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  Clapperboard,
  Copy,
  FolderOpen,
  LoaderCircle,
  Plus,
  ScanSearch,
  Sparkles,
  Star,
  Trash2,
  Upload,
} from "lucide-react";
import { api, events, mediaUrl, playFor, previewFor } from "./api";
import type { Candidate, Detail, Health, Job, Section, Settings, Shot, Summary } from "./types";

const SAMPLE = `0:00-0:30 Hook
Visuals
- News studio footage
- Breaking news lower thirds
On-screen text
RARE VIRUS
HIGH FATALITY RATE
AI clips you can generate
- Microscopic virus animation

0:30-1:20 What it is
B-Roll
- Deer mouse in a shed
- Rural farmhouse at dusk
- Laboratory microscope
Motion Graphics
- World map of outbreaks`;

const ORIENT: Settings["orientation"][] = ["widescreen", "vertical", "square", "any"];
const PROVIDERS = ["wikimedia", "openverse", "nasa", "pexels", "pixabay", "unsplash"];

function kindLabel(kind: Job["kind"]) {
  return kind === "scout" ? "Scout" : "Pull";
}

function catLabel(cat: string) {
  return { stock: "B-roll", motion: "Motion", screenshot: "Still", overlay: "Text", ai: "AI" }[cat] || cat;
}

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [projects, setProjects] = useState<Summary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [sectionSlug, setSectionSlug] = useState<string | null>(null);
  const [shotId, setShotId] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<Candidate | null>(null);
  const [name, setName] = useState("Hantavirus documentary");
  const [draft, setDraft] = useState(SAMPLE);
  const [mode, setMode] = useState<"outline" | "script">("outline");
  const [status, setStatus] = useState("Paste a visual outline. Scout previews. Keep the shots. Pull only those.");
  const [dropOver, setDropOver] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [pexels, setPexels] = useState("");
  const [pixabay, setPixabay] = useState("");
  const [unsplash, setUnsplash] = useState("");
  const [extraQuery, setExtraQuery] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const loadProjects = useCallback(async () => {
    const data = await api.projects();
    setProjects(data.projects);
    return data.projects;
  }, []);

  const loadDetail = useCallback(async (slug: string) => {
    const data = await api.project(slug);
    setDetail(data);
    setSelected(slug);
    setSectionSlug((prev) => prev || data.sections[0]?.slug || null);
    return data;
  }, []);

  useEffect(() => {
    api.health().then(setHealth).catch((err) => setStatus(String(err)));
    loadProjects().catch((err) => setStatus(String(err)));
    return events((event) => {
      if (event.type === "snapshot" && Array.isArray(event.jobs)) {
        setJobs(event.jobs as Job[]);
      }
      if (event.type === "job" && event.job) {
        const job = event.job as Job;
        setJobs((prev) => {
          const next = prev.filter((j) => j.id !== job.id);
          next.unshift(job);
          return next.slice(0, 12);
        });
        if (job.status === "running") setStatus(`${kindLabel(job.kind)} · ${job.step}`);
        if (job.status === "done") {
          setStatus(`${kindLabel(job.kind)} done`);
          if (job.project) loadDetail(job.project).then(() => loadProjects());
        }
        if (job.status === "error") setStatus(job.error || "Job failed");
      }
      if (event.type === "project" && typeof event.slug === "string") {
        loadDetail(event.slug).then(() => loadProjects());
      }
    });
  }, [loadDetail, loadProjects]);

  const section = useMemo(
    () => detail?.sections.find((s) => s.slug === sectionSlug) || detail?.sections[0],
    [detail, sectionSlug],
  );
  const shot = useMemo(() => {
    const shots = section?.shots || [];
    return shots.find((s) => s.id === shotId) || shots.find((s) => s.harvest) || shots[0];
  }, [section, shotId]);
  const mosaic = useMemo(
    () => (detail?.candidates || []).filter((c) => (shot ? c.shot_id === shot.id : true)),
    [detail, shot],
  );
  const keepers = useMemo(() => (detail?.candidates || []).filter((c) => c.kept), [detail]);
  const activeJob = jobs.find((j) => j.status === "running" || j.status === "queued");

  async function onParse() {
    try {
      setStatus("Parsing outline…");
      const data = await api.parse({ text: draft, name, mode });
      setDetail(data);
      setSelected(data.slug);
      setSectionSlug(data.sections[0]?.slug || null);
      setShotId(data.sections[0]?.shots.find((s) => s.harvest)?.id || data.sections[0]?.shots[0]?.id || null);
      await loadProjects();
      setStatus(`${data.sections.length} sections · scout a shot to see previews`);
    } catch (err) {
      setStatus(String(err));
    }
  }

  async function onDrop(event: DragEvent) {
    event.preventDefault();
    setDropOver(false);
    const file = event.dataTransfer.files[0];
    if (!file) return;
    try {
      const data = await api.upload(file, name || file.name.replace(/\.[^.]+$/, ""), mode);
      setDetail(data);
      setSelected(data.slug);
      setSectionSlug(data.sections[0]?.slug || null);
      await loadProjects();
      setStatus(`Parsed ${file.name}`);
    } catch (err) {
      setStatus(String(err));
    }
  }

  async function patchSettings(partial: Partial<Settings>) {
    if (!detail) return;
    const data = await api.patch(detail.slug, { settings: { ...detail.settings, ...partial } });
    setDetail(data);
  }

  async function toggleProvider(nameKey: string) {
    if (!detail) return;
    const on = detail.settings.providers.includes(nameKey);
    const providers = on
      ? detail.settings.providers.filter((p) => p !== nameKey)
      : [...detail.settings.providers, nameKey];
    await patchSettings({ providers });
  }

  async function editShot(sectionObj: Section, shotObj: Shot, query: string) {
    if (!detail) return;
    const sections = detail.sections.map((s) =>
      s.slug !== sectionObj.slug
        ? s
        : { ...s, shots: s.shots.map((sh) => (sh.id === shotObj.id ? { ...sh, query } : sh)) },
    );
    setDetail({ ...detail, sections });
  }

  async function saveShots() {
    if (!detail) return;
    const data = await api.patch(detail.slug, { sections: detail.sections });
    setDetail(data);
    setStatus("Shot list saved");
  }

  async function scout(thisShot = true) {
    if (!detail) return;
    const job = await api.scout(detail.slug, thisShot ? shot?.id : null);
    setJobs((prev) => [job, ...prev.filter((j) => j.id !== job.id)]);
    setStatus(thisShot ? "Scouting this shot…" : "Scouting the whole reel…");
  }

  async function toggleKeep(row: Candidate) {
    if (!detail) return;
    const data = await api.keep(detail.slug, [row.uid], !row.kept);
    setDetail(data);
  }

  async function pull() {
    if (!detail) return;
    const job = await api.pull(detail.slug, true);
    setJobs((prev) => [job, ...prev.filter((j) => j.id !== job.id)]);
    setStatus("Pulling keepers…");
  }

  async function copyCredits() {
    if (!detail?.credits) return;
    await navigator.clipboard.writeText(detail.credits);
    setStatus("Credits copied for the YouTube description");
  }

  const harvestable = section?.shots.filter((s) => s.harvest) || [];

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
          <b>612 Harvest</b>
          <span>scout then keep</span>
        </div>
        <div className="grow" />
        {health?.zero_key?.map((p) => (
          <span className="pill ok" key={p}>
            {p}
          </span>
        ))}
        {health?.keys?.pexels ? <span className="pill ok">pexels</span> : <span className="pill">pexels key</span>}
        {health?.keys?.unsplash ? <span className="pill ok">unsplash</span> : <span className="pill">unsplash key</span>}
        <button className="ghost" onClick={() => setKeysOpen((v) => !v)}>
          Keys
        </button>
      </header>

      <div className="studio">
        <aside className="library">
          <div className="pane-head">New reel</div>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Project name" />
          <div className="toggle-row">
            <button className={`tiny${mode === "outline" ? " on" : ""}`} onClick={() => setMode("outline")}>
              Outline
            </button>
            <button className={`tiny${mode === "script" ? " on" : ""}`} onClick={() => setMode("script")}>
              Script
            </button>
          </div>
          <textarea
            className="compose"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
          />
          <div className="actions wrap">
            <button className="pull" onClick={onParse}>
              <ScanSearch size={14} /> Parse
            </button>
            <button className="ghost" onClick={() => fileRef.current?.click()}>
              <Upload size={14} /> File
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            hidden
            accept=".txt,.md"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const data = await api.upload(file, name || file.name, mode);
              setDetail(data);
              setSelected(data.slug);
              await loadProjects();
            }}
          />
          <p className="hint">Drop a .txt outline anywhere. Wikimedia, Openverse, and NASA work with no keys.</p>

          <div className="pane-head">Reels</div>
          <ul className="project-list">
            {projects.map((p) => (
              <li key={p.slug}>
                <button className={`row-btn${selected === p.slug ? " on" : ""}`} onClick={() => loadDetail(p.slug)}>
                  <strong>{p.name}</strong>
                  <span>
                    {p.status} · {p.kept} kept · {p.pulled} pulled
                  </span>
                </button>
                <button
                  className="tiny danger"
                  onClick={async () => {
                    await api.remove(p.slug);
                    if (selected === p.slug) {
                      setDetail(null);
                      setSelected(null);
                    }
                    await loadProjects();
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
            {!projects.length && <li className="muted">No reels yet.</li>}
          </ul>
        </aside>

        <main className="stage">
          {!detail ? (
            <div className="empty">
              <Clapperboard size={28} />
              <h2>Build a B-roll reel without dumping junk into folders</h2>
              <p>
                Clip Harvester downloads everything. 612 Harvest scouts thumbnails first, you star the keepers, then
                Pull writes bins, credits, and a Resolve FCPXML.
              </p>
            </div>
          ) : (
            <>
              <div className="reel">
                {detail.sections.map((s) => (
                  <button
                    key={s.slug}
                    className={`beat${section?.slug === s.slug ? " on" : ""}`}
                    onClick={() => {
                      setSectionSlug(s.slug);
                      const next = s.shots.find((sh) => sh.harvest) || s.shots[0];
                      setShotId(next?.id || null);
                    }}
                  >
                    <em>
                      {s.time_start || "—"}
                      {s.time_end ? `–${s.time_end}` : ""}
                    </em>
                    <strong>{s.title}</strong>
                    <span>{s.shots.filter((sh) => sh.harvest).length} shots</span>
                  </button>
                ))}
              </div>

              <div className="shot-row">
                {harvestable.map((s) => (
                  <button
                    key={s.id}
                    className={`shot-chip${shot?.id === s.id ? " on" : ""}`}
                    onClick={() => setShotId(s.id)}
                  >
                    <i>{catLabel(s.category)}</i>
                    {s.query}
                  </button>
                ))}
                {(section?.shots.filter((s) => !s.harvest) || []).map((s) => (
                  <span key={s.id} className="shot-chip dim">
                    <i>{catLabel(s.category)}</i>
                    {s.query}
                  </span>
                ))}
              </div>

              {shot && (
                <div className="shot-edit">
                  <input
                    value={shot.query}
                    onChange={(e) => section && editShot(section, shot, e.target.value)}
                    onBlur={saveShots}
                  />
                  <button className="ghost" onClick={() => scout(true)} disabled={!!activeJob}>
                    {activeJob?.kind === "scout" ? <LoaderCircle size={14} className="spin" /> : <ScanSearch size={14} />}
                    Scout shot
                  </button>
                  <button className="ghost" onClick={() => scout(false)} disabled={!!activeJob}>
                    Scout reel
                  </button>
                  <button className="ghost" onClick={() => shot && api.keepBest(detail.slug, shot.id, 3).then(setDetail)}>
                    <Sparkles size={14} /> Keep best 3
                  </button>
                </div>
              )}

              <div className="mosaic">
                {mosaic.map((row) => (
                  <article
                    key={row.uid}
                    className={`card${row.kept ? " kept" : ""}${row.pulled ? " pulled" : ""}`}
                    onClick={() => toggleKeep(row)}
                    onDoubleClick={() => setLightbox(row)}
                  >
                    {row.media_type === "videos" && (row.play_url || row.pulled) ? (
                      <video
                        muted
                        loop
                        playsInline
                        poster={previewFor(detail.slug, row)}
                        src={playFor(detail.slug, row)}
                        onMouseEnter={(e) => e.currentTarget.play().catch(() => undefined)}
                        onMouseLeave={(e) => {
                          e.currentTarget.pause();
                          e.currentTarget.currentTime = 0;
                        }}
                      />
                    ) : (
                      <img src={previewFor(detail.slug, row)} alt={row.query} />
                    )}
                    <footer>
                      <Star size={12} className={row.kept ? "star on" : "star"} />
                      <span>{row.provider}</span>
                      <b>{row.media_type === "videos" ? "VID" : "IMG"}</b>
                    </footer>
                  </article>
                ))}
                {!mosaic.length && (
                  <div className="mosaic-empty">Scout this shot to preview free stock before anything hits disk.</div>
                )}
              </div>

              <div className="bin">
                <div className="pane-head">Keep bin · {keepers.length}</div>
                <div className="bin-strip">
                  {keepers.map((row) => (
                    <button key={row.uid} className="bin-item" onClick={() => setLightbox(row)} title={row.query}>
                      <img src={previewFor(detail.slug, row)} alt="" />
                    </button>
                  ))}
                  {!keepers.length && <span className="muted">Star clips in the mosaic. Only keepers get pulled.</span>}
                </div>
              </div>
            </>
          )}
        </main>

        <aside className="inspector">
          {detail ? (
            <>
              <div className="pane-head">Reel</div>
              <h3>{detail.name}</h3>
              <p className="muted">
                {detail.summary.harvestable} harvestable · {detail.summary.scouted} scouted · {detail.summary.kept}{" "}
                kept · {detail.summary.pulled} on disk
              </p>
              <div className="actions wrap">
                <button className="pull" onClick={pull} disabled={!!activeJob || !keepers.length}>
                  <Clapperboard size={14} /> Pull keepers
                </button>
                <button className="ghost" onClick={() => api.open(detail.slug)}>
                  <FolderOpen size={14} /> Folder
                </button>
                <button className="ghost" onClick={copyCredits}>
                  <Copy size={14} /> Credits
                </button>
              </div>
              {activeJob && (
                <div className="progress-wrap">
                  <div className="progress-bar" style={{ width: `${Math.round(activeJob.progress * 100)}%` }} />
                </div>
              )}

              <div className="pane-head">Format</div>
              <div className="toggle-row">
                {ORIENT.map((o) => (
                  <button
                    key={o}
                    className={`tiny${detail.settings.orientation === o ? " on" : ""}`}
                    onClick={() => patchSettings({ orientation: o })}
                  >
                    {o}
                  </button>
                ))}
              </div>
              <label className="check">
                <input
                  type="checkbox"
                  checked={detail.settings.images}
                  onChange={(e) => patchSettings({ images: e.target.checked })}
                />
                Images
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={detail.settings.videos}
                  onChange={(e) => patchSettings({ videos: e.target.checked })}
                />
                Videos
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={detail.settings.expand_queries}
                  onChange={(e) => patchSettings({ expand_queries: e.target.checked })}
                />
                Expand documentary queries
              </label>
              <label className="field">
                Per provider
                <input
                  type="number"
                  min={2}
                  max={12}
                  value={detail.settings.per_provider}
                  onChange={(e) => patchSettings({ per_provider: Number(e.target.value) || 6 })}
                />
              </label>
              <label className="field">
                Min width
                <input
                  type="number"
                  min={0}
                  step={160}
                  value={detail.settings.min_width}
                  onChange={(e) => patchSettings({ min_width: Number(e.target.value) || 0 })}
                />
              </label>

              <div className="pane-head">Providers</div>
              <div className="provider-list">
                {PROVIDERS.map((p) => {
                  const meta = health?.providers.find((x) => x.name === p);
                  const on = detail.settings.providers.includes(p);
                  const ready = meta?.configured ?? true;
                  return (
                    <button
                      key={p}
                      className={`tiny${on ? " on" : ""}`}
                      disabled={!ready}
                      onClick={() => toggleProvider(p)}
                      title={ready ? p : "Needs API key"}
                    >
                      {p}
                    </button>
                  );
                })}
              </div>

              <div className="pane-head">Add shot</div>
              <div className="yt">
                <input
                  value={extraQuery}
                  onChange={(e) => setExtraQuery(e.target.value)}
                  placeholder="Extra search, this section"
                />
                <button
                  className="ghost wide"
                  disabled={!section || !extraQuery.trim()}
                  onClick={async () => {
                    if (!section) return;
                    const data = await api.addShot(detail.slug, { section_slug: section.slug, query: extraQuery });
                    setDetail(data);
                    setExtraQuery("");
                  }}
                >
                  <Plus size={14} /> Add to {section?.title || "section"}
                </button>
              </div>

              <div className="pane-head">Manual lists</div>
              <p className="tiny-label">AI to generate</p>
              <ul className="notes">
                {(detail.ai.length ? detail.ai : [{ section: "—", query: "None" }]).map((row, i) => (
                  <li key={i}>
                    {row.section}: {row.query}
                  </li>
                ))}
              </ul>
              <p className="tiny-label">On-screen text</p>
              <ul className="notes">
                {(detail.overlays.length ? detail.overlays : [{ section: "—", query: "None" }]).map((row, i) => (
                  <li key={i}>
                    {row.section}: {row.query}
                  </li>
                ))}
              </ul>

              <div className="pane-head">YouTube credits</div>
              <pre className="credits">{detail.credits}</pre>
            </>
          ) : (
            <>
              <div className="pane-head">Why this exists</div>
              <p className="muted">
                The original Clip Harvester parses an outline and downloads N results per query into folders. That
                fills disks with clips you will never cut.
              </p>
              <p className="muted">
                612 Harvest treats stock like a select bin: preview, keep, then pull. Zero-key providers run on a
                fresh Mac. Pexels / Unsplash keys are optional extras.
              </p>
            </>
          )}

          {keysOpen && (
            <div className="keys">
              <div className="pane-head">Optional API keys</div>
              <input type="password" placeholder="Pexels" value={pexels} onChange={(e) => setPexels(e.target.value)} />
              <input type="password" placeholder="Pixabay" value={pixabay} onChange={(e) => setPixabay(e.target.value)} />
              <input
                type="password"
                placeholder="Unsplash access key"
                value={unsplash}
                onChange={(e) => setUnsplash(e.target.value)}
              />
              <button
                className="ghost wide"
                onClick={async () => {
                  await api.saveKeys({ pexels, pixabay, unsplash });
                  setHealth(await api.health());
                  setStatus("Keys saved locally in config.json");
                  setPexels("");
                  setPixabay("");
                  setUnsplash("");
                }}
              >
                Save keys
              </button>
            </div>
          )}
        </aside>
      </div>

      <footer className="status">
        {activeJob ? (
          <span>
            {kindLabel(activeJob.kind)} {Math.round(activeJob.progress * 100)}% · {activeJob.step}
          </span>
        ) : (
          <span>{status}</span>
        )}
        <span className="grow" />
        <span>{jobs.filter((j) => j.status === "queued").length} queued</span>
      </footer>

      {lightbox && detail && (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          <div className="lightbox-card" onClick={(e) => e.stopPropagation()}>
            {lightbox.media_type === "videos" ? (
              <video controls autoPlay src={playFor(detail.slug, lightbox)} poster={previewFor(detail.slug, lightbox)} />
            ) : (
              <img
                src={
                  lightbox.pulled && lightbox.file_path
                    ? mediaUrl(detail.slug, lightbox.file_path)
                    : previewFor(detail.slug, lightbox)
                }
                alt={lightbox.query}
              />
            )}
            <div className="lightbox-meta">
              <strong>
                {lightbox.provider} · {lightbox.author || "unknown"}
              </strong>
              <span>{lightbox.license}</span>
              <span>
                {lightbox.width}×{lightbox.height}
              </span>
              <a href={lightbox.source_url} target="_blank" rel="noreferrer">
                Source
              </a>
              <button className={lightbox.kept ? "pull" : "ghost"} onClick={() => toggleKeep(lightbox)}>
                {lightbox.kept ? "Kept" : "Keep"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
