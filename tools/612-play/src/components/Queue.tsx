import { ListX } from "lucide-react";
import { Cover } from "./Cover";
import { displayTitle } from "../lib/format";
import { useLibrary } from "../state/library";
import { usePlayer } from "../state/player";

export function Queue() {
  const tracks = useLibrary((s) => s.tracks);
  const { queue, index, isPlaying, jumpTo, removeFromQueue, clearQueue, vis, setVis } = usePlayer();
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const upcoming = queue.map((id, i) => ({ id, i, track: byId.get(id) })).filter((x) => x.track);

  return (
    <aside className="queue">
      <div className="queue-head">
        <b>Up next</b>
        <div className="row-gap">
          <select className="vis-select" value={vis} onChange={(e) => setVis(e.target.value as typeof vis)}>
            <option value="aurora">Aurora</option>
            <option value="bars">Bars</option>
            <option value="wave">Wave</option>
            <option value="radial">Radial</option>
            <option value="particles">Particles</option>
            <option value="spectrogram">Spectrogram</option>
          </select>
          <button className="icon-btn" title="Clear queue" onClick={clearQueue}>
            <ListX size={16} />
          </button>
        </div>
      </div>
      <div className="queue-list">
        {upcoming.length === 0 && <div className="muted pad">Queue is empty. Play an album or mix.</div>}
        {upcoming.map(({ id, i, track }) => (
          <button
            key={`${id}-${i}`}
            className={`qrow ${i === index ? "active" : ""}`}
            onClick={() => void jumpTo(i)}
            onContextMenu={(e) => {
              e.preventDefault();
              if (i !== index) removeFromQueue(i);
            }}
          >
            <Cover id={track!.hasArt ? track!.id : undefined} className="qart" />
            <div className="min-w-0">
              <div className="truncate">
                {i === index && isPlaying ? "▶ " : ""}
                {displayTitle(track!)}
              </div>
              <div className="muted truncate">{track!.artist}</div>
            </div>
          </button>
        ))}
      </div>
    </aside>
  );
}
