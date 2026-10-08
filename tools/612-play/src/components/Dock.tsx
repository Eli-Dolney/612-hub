import { useMemo, useRef } from "react";
import {
  Heart,
  ListMusic,
  Mic2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Cover } from "./Cover";
import { displayTitle, formatTime } from "../lib/format";
import { useLibrary } from "../state/library";
import { usePlayer } from "../state/player";
import { useUi } from "../state/ui";

export function Dock() {
  const tracks = useLibrary((s) => s.tracks);
  const toggleLike = useLibrary((s) => s.toggleLike);
  const {
    currentId,
    isPlaying,
    currentTime,
    duration,
    volume,
    muted,
    shuffled,
    repeat,
    peaks,
    queueOpen,
    lyricsOpen,
    toggle,
    prev,
    next,
    seek,
    setVolume,
    toggleMute,
    toggleShuffle,
    cycleRepeat,
    setQueueOpen,
    setLyricsOpen,
  } = usePlayer();
  const setView = useUi((s) => s.setView);
  const track = tracks.find((t) => t.id === currentId);
  const waveRef = useRef<HTMLDivElement>(null);

  const progress = duration > 0 ? currentTime / duration : 0;

  function onWave(e: React.MouseEvent<HTMLDivElement>) {
    if (!duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    seek(((e.clientX - rect.left) / rect.width) * duration);
  }

  const RepeatIcon = repeat === "one" ? Repeat1 : Repeat;

  const bars = useMemo(() => peaks, [peaks]);

  return (
    <footer className="dock">
      <div className="dock-now" onClick={() => setView({ kind: "listen" })}>
        <Cover id={track?.hasArt ? track.id : undefined} className="dock-art" />
        <div className="min-w-0">
          <div className="dock-title">{track ? displayTitle(track) : "Nothing playing"}</div>
          <div className="dock-sub">{track?.artist ?? "Open a folder to start"}</div>
        </div>
        {track && (
          <button className={`icon-btn like ${track.liked ? "on" : ""}`} onClick={() => toggleLike(track.id)}>
            <Heart size={16} fill={track.liked ? "currentColor" : "none"} />
          </button>
        )}
      </div>

      <div className="dock-transport">
        <div className="transport">
          <button className={`icon-btn ${shuffled ? "on" : ""}`} onClick={toggleShuffle} title="Shuffle">
            <Shuffle size={16} />
          </button>
          <button className="icon-btn" onClick={() => void prev()} title="Previous">
            <SkipBack size={18} fill="currentColor" />
          </button>
          <button className="play-btn" onClick={toggle} title={isPlaying ? "Pause" : "Play"}>
            {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
          </button>
          <button className="icon-btn" onClick={() => void next()} title="Next">
            <SkipForward size={18} fill="currentColor" />
          </button>
          <button className={`icon-btn ${repeat !== "off" ? "on" : ""}`} onClick={cycleRepeat} title="Repeat">
            <RepeatIcon size={16} />
          </button>
        </div>
        <div className="wave-row">
          <span className="time">{formatTime(currentTime)}</span>
          <div ref={waveRef} className="wave" onClick={onWave}>
            {bars.length > 0 ? (
              <svg viewBox={`0 0 ${bars.length} 32`} preserveAspectRatio="none" className="wave-svg">
                {bars.map((p, i) => {
                  const h = Math.max(1.2, p * 28);
                  const on = i / bars.length <= progress;
                  return (
                    <rect
                      key={i}
                      x={i}
                      y={(32 - h) / 2}
                      width="1"
                      height={h}
                      fill={on ? "var(--accent)" : "var(--faint)"}
                    />
                  );
                })}
              </svg>
            ) : (
              <div className="wave-fallback">
                <b style={{ width: `${progress * 100}%` }} />
              </div>
            )}
          </div>
          <span className="time">{formatTime(duration)}</span>
        </div>
      </div>

      <div className="dock-right">
        <button className={`icon-btn ${lyricsOpen ? "on" : ""}`} onClick={() => setLyricsOpen(!lyricsOpen)} title="Lyrics">
          <Mic2 size={16} />
        </button>
        <button className={`icon-btn ${queueOpen ? "on" : ""}`} onClick={() => setQueueOpen(!queueOpen)} title="Queue">
          <ListMusic size={16} />
        </button>
        <button className="icon-btn" onClick={toggleMute} title="Mute">
          {muted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
        <input
          className="vol"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={muted ? 0 : volume}
          onChange={(e) => setVolume(Number(e.target.value))}
        />
      </div>
    </footer>
  );
}
