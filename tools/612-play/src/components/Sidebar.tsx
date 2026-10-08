import { useMemo, useState } from "react";
import {
  Disc3,
  FolderPlus,
  Heart,
  Library,
  ListMusic,
  Plus,
  Radio,
  Sparkles,
  User,
} from "lucide-react";
import { buildMixes } from "../lib/mixes";
import { useLibrary } from "../state/library";
import { useUi } from "../state/ui";

export function Sidebar() {
  const { tracks, playlists, scan, createPlaylist, addFolder } = useLibrary();
  const { view, setView } = useUi();
  const mixes = useMemo(() => buildMixes(tracks), [tracks]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  async function submit() {
    const n = name.trim();
    setCreating(false);
    setName("");
    if (!n) return;
    const pl = await createPlaylist(n);
    setView({ kind: "playlist", id: pl.id });
  }

  const item = (active: boolean) => `nav-item ${active ? "active" : ""}`;

  return (
    <aside className="sidebar">
      <nav className="nav">
        <button className={item(view.kind === "listen")} onClick={() => setView({ kind: "listen" })}>
          <Radio size={18} /> Listen
        </button>
        <button className={item(view.kind === "tracks")} onClick={() => setView({ kind: "tracks" })}>
          <Library size={18} /> Tracks
        </button>
        <button className={item(view.kind === "albums")} onClick={() => setView({ kind: "albums" })}>
          <Disc3 size={18} /> Albums
        </button>
        <button className={item(view.kind === "artists")} onClick={() => setView({ kind: "artists" })}>
          <User size={18} /> Artists
        </button>
      </nav>

      <div className="side-label">Mixes</div>
      <div className="side-scroll">
        {mixes.map((m) => (
          <button
            key={m.id}
            className={item(view.kind === "mix" && view.id === m.id)}
            onClick={() => setView({ kind: "mix", id: m.id })}
          >
            {m.id === "liked" ? <Heart size={16} /> : <Sparkles size={16} />}
            <span className="truncate">{m.name}</span>
          </button>
        ))}

        <div className="side-label">Playlists</div>
        {creating ? (
          <input
            autoFocus
            className="side-input"
            value={name}
            placeholder="Playlist name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
              if (e.key === "Escape") {
                setCreating(false);
                setName("");
              }
            }}
            onBlur={() => void submit()}
          />
        ) : (
          <button className="nav-item" onClick={() => setCreating(true)}>
            <Plus size={16} /> New playlist
          </button>
        )}
        {playlists.map((pl) => (
          <button
            key={pl.id}
            className={item(view.kind === "playlist" && view.id === pl.id)}
            onClick={() => setView({ kind: "playlist", id: pl.id })}
          >
            <ListMusic size={16} />
            <span className="truncate">{pl.name}</span>
          </button>
        ))}
      </div>

      <div className="side-foot">
        {scan.running && (
          <div className="scan-meter">
            <div className="muted">
              Reading {scan.folderName} · {scan.done}/{scan.total || "…"}
            </div>
            <div className="meter">
              <b style={{ width: `${scan.total ? (scan.done / scan.total) * 100 : 8}%` }} />
            </div>
          </div>
        )}
        <button className="btn" onClick={() => void addFolder()}>
          <FolderPlus size={16} /> Add folder
        </button>
      </div>
    </aside>
  );
}
