import type { Track } from "./types";
import { byTrackNo } from "./format";

export type Mix = {
  id: string;
  name: string;
  hint: string;
  tracks: Track[];
};

const DAY = 86400000;

export function buildMixes(tracks: Track[]): Mix[] {
  const now = Date.now();
  const liked = tracks.filter((t) => t.liked);
  const onRepeat = [...tracks].filter((t) => t.playCount >= 2).sort((a, b) => b.playCount - a.playCount).slice(0, 40);
  const forgotten = tracks
    .filter((t) => t.playCount > 0 && t.lastPlayedAt && now - t.lastPlayedAt > 30 * DAY)
    .sort((a, b) => (a.lastPlayedAt ?? 0) - (b.lastPlayedAt ?? 0))
    .slice(0, 40);
  const fresh = [...tracks].sort((a, b) => b.addedAt - a.addedAt).slice(0, 40);
  const unheard = tracks.filter((t) => t.playCount === 0).slice(0, 40);
  const short = tracks.filter((t) => (t.duration ?? 999) > 0 && (t.duration ?? 999) < 180).slice(0, 40);

  const genres = new Map<string, Track[]>();
  for (const t of tracks) {
    const g = t.genre.trim();
    if (!g) continue;
    const list = genres.get(g) ?? [];
    list.push(t);
    genres.set(g, list);
  }
  const topGenre = [...genres.entries()].sort((a, b) => b[1].length - a[1].length)[0];

  const mixes: Mix[] = [
    { id: "liked", name: "Liked", hint: `${liked.length} saved`, tracks: liked },
    { id: "repeat", name: "On repeat", hint: "What you keep coming back to", tracks: onRepeat },
    { id: "forgotten", name: "Forgotten gems", hint: "Loved once, dusty now", tracks: forgotten },
    { id: "fresh", name: "Just in", hint: "Newest files in the library", tracks: fresh },
    { id: "unheard", name: "Never played", hint: "Sitting on the shelf", tracks: unheard },
    { id: "short", name: "Under 3 minutes", hint: "Quick hits", tracks: short },
  ];
  if (topGenre) {
    mixes.push({
      id: `genre:${topGenre[0]}`,
      name: topGenre[0],
      hint: `Biggest genre in this library`,
      tracks: topGenre[1].slice().sort(byTrackNo).slice(0, 40),
    });
  }
  return mixes.filter((m) => m.tracks.length > 0);
}

export function groupAlbums(tracks: Track[]) {
  const map = new Map<string, { album: string; artist: string; year?: number; tracks: Track[]; artId?: string }>();
  for (const t of tracks) {
    const key = `${t.album.toLowerCase()}::${t.albumArtist.toLowerCase()}`;
    const row = map.get(key) ?? { album: t.album, artist: t.albumArtist, year: t.year, tracks: [], artId: undefined };
    row.tracks.push(t);
    if (t.year && (!row.year || t.year < row.year)) row.year = t.year;
    if (!row.artId && t.hasArt) row.artId = t.id;
    map.set(key, row);
  }
  for (const row of map.values()) row.tracks.sort(byTrackNo);
  return [...map.values()].sort((a, b) => a.album.localeCompare(b.album));
}

export function groupArtists(tracks: Track[]) {
  const map = new Map<string, { name: string; tracks: Track[]; artId?: string }>();
  for (const t of tracks) {
    const key = t.artist || "Unknown artist";
    const row = map.get(key) ?? { name: key, tracks: [], artId: undefined };
    row.tracks.push(t);
    if (!row.artId && t.hasArt) row.artId = t.id;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}
