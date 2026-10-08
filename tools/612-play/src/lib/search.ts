import type { Track } from "./types";
import { displayTitle } from "./format";

function norm(s: string) {
  return s.toLowerCase().normalize("NFKD").replace(/\p{Diacritic}/gu, "");
}

export function searchTracks(tracks: Track[], q: string) {
  const query = norm(q.trim());
  if (!query) return tracks;
  const parts = query.split(/\s+/).filter(Boolean);
  return tracks.filter((t) => {
    const hay = norm(`${displayTitle(t)} ${t.artist} ${t.album} ${t.albumArtist} ${t.genre} ${t.fileName}`);
    return parts.every((p) => hay.includes(p));
  });
}

export function searchAll(tracks: Track[], q: string) {
  const songs = searchTracks(tracks, q).slice(0, 12);
  const query = norm(q.trim());
  const albums = new Map<string, { album: string; artist: string; count: number }>();
  const artists = new Map<string, number>();
  for (const t of tracks) {
    if (query && !norm(`${t.album} ${t.albumArtist}`).includes(query) && !norm(t.artist).includes(query)) continue;
    const k = `${t.album}::${t.albumArtist}`;
    const a = albums.get(k) ?? { album: t.album, artist: t.albumArtist, count: 0 };
    a.count++;
    albums.set(k, a);
    artists.set(t.artist, (artists.get(t.artist) ?? 0) + 1);
  }
  return {
    songs,
    albums: [...albums.values()].sort((a, b) => b.count - a.count).slice(0, 8),
    artists: [...artists.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, count]) => ({ name, count })),
  };
}
