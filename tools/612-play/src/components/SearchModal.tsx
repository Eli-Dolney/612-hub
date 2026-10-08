import { useEffect, useMemo, useRef } from "react";
import { Disc3, Music, User } from "lucide-react";
import { searchAll } from "../lib/search";
import { displayTitle } from "../lib/format";
import { useLibrary } from "../state/library";
import { usePlayer } from "../state/player";
import { useUi } from "../state/ui";

export function SearchModal() {
  const open = useUi((s) => s.searchOpen);
  const search = useUi((s) => s.search);
  const setSearch = useUi((s) => s.setSearch);
  const setSearchOpen = useUi((s) => s.setSearchOpen);
  const setView = useUi((s) => s.setView);
  const tracks = useLibrary((s) => s.tracks);
  const playIds = usePlayer((s) => s.playIds);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => searchAll(tracks, search), [tracks, search]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="modal-bg" onClick={() => setSearchOpen(false)}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={search}
          placeholder="Jump to a song, album, or artist"
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setSearchOpen(false);
            if (e.key === "Enter" && results.songs[0]) {
              void playIds(
                tracks.map((t) => t.id),
                tracks.findIndex((t) => t.id === results.songs[0].id),
              );
              setSearchOpen(false);
            }
          }}
        />
        <div className="palette-body">
          {results.songs.length > 0 && <div className="side-label">Songs</div>}
          {results.songs.map((t) => (
            <button
              key={t.id}
              className="pal-row"
              onClick={() => {
                void playIds(
                  tracks.map((t) => t.id),
                  tracks.findIndex((x) => x.id === t.id),
                );
                setSearchOpen(false);
              }}
            >
              <Music size={14} />
              <span className="truncate">{displayTitle(t)}</span>
              <span className="muted truncate">{t.artist}</span>
            </button>
          ))}
          {results.albums.length > 0 && <div className="side-label">Albums</div>}
          {results.albums.map((a) => (
            <button
              key={`${a.album}-${a.artist}`}
              className="pal-row"
              onClick={() => {
                setView({ kind: "album", name: a.album, artist: a.artist });
                setSearchOpen(false);
              }}
            >
              <Disc3 size={14} />
              <span className="truncate">{a.album}</span>
              <span className="muted truncate">{a.artist}</span>
            </button>
          ))}
          {results.artists.length > 0 && <div className="side-label">Artists</div>}
          {results.artists.map((a) => (
            <button
              key={a.name}
              className="pal-row"
              onClick={() => {
                setView({ kind: "artist", name: a.name });
                setSearchOpen(false);
              }}
            >
              <User size={14} />
              <span className="truncate">{a.name}</span>
              <span className="muted">{a.count} tracks</span>
            </button>
          ))}
          {search && results.songs.length === 0 && results.albums.length === 0 && (
            <div className="muted pad">No matches.</div>
          )}
        </div>
      </div>
    </div>
  );
}
