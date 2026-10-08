import { parseLrc } from "./lrc";
import { getAll, putMany, putOne } from "./db";
import { shrinkCover } from "./color";
import { readTags } from "./tags";
import {
  dirname,
  isAudioName,
  isCoverName,
  isLrcName,
  stem,
  trackId,
  type Folder,
  type Lyrics,
  type Track,
} from "./types";
import { uid } from "./format";

type PermHandle = FileSystemDirectoryHandle & {
  queryPermission: (d?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>;
  requestPermission: (d?: { mode?: "read" | "readwrite" }) => Promise<PermissionState>;
};

type DirEntry =
  | (FileSystemDirectoryHandle & { kind: "directory"; name: string })
  | (FileSystemFileHandle & { kind: "file"; name: string });

export function canPickDirectory() {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

export async function pickDirectory() {
  if (!window.showDirectoryPicker) throw new Error("This browser cannot open folders. Use Chrome, Edge, or Arc.");
  return window.showDirectoryPicker({ id: "612-play-library", mode: "read", startIn: "music" });
}

export async function ensurePermission(handle: FileSystemDirectoryHandle) {
  const h = handle as PermHandle;
  const q = await h.queryPermission({ mode: "read" });
  if (q === "granted") return true;
  const r = await h.requestPermission({ mode: "read" });
  return r === "granted";
}

export async function handleFromDropItem(item: DataTransferItem) {
  if (item.getAsFileSystemHandle) {
    const h = await item.getAsFileSystemHandle();
    if (h && h.kind === "directory") return h as FileSystemDirectoryHandle;
  }
  return null;
}

async function walk(
  dir: FileSystemDirectoryHandle,
  prefix = "",
  files: { rel: string; handle: FileSystemFileHandle }[] = [],
  covers = new Map<string, FileSystemFileHandle>(),
  lyrics = new Map<string, FileSystemFileHandle>(),
  trackCovers = new Map<string, FileSystemFileHandle>(),
) {
  const iter = (dir as FileSystemDirectoryHandle & { values: () => AsyncIterable<DirEntry> }).values();
  for await (const entry of iter) {
    if (entry.name.startsWith(".")) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.kind === "directory") {
      await walk(entry, rel, files, covers, lyrics, trackCovers);
    } else if (isAudioName(entry.name)) {
      files.push({ rel, handle: entry });
    } else if (entry.name.toLowerCase().endsWith(".cover.png")) {
      trackCovers.set(rel.slice(0, -".cover.png".length), entry);
    } else if (isCoverName(entry.name)) {
      const dirName = dirname(rel);
      if (!covers.has(dirName)) covers.set(dirName, entry);
    } else if (isLrcName(entry.name)) {
      lyrics.set(`${dirname(rel)}/${stem(entry.name)}`.replace(/^\//, ""), entry);
    }
  }
  return { files, covers, lyrics, trackCovers };
}

async function fileFromPath(root: FileSystemDirectoryHandle, rel: string) {
  const parts = rel.split("/").filter(Boolean);
  let dir = root;
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i]);
  }
  const fh = await dir.getFileHandle(parts[parts.length - 1]);
  return fh.getFile();
}

export async function getTrackFile(folder: Folder, track: Track) {
  const ok = await ensurePermission(folder.handle);
  if (!ok) throw new Error("Folder access was denied. Click Allow on the library folder.");
  return fileFromPath(folder.handle, track.relativePath);
}

type ScanHooks = {
  onTotal: (total: number) => void;
  onBatch: (tracks: Track[], done: number, total: number) => void;
};

export async function scanDirectory(handle: FileSystemDirectoryHandle, existing?: Folder, hooks?: ScanHooks) {
  const folder: Folder = existing ?? {
    id: uid(),
    name: handle.name,
    handle,
    addedAt: Date.now(),
  };
  await putOne("folders", folder);
  const prev = new Map((await getAll("tracks")).filter((t) => t.folderId === folder.id).map((t) => [t.id, t]));

  const { files, covers, lyrics, trackCovers } = await walk(handle);
  hooks?.onTotal(files.length);

  const coverBlobs = new Map<string, Blob>();
  for (const [dir, fh] of covers) {
    try {
      coverBlobs.set(dir, await shrinkCover(await fh.getFile()));
    } catch {
      /* skip */
    }
  }

  const conc = 6;
  for (let i = 0; i < files.length; i += conc) {
    const chunk = files.slice(i, i + conc);
    const results = await Promise.all(
      chunk.map(async (f) => {
        try {
          const file = await f.handle.getFile();
          const tags = await readTags(file);
          const id = trackId(folder.id, f.rel);
          const dir = dirname(f.rel);
          let blob: Blob | undefined;
          const sidecar = trackCovers.get(stem(f.rel));
          if (sidecar) {
            try { blob = await shrinkCover(await sidecar.getFile()); } catch { /* try embedded art */ }
          }
          if (!blob && tags.picture) {
            try {
              blob = await shrinkCover(tags.picture);
            } catch {
              blob = tags.picture;
            }
          }
          if (!blob) blob = coverBlobs.get(dir);
          const lrcKey = `${dir}/${stem(f.rel.split("/").pop() || "")}`.replace(/^\//, "");
          const lrcHandle = lyrics.get(lrcKey);
          let lyric: Lyrics | undefined;
          if (lrcHandle) {
            try {
              const text = await (await lrcHandle.getFile()).text();
              lyric = { trackId: id, text, lines: parseLrc(text) };
            } catch {
              /* skip */
            }
          }
          const before = prev.get(id);
          const track: Track = {
            id,
            folderId: folder.id,
            relativePath: f.rel,
            fileName: file.name,
            title: tags.title || stem(file.name).replace(/[_]+/g, " "),
            artist: tags.artist || "Unknown artist",
            album: tags.album || "Unknown album",
            albumArtist: tags.albumArtist || tags.artist || "Unknown artist",
            genre: tags.genre || "",
            year: tags.year,
            trackNo: tags.trackNo,
            discNo: tags.discNo,
            duration: tags.duration ?? before?.duration,
            addedAt: before?.addedAt ?? Date.now(),
            playCount: before?.playCount ?? 0,
            lastPlayedAt: before?.lastPlayedAt,
            listenSec: before?.listenSec ?? 0,
            liked: before?.liked ?? false,
            hasArt: Boolean(blob),
            hasLyrics: Boolean(lyric),
          };
          return { track, blob, lyric };
        } catch {
          return null;
        }
      }),
    );

    const tracks: Track[] = [];
    const arts: { id: string; blob: Blob }[] = [];
    const lyricRows: Lyrics[] = [];
    for (const row of results) {
      if (!row) continue;
      tracks.push(row.track);
      if (row.blob) arts.push({ id: row.track.id, blob: row.blob });
      if (row.lyric) lyricRows.push(row.lyric);
    }
    await putMany("tracks", tracks);
    await putMany("arts", arts);
    await putMany("lyrics", lyricRows);
    hooks?.onBatch(tracks, Math.min(i + conc, files.length), files.length);
  }

  return folder;
}
