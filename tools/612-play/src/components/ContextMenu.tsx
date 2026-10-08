import { useLibrary } from "../state/library";
import { usePlayer } from "../state/player";
import { useUi } from "../state/ui";

export function ContextMenu() {
  const ctx = useUi((s) => s.context);
  const setContext = useUi((s) => s.setContext);
  const { playlists, addToPlaylist, toggleLike, tracks } = useLibrary();
  const { playIds, playNext, addToQueue } = usePlayer();
  if (!ctx) return null;
  const track = tracks.find((t) => t.id === ctx.trackId);
  if (!track) return null;

  return (
    <div className="ctx-bg" onClick={() => setContext(null)} onContextMenu={(e) => e.preventDefault()}>
      <div className="ctx" style={{ left: ctx.x, top: ctx.y }} onClick={(e) => e.stopPropagation()}>
        <button
          onClick={() => {
            void playIds([track.id], 0);
            setContext(null);
          }}
        >
          Play
        </button>
        <button
          onClick={() => {
            playNext([track.id]);
            setContext(null);
          }}
        >
          Play next
        </button>
        <button
          onClick={() => {
            addToQueue([track.id]);
            setContext(null);
          }}
        >
          Add to queue
        </button>
        <button
          onClick={() => {
            toggleLike(track.id);
            setContext(null);
          }}
        >
          {track.liked ? "Unlike" : "Like"}
        </button>
        {playlists.length > 0 && <div className="ctx-label">Add to playlist</div>}
        {playlists.map((pl) => (
          <button
            key={pl.id}
            onClick={() => {
              void addToPlaylist(pl.id, [track.id]);
              setContext(null);
            }}
          >
            {pl.name}
          </button>
        ))}
      </div>
    </div>
  );
}
