import { Heart, Play } from "lucide-react";
import { Cover } from "./Cover";
import { displayTitle, formatTime } from "../lib/format";
import type { Track } from "../lib/types";

type Props = {
  track: Track;
  index: number;
  active?: boolean;
  playing?: boolean;
  onPlay: () => void;
  onLike: () => void;
  onContext: (e: React.MouseEvent) => void;
};

export function TrackRow({ track, index, active, playing, onPlay, onLike, onContext }: Props) {
  return (
    <div
      className={`trow ${active ? "active" : ""}`}
      onDoubleClick={onPlay}
      onContextMenu={onContext}
    >
      <button className="trow-num" onClick={onPlay} title="Play">
        <span className="num">{index + 1}</span>
        <Play size={12} fill="currentColor" className="play" />
        {playing && <span className="eq-mini" aria-hidden />}
      </button>
      <Cover id={track.hasArt ? track.id : undefined} className="trow-art" />
      <div className="trow-meta">
        <div className="trow-title">{displayTitle(track)}</div>
        <div className="trow-sub">
          {track.artist}
          {track.album ? ` · ${track.album}` : ""}
        </div>
      </div>
      <div className="trow-album">{track.album}</div>
      <button className={`icon-btn like ${track.liked ? "on" : ""}`} onClick={onLike} title="Like">
        <Heart size={14} fill={track.liked ? "currentColor" : "none"} />
      </button>
      <div className="trow-time">{formatTime(track.duration || 0)}</div>
    </div>
  );
}
