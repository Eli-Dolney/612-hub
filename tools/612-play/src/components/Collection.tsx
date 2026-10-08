import { useMemo, type ReactNode } from "react";
import { Play, Trash2 } from "lucide-react";
import { Cover } from "./Cover";
import { TrackList } from "./TrackList";
import { buildMixes, groupAlbums, groupArtists } from "../lib/mixes";
import { byTrackNo, displayTitle } from "../lib/format";
import { useLibrary } from "../state/library";
import { usePlayer } from "../state/player";
import { useUi } from "../state/ui";

export function Collection() {
  const { tracks, playlists, folders, removeFolder, denied, requestAccess, deletePlaylist } = useLibrary();
  const playIds = usePlayer((s) => s.playIds);
  const { view, setView } = useUi();
  const albums = useMemo(() => groupAlbums(tracks), [tracks]);
  const artists = useMemo(() => groupArtists(tracks), [tracks]);
  const mixes = useMemo(() => buildMixes(tracks), [tracks]);

  if (view.kind === "listen") return null;

  let title = "Library";
  let hint = `${tracks.length} tracks`;
  let ids: string[] = [];
  let header: ReactNode = null;

  if (view.kind === "tracks") {
    title = "Tracks";
    ids = tracks.map((t) => t.id);
    header = (
      <div className="folder-row">
        {denied.map((f) => (
          <button key={f.id} className="btn" onClick={() => void requestAccess(f)}>
            Allow “{f.name}”
          </button>
        ))}
        {folders.map((f) => (
          <span key={f.id} className="chip ghost">
            {f.name}
            <button className="tiny" onClick={() => void removeFolder(f.id)} title="Remove folder">
              <Trash2 size={12} />
            </button>
          </span>
        ))}
      </div>
    );
  } else if (view.kind === "albums") {
    return (
      <section className="collection">
        <header className="col-head">
          <h2>Albums</h2>
          <span className="muted">{albums.length}</span>
        </header>
        <div className="grid">
          {albums.map((a) => (
            <button
              key={`${a.album}-${a.artist}`}
              className="album-card"
              onClick={() => setView({ kind: "album", name: a.album, artist: a.artist })}
              onDoubleClick={() => void playIds(a.tracks.map((t) => t.id), 0)}
            >
              <Cover id={a.artId} className="album-art" />
              <b className="truncate">{a.album}</b>
              <span className="muted truncate">{a.artist}</span>
            </button>
          ))}
        </div>
      </section>
    );
  } else if (view.kind === "artists") {
    return (
      <section className="collection">
        <header className="col-head">
          <h2>Artists</h2>
          <span className="muted">{artists.length}</span>
        </header>
        <div className="grid">
          {artists.map((a) => (
            <button key={a.name} className="album-card" onClick={() => setView({ kind: "artist", name: a.name })}>
              <Cover id={a.artId} className="album-art round" />
              <b className="truncate">{a.name}</b>
              <span className="muted">{a.tracks.length} tracks</span>
            </button>
          ))}
        </div>
      </section>
    );
  } else if (view.kind === "album") {
    const album = albums.find((a) => a.album === view.name && a.artist === view.artist);
    title = view.name;
    hint = album ? `${album.artist}${album.year ? ` · ${album.year}` : ""}` : "";
    ids = (album?.tracks ?? []).map((t) => t.id);
    header = album ? (
      <div className="detail-head">
        <Cover id={album.artId} className="detail-art" />
        <button className="btn primary" onClick={() => void playIds(ids, 0)}>
          <Play size={14} fill="currentColor" /> Play album
        </button>
      </div>
    ) : null;
  } else if (view.kind === "artist") {
    const artist = artists.find((a) => a.name === view.name);
    title = view.name;
    hint = artist ? `${artist.tracks.length} tracks` : "";
    ids = (artist?.tracks ?? []).slice().sort(byTrackNo).map((t) => t.id);
  } else if (view.kind === "mix") {
    const mix = mixes.find((m) => m.id === view.id);
    title = mix?.name ?? "Mix";
    hint = mix?.hint ?? "";
    ids = mix?.tracks.map((t) => t.id) ?? [];
  } else if (view.kind === "playlist") {
    const pl = playlists.find((p) => p.id === view.id);
    title = pl?.name ?? "Playlist";
    hint = `${pl?.trackIds.length ?? 0} tracks`;
    ids = pl?.trackIds ?? [];
    const artId = ids.find((id) => tracks.some((t) => t.id === id && t.hasArt));
    header = pl ? (
      <div className="detail-head">
        <Cover id={artId} className="detail-art" />
        <button className="btn primary" onClick={() => void playIds(ids, 0)} disabled={ids.length === 0}>
          <Play size={14} fill="currentColor" /> Play
        </button>
        <button
          className="btn"
          onClick={() => {
            void deletePlaylist(pl.id);
            setView({ kind: "tracks" });
          }}
        >
          Delete
        </button>
      </div>
    ) : null;
  }

  return (
    <section className="collection">
      <header className="col-head">
        <div>
          <h2>{title}</h2>
          <div className="muted">{hint}</div>
        </div>
        {ids.length > 0 && (
          <button className="btn primary" onClick={() => void playIds(ids, 0)}>
            <Play size={14} fill="currentColor" /> Play
          </button>
        )}
      </header>
      {header}
      {ids.length === 0 ? <div className="muted pad">Nothing here yet.</div> : <TrackList ids={ids} />}
      {view.kind === "tracks" && tracks[0] && (
        <div className="sr-only">{displayTitle(tracks[0])}</div>
      )}
    </section>
  );
}
