import { useEffect, useMemo, useRef, useState } from "react";
import { FolderPlus, Heart, Play } from "lucide-react";
import { Cover } from "./Cover";
import { engine } from "../lib/audioEngine";
import { drawVis } from "../lib/visualizer";
import { getOne } from "../lib/db";
import { activeLineIndex } from "../lib/lrc";
import { displayTitle } from "../lib/format";
import { useLibrary } from "../state/library";
import { usePlayer } from "../state/player";
import { buildMixes } from "../lib/mixes";
import type { Lyrics } from "../lib/types";

export function Stage() {
  const tracks = useLibrary((s) => s.tracks);
  const addFolder = useLibrary((s) => s.addFolder);
  const toggleLike = useLibrary((s) => s.toggleLike);
  const { currentId, isPlaying, vis, lyricsOpen, currentTime, playIds } = usePlayer();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const track = tracks.find((t) => t.id === currentId);
  const mixes = useMemo(() => buildMixes(tracks).slice(0, 4), [tracks]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let raf = 0;
    const tick = () => {
      const analyser = engine.analyser;
      const ctx = canvas.getContext("2d");
      if (ctx && analyser) {
        const dpr = devicePixelRatio || 1;
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
          canvas.width = w * dpr;
          canvas.height = h * dpr;
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
        drawVis(ctx, analyser, vis, w, h, isPlaying);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [vis, isPlaying, currentId]);

  if (!track) {
    return (
      <section className="stage empty">
        <div className="welcome">
          <div className="eyebrow">Local library · nothing leaves this machine</div>
          <h1>Drop a music folder.</h1>
          <p>
            612 Play reads tags, art, and <code>.lrc</code> lyrics in the browser. Chrome, Edge, or Arc can remember the
            folder after refresh.
          </p>
          <div className="row-gap">
            <button className="btn primary" onClick={() => void addFolder()}>
              <FolderPlus size={16} /> Open music folder
            </button>
          </div>
          {mixes.length > 0 && (
            <div className="mix-row">
              {mixes.map((m) => (
                <button key={m.id} className="mix-card" onClick={() => void playIds(m.tracks.map((t) => t.id), 0)}>
                  <Play size={14} fill="currentColor" />
                  <div>
                    <b>{m.name}</b>
                    <span>{m.hint}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="stage">
      <canvas ref={canvasRef} className="vis" />
      <div className="stage-center">
        <Cover
          id={track.hasArt ? track.id : undefined}
          className="stage-art"
          onGlow={(c) => document.documentElement.style.setProperty("--glow", c)}
        />
        <div className="stage-copy">
          <h1>{displayTitle(track)}</h1>
          <p>
            {track.artist}
            {track.album ? ` — ${track.album}` : ""}
            {track.year ? ` · ${track.year}` : ""}
          </p>
          <div className="row-gap">
            <button className={`chip ${track.liked ? "on" : ""}`} onClick={() => toggleLike(track.id)}>
              <Heart size={14} fill={track.liked ? "currentColor" : "none"} />
              {track.liked ? "Liked" : "Like"}
            </button>
            {track.genre && <span className="chip ghost">{track.genre}</span>}
          </div>
        </div>
      </div>
      {lyricsOpen && <LyricsPane trackId={track.id} time={currentTime} />}
    </section>
  );
}

function LyricsPane({ trackId, time }: { trackId: string; time: number }) {
  const [lyrics, setLyrics] = useState<Lyrics | undefined>();
  useEffect(() => {
    let live = true;
    getOne("lyrics", trackId).then((row) => {
      if (live) setLyrics(row);
    });
    return () => {
      live = false;
    };
  }, [trackId]);
  const idx = lyrics?.lines.length ? activeLineIndex(lyrics.lines, time) : -1;

  if (!lyrics) {
    return (
      <aside className="lyrics">
        <div className="muted">No synced lyrics. Drop a matching .lrc next to the file and rescan.</div>
      </aside>
    );
  }

  if (lyrics.lines.length === 0) {
    return (
      <aside className="lyrics">
        <pre>{lyrics.text}</pre>
      </aside>
    );
  }

  return (
    <aside className="lyrics">
      {lyrics.lines.map((line, i) => (
        <div key={`${line.t}-${i}`} className={`lyric-line ${i === idx ? "now" : ""}`}>
          {line.text}
        </div>
      ))}
    </aside>
  );
}
