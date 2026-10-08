import { create } from "zustand";
import { deleteFolderData, delOne, getAll, putOne } from "../lib/db";
import { canPickDirectory, pickDirectory, scanDirectory, ensurePermission } from "../lib/fs";
import type { Folder, Playlist, ScanProgress, Track } from "../lib/types";
import { uid } from "../lib/format";

type LibraryState = {
  ready: boolean;
  tracks: Track[];
  folders: Folder[];
  playlists: Playlist[];
  scan: ScanProgress;
  denied: Folder[];
  error?: string;
  boot: () => Promise<void>;
  addFolder: (handle?: FileSystemDirectoryHandle) => Promise<void>;
  removeFolder: (id: string) => Promise<void>;
  requestAccess: (folder: Folder) => Promise<boolean>;
  patchTrack: (id: string, patch: Partial<Track>) => void;
  toggleLike: (id: string) => void;
  createPlaylist: (name: string, trackIds?: string[]) => Promise<Playlist>;
  renamePlaylist: (id: string, name: string) => Promise<void>;
  deletePlaylist: (id: string) => Promise<void>;
  addToPlaylist: (id: string, trackIds: string[]) => Promise<void>;
  removeFromPlaylist: (id: string, trackId: string) => Promise<void>;
};

function upsertTracks(list: Track[], incoming: Track[]) {
  const map = new Map(list.map((t) => [t.id, t]));
  for (const t of incoming) {
    const prev = map.get(t.id);
    map.set(
      t.id,
      prev
        ? {
            ...t,
            playCount: prev.playCount,
            liked: prev.liked,
            lastPlayedAt: prev.lastPlayedAt,
            listenSec: prev.listenSec,
          }
        : t,
    );
  }
  return [...map.values()];
}

export const useLibrary = create<LibraryState>((set, get) => ({
  ready: false,
  tracks: [],
  folders: [],
  playlists: [],
  scan: { folderName: "", done: 0, total: 0, running: false },
  denied: [],
  boot: async () => {
    const [tracks, folders, playlists] = await Promise.all([
      getAll("tracks"),
      getAll("folders"),
      getAll("playlists"),
    ]);
    const denied: Folder[] = [];
    for (const f of folders) {
      try {
        const q = await (f.handle as FileSystemDirectoryHandle & {
          queryPermission: (d?: { mode?: "read" }) => Promise<PermissionState>;
        }).queryPermission({ mode: "read" });
        if (q !== "granted") denied.push(f);
      } catch {
        denied.push(f);
      }
    }
    set({ tracks, folders, playlists, denied, ready: true });
  },
  addFolder: async (incoming) => {
    if (!incoming && !canPickDirectory()) {
      set({ error: "Folder access needs Chrome, Edge, or Arc." });
      return;
    }
    try {
      const handle = incoming ?? (await pickDirectory());
      let existing = get().folders.find((f) => f.handle === handle);
      if (!existing) {
        for (const f of get().folders) {
          try {
            if (await f.handle.isSameEntry(handle)) {
              existing = f;
              break;
            }
          } catch {
            /* ignore */
          }
        }
      }
      set({
        scan: { folderName: handle.name, done: 0, total: 0, running: true },
        error: undefined,
      });
      await scanDirectory(handle, existing, {
        onTotal: (total) => set((s) => ({ scan: { ...s.scan, total } })),
        onBatch: (batch, done, total) => {
          set((s) => ({
            tracks: upsertTracks(s.tracks, batch),
            scan: { ...s.scan, done, total, running: true },
          }));
        },
      });
      const folders = await getAll("folders");
      const tracks = await getAll("tracks");
      set({
        folders,
        tracks,
        scan: { folderName: handle.name, done: 0, total: 0, running: false },
        denied: get().denied.filter((d) => d.id !== existing?.id),
      });
    } catch (e) {
      set({
        scan: { folderName: "", done: 0, total: 0, running: false },
        error: e instanceof Error ? e.message : "Could not open folder",
      });
    }
  },
  removeFolder: async (id) => {
    await deleteFolderData(id);
    set((s) => ({
      folders: s.folders.filter((f) => f.id !== id),
      tracks: s.tracks.filter((t) => t.folderId !== id),
      denied: s.denied.filter((f) => f.id !== id),
    }));
  },
  requestAccess: async (folder) => {
    const ok = await ensurePermission(folder.handle);
    if (ok) set((s) => ({ denied: s.denied.filter((f) => f.id !== folder.id) }));
    return ok;
  },
  patchTrack: (id, patch) => {
    set((s) => {
      const tracks = s.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t));
      const track = tracks.find((t) => t.id === id);
      if (track) void putOne("tracks", track);
      return { tracks };
    });
  },
  toggleLike: (id) => {
    const t = get().tracks.find((x) => x.id === id);
    if (!t) return;
    get().patchTrack(id, { liked: !t.liked });
  },
  createPlaylist: async (name, trackIds = []) => {
    const pl: Playlist = {
      id: uid(),
      name,
      trackIds,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await putOne("playlists", pl);
    set((s) => ({ playlists: [...s.playlists, pl] }));
    return pl;
  },
  renamePlaylist: async (id, name) => {
    const pl = get().playlists.find((p) => p.id === id);
    if (!pl) return;
    const next = { ...pl, name, updatedAt: Date.now() };
    await putOne("playlists", next);
    set((s) => ({ playlists: s.playlists.map((p) => (p.id === id ? next : p)) }));
  },
  deletePlaylist: async (id) => {
    await delOne("playlists", id);
    set((s) => ({ playlists: s.playlists.filter((p) => p.id !== id) }));
  },
  addToPlaylist: async (id, trackIds) => {
    const pl = get().playlists.find((p) => p.id === id);
    if (!pl) return;
    const setIds = [...new Set([...pl.trackIds, ...trackIds])];
    const next = { ...pl, trackIds: setIds, updatedAt: Date.now() };
    await putOne("playlists", next);
    set((s) => ({ playlists: s.playlists.map((p) => (p.id === id ? next : p)) }));
  },
  removeFromPlaylist: async (id, trackId) => {
    const pl = get().playlists.find((p) => p.id === id);
    if (!pl) return;
    const next = { ...pl, trackIds: pl.trackIds.filter((x) => x !== trackId), updatedAt: Date.now() };
    await putOne("playlists", next);
    set((s) => ({ playlists: s.playlists.map((p) => (p.id === id ? next : p)) }));
  },
}));
