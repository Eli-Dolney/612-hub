import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  AudioLines,
  Check,
  Clapperboard,
  CloudOff,
  Cpu,
  Download,
  FolderOpen,
  Home,
  Image,
  Layers3,
  ListVideo,
  LoaderCircle,
  Mic2,
  Play,
  Scissors,
  Settings,
  Sparkles,
  Square,
  SquarePlay,
  Trash2,
  WandSparkles,
} from "lucide-react";
import { ago, api, fmtIdle, fmtSize, jobOpenPath } from "./api";
import type { AppCard, Job, Load, MediaItem, Status } from "./types";

type Page = "home" | "studio" | "queue" | "media" | "settings";

const ICONS: Record<string, typeof Home> = {
  pull: Download,
  harvest: Layers3,
  voice: Mic2,
  mix: AudioLines,
  clip: Scissors,
  edit: Image,
  play: SquarePlay,
};

export default function App() {
  const [page, setPage] = useState<Page>("home");
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState("");

  const refresh = () => api.status().then(setStatus).catch((err) => setToast(String(err)));

  useEffect(() => {
    refresh();
    const tick = window.setInterval(refresh, 3000);
    return () => window.clearInterval(tick);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(t);
  }, [toast]);

  const act = async (id: string, fn: (id: string) => Promise<{ message?: string; url?: string }>) => {
    setBusy(id);
    try {
      const result = await fn(id);
      if (result.message) setToast(result.message);
      await refresh();
    } catch (err) {
      setToast(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const apps = status?.apps || [];
  const byId = useMemo(() => Object.fromEntries(apps.map((a) => [a.id, a])), [apps]);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="mark" />
          <div>
            <b>Grok</b>
            <em>HUB</em>
          </div>
        </div>
        <nav>
          {(
            [
              ["home", "Home", Home],
              ["studio", "Studio", WandSparkles],
              ["queue", "Jobs", ListVideo],
              ["media", "Media", FolderOpen],
              ["settings", "Settings", Settings],
            ] as const
          ).map(([id, label, Icon]) => (
            <button key={id} className={page === id ? "nav on" : "nav"} onClick={() => setPage(id)}>
              <Icon size={17} />
              {label}
              {id === "queue" && status?.jobs.length ? <em>{status.jobs.length}</em> : null}
            </button>
          ))}
        </nav>
        <div className="grow" />
        <div className="local">
          <CloudOff size={16} />
          <div>
            <strong>100% local</strong>
            <span>Nothing leaves this Mac.</span>
          </div>
        </div>
        <div className="foot">
          {status?.load
            ? `${status.load.live} live · ${status.load.cpu}% CPU · ${status.load.rss_mb} MB`
            : status
              ? `${status.running}/${status.installed} live`
              : "…"}
        </div>
      </aside>

      <main className="main">
        <header className="top">
          <div>
            <span className="eye">Grok studio</span>
            <h1>
              {page === "home" && "Command center"}
              {page === "studio" && "Apps"}
              {page === "queue" && "Jobs"}
              {page === "media" && "Library"}
              {page === "settings" && "This computer"}
            </h1>
          </div>
          <button className="ghost" onClick={() => refresh()}>
            Refresh
          </button>
        </header>

        {page === "home" && (
          <HomePage
            status={status}
            byId={byId}
            busy={busy}
            onLaunch={(id) => act(id, api.launch)}
            onOpen={(id) => act(id, api.open)}
            onStop={(id) => act(id, api.stop)}
            onStopOthers={() => act("all", () => api.stopOthers())}
            onStudio={() => setPage("studio")}
            onToast={setToast}
          />
        )}
        {page === "studio" && (
          <StudioPage
            apps={apps}
            load={status?.load}
            busy={busy}
            onLaunch={(id) => act(id, api.launch)}
            onStop={(id) => act(id, api.stop)}
            onOpen={(id) => act(id, api.open)}
            onStopOthers={() => act("all", () => api.stopOthers())}
          />
        )}
        {page === "queue" && <QueuePage status={status} onToast={setToast} />}
        {page === "media" && <MediaPage onToast={setToast} />}
        {page === "settings" && <SettingsPage status={status} onToast={setToast} onRefresh={refresh} />}
      </main>

      {toast && (
        <div className="toast">
          <Check size={14} />
          {toast}
        </div>
      )}
    </div>
  );
}

function LoadBar({
  load,
  apps,
  busy,
  onStop,
  onStopOthers,
}: {
  load?: Load | null;
  apps: AppCard[];
  busy: string | null;
  onStop: (id: string) => void;
  onStopOthers?: () => void;
}) {
  if (!load) return null;
  if (load.live === 0 && load.level === "ok") return null;
  const live = apps.filter((a) => a.running);
  return (
    <section className={`load ${load.level}`}>
      <div className="load-copy">
        {load.level === "full" ? <AlertTriangle size={16} /> : <Cpu size={16} />}
        <div>
          <strong>
            {load.live} live · {load.cpu}% CPU · {load.rss_mb} MB
          </strong>
          <p>{load.hint}</p>
        </div>
      </div>
      {live.length > 0 && (
        <div className="load-apps">
          {live.map((app) => (
            <button
              key={app.id}
              className="ghost tiny"
              onClick={() => onStop(app.id)}
              disabled={busy === app.id}
              title="Close this app and free CPU"
            >
              <Square size={11} />
              {app.name}
              {app.cpu ? ` ${app.cpu}%` : ""}
            </button>
          ))}
          {live.length > 1 && onStopOthers && (
            <button className="ghost tiny danger" onClick={onStopOthers} disabled={Boolean(busy)}>
              Close all
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function JobActions({ job, onToast }: { job: Job; onToast: (msg: string) => void }) {
  const path = jobOpenPath(job);
  if (!path || job.status !== "done") return null;
  return (
    <span className="job-act">
      <button
        className="ghost tiny"
        title="Open"
        onClick={() =>
          api
            .openPath(path)
            .then(() => onToast("Opened"))
            .catch((e) => onToast(String(e)))
        }
      >
        <Play size={12} /> Open
      </button>
      <button
        className="ghost tiny"
        title="Reveal in Finder"
        onClick={() =>
          api
            .reveal(path, true)
            .then(() => onToast("Revealed"))
            .catch((e) => onToast(String(e)))
        }
      >
        <FolderOpen size={12} />
      </button>
    </span>
  );
}

function HomePage({
  status,
  byId,
  busy,
  onLaunch,
  onOpen,
  onStop,
  onStopOthers,
  onStudio,
  onToast,
}: {
  status: Status | null;
  byId: Record<string, AppCard>;
  busy: string | null;
  onLaunch: (id: string) => void;
  onOpen: (id: string) => void;
  onStop: (id: string) => void;
  onStopOthers: () => void;
  onStudio: () => void;
  onToast: (msg: string) => void;
}) {
  const pipeline = status?.pipeline || [];
  const blocked = Boolean(status?.load?.block_launch);
  return (
    <div className="page">
      <LoadBar
        load={status?.load}
        apps={status?.apps || []}
        busy={busy}
        onStop={onStop}
        onStopOthers={onStopOthers}
      />
      <section className="hero">
        <div>
          <span className="pill">
            <Sparkles size={13} /> Creator command center
          </span>
          <h2>
            One desk.
            <br />
            Every Grok app.
          </h2>
          <p>
            Pull footage, scout B-roll, clone a voice, split stems, cut the lines, make the thumb. Same machine. No
            accounts.
          </p>
          <div className="row">
            <button className="pull" onClick={onStudio}>
              Open studio <ArrowRight size={16} />
            </button>
          </div>
        </div>
        <div className="hero-stat">
          <strong>{status?.running ?? 0}</strong>
          <span>apps live</span>
          <strong>{status?.load ? `${status.load.cpu}%` : "—"}</strong>
          <span>Grok CPU</span>
        </div>
      </section>

      <section className="card">
        <div className="head">
          <div>
            <span className="eye">Pipeline</span>
            <h3>Release path</h3>
          </div>
        </div>
        <div className="pipe">
          {pipeline.map((id, i) => {
            const app = byId[id];
            if (!app) return null;
            const Icon = ICONS[id] || WandSparkles;
            return (
              <div className="pipe-g" key={id}>
                <button
                  className={`pipe-step ${app.running ? "live" : ""}`}
                  onClick={() => (app.running ? onOpen(app.id) : onLaunch(app.id))}
                  disabled={busy === app.id || !app.installed || (blocked && !app.running)}
                >
                  {busy === app.id ? <LoaderCircle size={18} className="spin" /> : <Icon size={18} />}
                  <strong>{app.step}</strong>
                  <small>
                    {app.running
                      ? "Live"
                      : blocked
                        ? "Stop one first"
                        : app.installed
                          ? "Launch"
                          : "Missing"}
                  </small>
                </button>
                {i < pipeline.length - 1 && <ArrowRight size={14} className="arrow" />}
              </div>
            );
          })}
        </div>
      </section>

      <div className="split">
        <section className="card">
          <div className="head">
            <div>
              <span className="eye">Recent</span>
              <h3>On disk</h3>
            </div>
          </div>
          <ul className="recent">
            {(status?.recent || []).slice(0, 8).map((row) => (
              <li key={row.path}>
                <button onClick={() => api.reveal(row.path).catch(() => undefined)}>
                  <strong>{row.name}</strong>
                  <small>
                    {row.app} · {ago(row.mtime)}
                  </small>
                </button>
              </li>
            ))}
            {!status?.recent.length && <li className="muted">No project folders yet.</li>}
          </ul>
        </section>
        <section className="card">
          <div className="head">
            <div>
              <span className="eye">Now</span>
              <h3>Jobs</h3>
            </div>
          </div>
          <ul className="jobs">
            {(status?.jobs || []).slice(0, 6).map((job, i) => (
              <li key={job.id || i}>
                <span className={`st ${(job.status || "").toLowerCase()}`}>{job.status || "job"}</span>
                <span>
                  <strong>
                    {job.kind} · {job.step || job.project}
                  </strong>
                  <small>{job.app_name}</small>
                </span>
                <JobActions job={job} onToast={onToast} />
              </li>
            ))}
            {!status?.jobs.length && <li className="muted">Idle. Launch an app to see its queue here.</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}

function StudioPage({
  apps,
  load,
  busy,
  onLaunch,
  onStop,
  onOpen,
  onStopOthers,
}: {
  apps: AppCard[];
  load?: Load;
  busy: string | null;
  onLaunch: (id: string) => void;
  onStop: (id: string) => void;
  onOpen: (id: string) => void;
  onStopOthers: () => void;
}) {
  const blocked = Boolean(load?.block_launch);
  return (
    <div className="page">
      <LoadBar load={load} apps={apps} busy={busy} onStop={onStop} onStopOthers={onStopOthers} />
      <div className="grid">
        {apps.map((app) => {
          const Icon = ICONS[app.id] || Clapperboard;
          return (
            <article className="tool" key={app.id}>
              <div className="tool-top">
                <span className="mono" style={{ color: app.color, background: `${app.color}22` }}>
                  {app.short}
                </span>
                <span className={app.running ? "dot on" : app.installed ? "dot" : "dot miss"}>
                  {app.running ? "Live" : app.installed ? "Ready" : "Not found"}
                </span>
              </div>
              <span className="eye">{app.category}</span>
              <h3>{app.name}</h3>
              <p>{app.blurb}</p>
              <small className="vs">
                vs {app.vs} · :{app.ui_port}
                {app.running
                  ? ` · ${app.cpu || 0}% CPU · ${app.rss_mb || 0} MB${fmtIdle(app.idle_s) ? ` · ${fmtIdle(app.idle_s)}` : ""}`
                  : ""}
              </small>
              <div className="tool-act">
                {app.running ? (
                  <>
                    <button className="pull" onClick={() => onOpen(app.id)}>
                      <Play size={14} fill="currentColor" /> Open
                    </button>
                    <button className="ghost" onClick={() => onStop(app.id)} disabled={busy === app.id}>
                      <Square size={12} />
                      Close
                    </button>
                  </>
                ) : (
                  <button
                    className="pull"
                    disabled={!app.installed || busy === app.id || blocked}
                    title={blocked ? load?.hint : undefined}
                    onClick={() => onLaunch(app.id)}
                  >
                    {busy === app.id ? <LoaderCircle size={14} className="spin" /> : <Play size={14} fill="currentColor" />}
                    {blocked ? "Stop one first" : "Launch"}
                  </button>
                )}
                {app.installed && (
                  <button className="ghost" onClick={() => api.reveal(app.path)}>
                    <FolderOpen size={14} />
                  </button>
                )}
                <Icon size={16} className="ghost-icon" />
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function QueuePage({ status, onToast }: { status: Status | null; onToast: (msg: string) => void }) {
  const jobs = status?.jobs || [];
  const running = jobs.filter((j) => j.status === "running" || j.status === "queued").length;
  return (
    <div className="page">
      <div className="stats">
        <div>
          <strong>{running}</strong>
          <span>Active</span>
        </div>
        <div>
          <strong>{status?.running ?? 0}</strong>
          <span>Apps live</span>
        </div>
        <div>
          <strong>{jobs.length}</strong>
          <span>In queues</span>
        </div>
      </div>
      <section className="card">
        <ul className="jobs big">
          {jobs.map((job, i) => (
            <li key={job.id || i}>
              <span className={`st ${(job.status || "").toLowerCase()}`}>{job.status}</span>
              <span>
                <strong>
                  {job.app_name} · {job.kind}
                </strong>
                <small>
                  {job.step} {job.project ? `· ${job.project}` : ""}
                </small>
              </span>
              <em>{Math.round((job.progress || 0) * 100)}%</em>
              <JobActions job={job} onToast={onToast} />
            </li>
          ))}
          {!jobs.length && <li className="muted">No jobs. Queues appear when a Grok app with an API is running.</li>}
        </ul>
      </section>
    </div>
  );
}

function MediaPage({ onToast }: { onToast: (msg: string) => void }) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [filter, setFilter] = useState<"all" | "clip" | "pull">("all");
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api
      .media()
      .then((r) => setItems(r.items))
      .catch((e) => onToast(String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    const tick = window.setInterval(load, 8000);
    return () => window.clearInterval(tick);
  }, []);

  const shown = items.filter((item) => filter === "all" || item.app === filter);

  return (
    <div className="page">
      <div className="media-bar">
        <div className="row">
          {(
            [
              ["all", "All"],
              ["clip", "GrokClip"],
              ["pull", "GrokPull"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} className={filter === id ? "ghost on" : "ghost"} onClick={() => setFilter(id)}>
              {label}
            </button>
          ))}
        </div>
        <button className="ghost" onClick={load}>
          Refresh
        </button>
      </div>
      <section className="card">
        <ul className="media-list">
          {shown.map((item) => (
            <li key={item.id}>
              <span className={`st ${item.kind}`}>{item.kind}</span>
              <span>
                <strong>{item.title}</strong>
                <small>
                  {item.app_name} · {ago(item.mtime)}
                  {fmtSize(item.size) ? ` · ${fmtSize(item.size)}` : ""}
                </small>
              </span>
              <span className="job-act">
                <button
                  className="ghost tiny"
                  onClick={() =>
                    api
                      .openPath(item.path)
                      .then(() => onToast("Opened"))
                      .catch((e) => onToast(String(e)))
                  }
                >
                  <Play size={12} /> Open
                </button>
                <button
                  className="ghost tiny"
                  onClick={() =>
                    api
                      .reveal(item.path, true)
                      .then(() => onToast("Revealed"))
                      .catch((e) => onToast(String(e)))
                  }
                >
                  <FolderOpen size={12} />
                </button>
                <button
                  className="ghost tiny danger"
                  onClick={() => {
                    if (!window.confirm(`Delete ${item.title}?`)) return;
                    api
                      .deleteMedia(item.path)
                      .then(() => {
                        onToast("Deleted");
                        load();
                      })
                      .catch((e) => onToast(String(e)));
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </span>
            </li>
          ))}
          {!loading && !shown.length && (
            <li className="muted">No clips or downloads yet. Save from GrokClip or finish a Pull.</li>
          )}
          {loading && !shown.length && <li className="muted">Scanning…</li>}
        </ul>
      </section>
    </div>
  );
}

function SettingsPage({
  status,
  onToast,
  onRefresh,
}: {
  status: Status | null;
  onToast: (msg: string) => void;
  onRefresh: () => void;
}) {
  const autoOpen = Boolean(status?.prefs?.auto_open);
  return (
    <div className="page">
      <section className="card settings-row">
        <Play size={18} />
        <div className="settings-grow">
          <h3>Auto-open finished jobs</h3>
          <p>
            When a Clip export/clip or Pull download finishes, open the file or folder like the downloader’s Watch
            reveal.
          </p>
          <label className="toggle">
            <input
              type="checkbox"
              checked={autoOpen}
              onChange={(e) => {
                api
                  .setPrefs({ auto_open: e.target.checked })
                  .then(() => {
                    onToast(e.target.checked ? "Auto-open on" : "Auto-open off");
                    onRefresh();
                  })
                  .catch((err) => onToast(String(err)));
              }}
            />
            Open finished media automatically
          </label>
        </div>
      </section>
      <section className="card settings-row">
        <Cpu size={18} />
        <div>
          <h3>Keep 1–2 apps live</h3>
          <p>
            Each Grok UI is a Vite server. Two at once is comfortable. Three or high CPU blocks a new Launch until you
            Close one. Use Close on a card, or Close all on the load bar.
          </p>
        </div>
      </section>
      <section className="card settings-row">
        <FolderOpen size={18} />
        <div>
          <h3>Desktop root</h3>
          <p>Hub looks next to itself for grok, grok-pull, grok-clip, …</p>
          <code>{status?.desktop}</code>
        </div>
      </section>
      {(status?.requirements || []).map((req) => (
        <section className="card settings-row" key={req.id}>
          <span className={req.available ? "dot on" : "dot miss"}>{req.available ? "OK" : "No"}</span>
          <div>
            <h3>{req.name}</h3>
            <p>{req.available ? req.version : `Needed for ${req.need}`}</p>
          </div>
        </section>
      ))}
    </div>
  );
}
