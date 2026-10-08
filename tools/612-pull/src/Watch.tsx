import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  FileUp,
  FolderOpen,
  LoaderCircle,
  Pause,
  Play,
  Save,
  Scissors,
} from "lucide-react";
import {
  api,
  fmtDur,
  fmtSize,
  fmtTimecode,
  mediaSrc,
  parseTimecode,
  shortPath,
  thumbSrc,
} from "./api";
import type { LibraryItem, MediaInfo } from "./types";

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

type SortKey = "date" | "name" | "size" | "duration";
type FilterKey = "all" | "watch" | "quicktime" | "video" | "audio";

export default function Watch({
  initialPath,
  onStatus,
}: {
  initialPath: string | null;
  onStatus: (msg: string) => void;
}) {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [path, setPath] = useState<string | null>(initialPath);
  const [info, setInfo] = useState<MediaInfo | null>(null);
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [markIn, setMarkIn] = useState<number | null>(null);
  const [markOut, setMarkOut] = useState<number | null>(null);
  const [inText, setInText] = useState("");
  const [outText, setOutText] = useState("");
  const [exporting, setExporting] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("date");
  const [filter, setFilter] = useState<FilterKey>("all");
  const videoRef = useRef<HTMLVideoElement>(null);
  const infoRef = useRef<MediaInfo | null>(null);
  const offsetRef = useRef(0);
  const nowRef = useRef(0);
  infoRef.current = info;
  offsetRef.current = offset;
  nowRef.current = now;

  const refresh = () => {
    api.library().then((r) => setItems(r.items)).catch(() => undefined);
  };

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (initialPath) setPath(initialPath);
  }, [initialPath]);

  useEffect(() => {
    if (!path) {
      setInfo(null);
      return;
    }
    setOffset(0);
    setNow(0);
    setMarkIn(null);
    setMarkOut(null);
    setInText("");
    setOutText("");
    setTranscript("");
    setPlaying(true);
    api
      .mediaProbe(path)
      .then(async (next) => {
        setInfo(next);
        onStatus(
          next.quicktime
            ? `${next.name} · QuickTime-safe ${next.label}`
            : `${next.name} · ${next.label} — playing via FFmpeg`,
        );
        if (next.transcript) {
          try {
            const body = await api.mediaText(next.transcript);
            setTranscript(body.text);
          } catch {
            setTranscript("");
          }
        }
      })
      .catch((err) => onStatus(err instanceof Error ? err.message : "Could not read file"));
  }, [path, onStatus]);

  const duration = info?.duration || 0;
  const sourceTime = () => {
    const video = videoRef.current;
    const base = infoRef.current?.direct ? 0 : offsetRef.current;
    return Math.min(duration || Infinity, base + (video?.currentTime || 0));
  };

  const seekTo = useCallback(
    (t: number) => {
      if (!info) return;
      const next = Math.max(0, Math.min(duration || t, t));
      setNow(next);
      nowRef.current = next;
      if (info.direct) {
        const video = videoRef.current;
        if (video) video.currentTime = next;
        return;
      }
      setOffset(next);
      offsetRef.current = next;
    },
    [duration, info],
  );

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play();
      setPlaying(true);
    } else {
      video.pause();
      setPlaying(false);
    }
  };

  const nudge = (delta: number) => seekTo(sourceTime() + delta);

  const setIn = (t = sourceTime()) => {
    setMarkIn(t);
    setInText(fmtTimecode(t));
    if (markOut != null && markOut <= t) {
      setMarkOut(null);
      setOutText("");
    }
  };

  const setOut = (t = sourceTime()) => {
    setMarkOut(t);
    setOutText(fmtTimecode(t));
  };

  const applyInText = () => {
    const parsed = parseTimecode(inText);
    if (parsed == null) return;
    setIn(parsed);
    seekTo(parsed);
  };

  const applyOutText = () => {
    const parsed = parseTimecode(outText);
    if (parsed == null) return;
    setOut(parsed);
  };

  const clipRange = (): { start: number; end: number } | null => {
    if (!info) return null;
    const start = markIn ?? 0;
    const end = markOut ?? duration;
    if (end <= start + 0.05) return null;
    return { start, end };
  };

  const saveClip = async (kind: "master" | "quicktime") => {
    if (!info) return;
    const range = clipRange();
    if (!range) {
      onStatus("Set an out point after the in point. Try 0 → 0:30, or I then O.");
      return;
    }
    setExporting(kind);
    onStatus(
      kind === "master"
        ? `Cutting ${fmtTimecode(range.start)}–${fmtTimecode(range.end)} as MKV…`
        : `Cutting ${fmtTimecode(range.start)}–${fmtTimecode(range.end)} as QuickTime MP4…`,
    );
    try {
      const result = await api.clip(info.path, range.start, range.end, kind);
      onStatus(
        `Saved ${shortPath(result.path)}${result.copied ? " (stream copy, no re-encode)" : ""}`,
      );
      refresh();
    } catch (err) {
      onStatus(err instanceof Error ? err.message : "Clip failed");
    } finally {
      setExporting(null);
    }
  };

  const grabFrame = async () => {
    if (!info) return;
    const t = sourceTime();
    setExporting("frame");
    onStatus(`Grabbing frame at ${fmtTimecode(t)}…`);
    try {
      const result = await api.frame(info.path, t, true);
      onStatus(
        result.opened
          ? `Frame saved and opened in 612 Edit`
          : `Frame saved ${shortPath(result.path)} — start 612 Edit (localhost:5174) to edit it`,
      );
    } catch (err) {
      onStatus(err instanceof Error ? err.message : "Frame grab failed");
    } finally {
      setExporting(null);
    }
  };

  const openFile = async () => {
    const { path: picked } = await api.browseMedia();
    if (picked) setPath(picked);
  };

  const saveQuicktime = async () => {
    if (!info) return;
    setExporting("qt");
    onStatus("Writing a QuickTime MP4 (H.264 + AAC)…");
    try {
      const result = await api.quicktime(info.path);
      onStatus(`Saved ${shortPath(result.path)}`);
      refresh();
    } catch (err) {
      onStatus(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(null);
    }
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = speed;
    if (playing) void video.play().catch(() => undefined);
  }, [offset, speed, playing, info?.path]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      if (!infoRef.current) return;
      const key = e.key.toLowerCase();
      if (key === " " || key === "k") {
        e.preventDefault();
        togglePlay();
      } else if (key === "j") {
        e.preventDefault();
        nudge(-10);
      } else if (key === "l") {
        e.preventDefault();
        nudge(10);
      } else if (key === "arrowleft") {
        e.preventDefault();
        nudge(e.shiftKey ? -1 : -5);
      } else if (key === "arrowright") {
        e.preventDefault();
        nudge(e.shiftKey ? 1 : 5);
      } else if (key === "[") {
        e.preventDefault();
        setSpeed((s) => SPEEDS[Math.max(0, SPEEDS.indexOf(s) - 1)] ?? 0.5);
      } else if (key === "]") {
        e.preventDefault();
        setSpeed((s) => SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(s) + 1)] ?? 2);
      } else if (key === "i") {
        e.preventDefault();
        setIn();
      } else if (key === "o") {
        e.preventDefault();
        setOut();
      } else if (key === "f") {
        e.preventDefault();
        void grabFrame();
      } else if (key === "home") {
        e.preventDefault();
        seekTo(0);
      } else if (key >= "0" && key <= "9" && duration) {
        e.preventDefault();
        seekTo((Number(key) / 10) * duration);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = items.slice();
    if (q) list = list.filter((item) => `${item.name} ${item.file} ${item.label || ""}`.toLowerCase().includes(q));
    if (filter === "watch") list = list.filter((item) => item.quicktime === false);
    if (filter === "quicktime") list = list.filter((item) => item.quicktime);
    if (filter === "video") list = list.filter((item) => item.kind !== "audio");
    if (filter === "audio") list = list.filter((item) => item.kind === "audio");
    list.sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "size") return (b.size || 0) - (a.size || 0);
      if (sort === "duration") return (b.duration || 0) - (a.duration || 0);
      return (b.mtime || 0) - (a.mtime || 0);
    });
    return list;
  }, [filter, items, query, sort]);

  const range = clipRange();
  const pct = duration ? Math.min(100, (now / duration) * 100) : 0;
  const inPct = duration && markIn != null ? (markIn / duration) * 100 : 0;
  const outPct = duration && markOut != null ? (markOut / duration) * 100 : 100;

  return (
    <div className="watch">
      <aside className="composer">
        <div className="block-label flush">Library</div>
        <button className="ghost" onClick={openFile}>
          <FileUp size={14} /> Open any file
        </button>
        <input
          className="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search title, codec…"
        />
        <div className="row wrap">
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="date">Newest</option>
            <option value="name">Name</option>
            <option value="size">Size</option>
            <option value="duration">Duration</option>
          </select>
          <select value={filter} onChange={(e) => setFilter(e.target.value as FilterKey)}>
            <option value="all">All</option>
            <option value="watch">Needs Watch</option>
            <option value="quicktime">QuickTime-safe</option>
            <option value="video">Video</option>
            <option value="audio">Audio</option>
          </select>
        </div>
        <ul className="lib">
          {visible.map((item) => (
            <li key={item.path}>
              <button className={path === item.path ? "on" : ""} onClick={() => setPath(item.path)}>
                {item.kind === "audio" ? (
                  <div className="lib-ph" />
                ) : (
                  <img className="lib-thumb" src={thumbSrc(item.path)} alt="" />
                )}
                <span className="grow">
                  <strong>{item.name}</strong>
                  <em>
                    {item.quicktime === false ? "Watch · " : item.quicktime ? "QT · " : ""}
                    {(item.ext || "").toUpperCase()}
                    {item.duration ? ` · ${fmtDur(item.duration)}` : ""}
                    {item.label ? ` · ${item.label}` : ""}
                  </em>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {visible.length === 0 && <div className="muted tiny">Nothing matches.</div>}
      </aside>

      <section className="stage">
        {info ? (
          <>
            <div className="player-wrap">
              <video
                key={`${info.path}:${info.direct ? "d" : offset.toFixed(3)}`}
                ref={videoRef}
                className="player"
                autoPlay={playing}
                src={mediaSrc(info.path, info.direct, info.direct ? 0 : offset)}
                onClick={togglePlay}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onTimeUpdate={() => {
                  const t = sourceTime();
                  setNow(t);
                  nowRef.current = t;
                }}
              />
              {!playing && (
                <button className="play-overlay" onClick={togglePlay}>
                  <Play size={28} />
                </button>
              )}
            </div>
            <div className="transport">
              <button className="ghost" onClick={togglePlay}>
                {playing ? <Pause size={14} /> : <Play size={14} />}
              </button>
              <span className="time-read">
                {fmtTimecode(now)} / {fmtDur(duration)}
              </span>
              <div
                className="scrub"
                onPointerDown={(e) => {
                  const bar = e.currentTarget;
                  const pick = (ev: { clientX: number }) => {
                    const rect = bar.getBoundingClientRect();
                    const x = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
                    seekTo(x * duration);
                  };
                  pick(e);
                  const move = (ev: PointerEvent) => pick(ev);
                  const up = () => {
                    window.removeEventListener("pointermove", move);
                    window.removeEventListener("pointerup", up);
                  };
                  window.addEventListener("pointermove", move);
                  window.addEventListener("pointerup", up);
                }}
              >
                <i className="scrub-range" style={{ left: `${inPct}%`, width: `${Math.max(0, outPct - inPct)}%` }} />
                {markIn != null && <b className="mark in" style={{ left: `${inPct}%` }} />}
                {markOut != null && <b className="mark out" style={{ left: `${outPct}%` }} />}
                <em className="playhead" style={{ left: `${pct}%` }} />
              </div>
              <div className="speeds">
                {SPEEDS.map((s) => (
                  <button key={s} className={`chip ${speed === s ? "on" : ""}`} onClick={() => setSpeed(s)}>
                    {s}x
                  </button>
                ))}
              </div>
            </div>
            <div className="player-meta">
              <h2>{info.name}</h2>
              <span>
                {info.width && info.height ? `${info.width}×${info.height} · ` : ""}
                {info.label}
                {info.duration ? ` · ${fmtDur(info.duration)}` : ""}
              </span>
            </div>
            <p className="muted tiny">
              J / K / L · space · [ ] speed · I in · O out · F frame · 0–9 jump · click the bar to seek
            </p>
          </>
        ) : (
          <div className="empty">
            <Play size={28} />
            <h2>Watch anything QuickTime refuses</h2>
            <p>
              Mark in/out (I / O) and save a slice — first 30 seconds, or 1:11 to 3:50. Pause and F to grab a PNG into
              612 Edit.
            </p>
            <button className="ghost" onClick={openFile}>
              <FileUp size={14} /> Open a file
            </button>
          </div>
        )}
      </section>

      <aside className="inspector">
        {info ? (
          <div className="inspect-body">
            <div className="block-label flush">Clip</div>
            <p className="muted tiny">I / O at the playhead, or type 1:11 and 3:50.</p>
            <div className="row wrap">
              <button className="ghost" onClick={() => setIn()}>
                I in
              </button>
              <button className="ghost" onClick={() => setOut()}>
                O out
              </button>
              <button
                className="ghost"
                onClick={() => {
                  setIn(0);
                  setOut(Math.min(30, duration || 30));
                }}
              >
                First 30s
              </button>
              <button
                className="ghost"
                onClick={() => {
                  setIn(0);
                  setOut(Math.min(15, duration || 15));
                }}
              >
                First 15s
              </button>
            </div>
            <div className="row wrap">
              <label className="tc">
                In
                <input
                  value={inText}
                  onChange={(e) => setInText(e.target.value)}
                  onBlur={applyInText}
                  onKeyDown={(e) => e.key === "Enter" && applyInText()}
                  placeholder="0:00"
                />
              </label>
              <label className="tc">
                Out
                <input
                  value={outText}
                  onChange={(e) => setOutText(e.target.value)}
                  onBlur={applyOutText}
                  onKeyDown={(e) => e.key === "Enter" && applyOutText()}
                  placeholder={fmtDur(duration)}
                />
              </label>
            </div>
            <div className="muted tiny">
              {range
                ? `${fmtTimecode(range.start)} → ${fmtTimecode(range.end)} · ${fmtDur(range.end - range.start)}`
                : "No range yet"}
            </div>
            <div className="row wrap">
              <button className="ghost" onClick={() => void saveClip("master")} disabled={!!exporting}>
                {exporting === "master" ? <LoaderCircle size={14} className="spin" /> : <Scissors size={14} />}
                Save MKV
              </button>
              <button className="ghost" onClick={() => void saveClip("quicktime")} disabled={!!exporting}>
                {exporting === "quicktime" ? <LoaderCircle size={14} className="spin" /> : <Save size={14} />}
                Save QuickTime MP4
              </button>
            </div>
            <button className="ghost" onClick={() => void grabFrame()} disabled={!!exporting}>
              {exporting === "frame" ? <LoaderCircle size={14} className="spin" /> : <Camera size={14} />}
              Frame → 612 Edit
            </button>

            <div className="block-label">Codecs</div>
            <div className={`qt-badge ${info.quicktime ? "ok" : "no"}`}>
              {info.quicktime ? "QuickTime can open this" : "QuickTime cannot open this"}
            </div>
            <p className="desc">{info.why || "H.264/HEVC + AAC in MP4 — Apple’s happy path."}</p>
            <table>
              <tbody>
                <tr>
                  <td>Container</td>
                  <td>{info.container.toUpperCase()}</td>
                </tr>
                <tr>
                  <td>Video</td>
                  <td>{info.vcodec || "—"}</td>
                </tr>
                <tr>
                  <td>Audio</td>
                  <td>{info.acodec || "—"}</td>
                </tr>
                <tr>
                  <td>Size</td>
                  <td>{fmtSize(info.size)}</td>
                </tr>
              </tbody>
            </table>
            <div className="row wrap">
              <button className="ghost" onClick={() => api.open(info.folder)}>
                <FolderOpen size={14} /> Folder
              </button>
              {!info.quicktime && (
                <button className="ghost" onClick={saveQuicktime} disabled={!!exporting}>
                  {exporting === "qt" ? <LoaderCircle size={14} className="spin" /> : <Save size={14} />}
                  Whole file → MP4
                </button>
              )}
            </div>
            {transcript ? (
              <>
                <div className="block-label">Transcript</div>
                <pre className="transcript">{transcript}</pre>
              </>
            ) : null}
          </div>
        ) : (
          <div className="empty inspect">
            <h2>Clip, grab, edit</h2>
            <p>
              Best-quality YouTube stays VP9/AV1 in MKV. Cut a range without re-downloading. Pause on a face and send
              the still to 612 Edit for the thumbnail.
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}
