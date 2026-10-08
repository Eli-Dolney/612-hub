export const AUDIO_EXT = new Set([
  ".mp3",
  ".m4a",
  ".aac",
  ".flac",
  ".wav",
  ".ogg",
  ".opus",
  ".wma",
  ".aiff",
  ".aif",
  ".alac",
]);

export const COVER_NAMES = new Set([
  "cover.jpg",
  "cover.jpeg",
  "cover.png",
  "folder.jpg",
  "folder.png",
  "album.jpg",
  "albumart.jpg",
  "front.jpg",
  "artwork.jpg",
]);

export type RepeatMode = "off" | "all" | "one";
export type VisMode = "bars" | "wave" | "radial" | "particles" | "aurora" | "spectrogram";
export type View =
  | { kind: "listen" }
  | { kind: "tracks" }
  | { kind: "albums" }
  | { kind: "artists" }
  | { kind: "album"; name: string; artist: string }
  | { kind: "artist"; name: string }
  | { kind: "playlist"; id: string }
  | { kind: "mix"; id: string };

export type Folder = {
  id: string;
  name: string;
  handle: FileSystemDirectoryHandle;
  addedAt: number;
};

export type Track = {
  id: string;
  folderId: string;
  relativePath: string;
  fileName: string;
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  genre: string;
  year?: number;
  trackNo?: number;
  discNo?: number;
  duration?: number;
  addedAt: number;
  playCount: number;
  lastPlayedAt?: number;
  listenSec: number;
  liked: boolean;
  hasArt: boolean;
  hasLyrics: boolean;
};

export type Playlist = {
  id: string;
  name: string;
  trackIds: string[];
  createdAt: number;
  updatedAt: number;
};

export type LyricLine = { t: number; text: string };

export type Lyrics = {
  trackId: string;
  text: string;
  lines: LyricLine[];
};

export type ScanProgress = {
  folderName: string;
  done: number;
  total: number;
  running: boolean;
};

export const EQ_FREQS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export const EQ_PRESETS: { name: string; bands: number[] }[] = [
  { name: "Flat", bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { name: "Warm", bands: [3, 2, 1, 0, 0, -1, -1, 0, 1, 2] },
  { name: "Bass", bands: [6, 5, 3, 1, 0, 0, 0, 0, 0, 0] },
  { name: "Vocal", bands: [-2, -1, 0, 1, 3, 4, 3, 1, 0, -1] },
  { name: "Bright", bands: [0, 0, -1, -1, 0, 1, 2, 4, 5, 5] },
  { name: "Night", bands: [2, 1, 0, -1, -2, -1, 0, 1, 2, 1] },
];

export function extOf(name: string) {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

export function isAudioName(name: string) {
  return AUDIO_EXT.has(extOf(name));
}

export function isCoverName(name: string) {
  return COVER_NAMES.has(name.toLowerCase());
}

export function isLrcName(name: string) {
  return extOf(name) === ".lrc";
}

export function stem(name: string) {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(0, i) : name;
}

export function dirname(rel: string) {
  const i = rel.lastIndexOf("/");
  return i >= 0 ? rel.slice(0, i) : "";
}

export function trackId(folderId: string, rel: string) {
  return `${folderId}:${rel}`;
}

export function albumKey(album: string, artist: string) {
  return `${album.toLowerCase()}::${artist.toLowerCase()}`;
}
