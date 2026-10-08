import { useEffect, useMemo, useRef, useState } from "react";
import { TrackRow } from "./TrackRow";
import { useLibrary } from "../state/library";
import { usePlayer } from "../state/player";
import { useUi } from "../state/ui";

const ROW = 54;

export function TrackList({ ids }: { ids: string[] }) {
  const tracks = useLibrary((s) => s.tracks);
  const toggleLike = useLibrary((s) => s.toggleLike);
  const { currentId, isPlaying, playIds } = usePlayer();
  const setContext = useUi((s) => s.setContext);
  const byId = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks]);
  const ref = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState(0);
  const [height, setHeight] = useState(640);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    setHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const start = Math.max(0, Math.floor(scroll / ROW) - 6);
  const visible = Math.ceil(height / ROW) + 12;
  const slice = ids.slice(start, start + visible);

  return (
    <div
      ref={ref}
      className="tracklist"
      onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
    >
      <div style={{ height: ids.length * ROW, position: "relative" }}>
        {slice.map((id, i) => {
          const track = byId.get(id);
          if (!track) return null;
          const index = start + i;
          return (
            <div key={id} style={{ position: "absolute", top: index * ROW, left: 0, right: 0, height: ROW }}>
              <TrackRow
                track={track}
                index={index}
                active={currentId === id}
                playing={currentId === id && isPlaying}
                onPlay={() => void playIds(ids, index)}
                onLike={() => toggleLike(id)}
                onContext={(e) => {
                  e.preventDefault();
                  setContext({ x: e.clientX, y: e.clientY, trackId: id });
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
