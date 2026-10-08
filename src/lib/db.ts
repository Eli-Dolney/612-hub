import type { Folder, Lyrics, Playlist, Track } from "./types";

// Legacy storage key retained so existing 612 Play libraries/preferences survive the rename.
const DB_NAME = "grokplay";
const DB_VER = 1;

type Stores = {
  folders: Folder;
  tracks: Track;
  arts: { id: string; blob: Blob };
  peaks: { id: string; peaks: number[] };
  lyrics: Lyrics;
  playlists: Playlist;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("folders")) db.createObjectStore("folders", { keyPath: "id" });
      if (!db.objectStoreNames.contains("tracks")) {
        const s = db.createObjectStore("tracks", { keyPath: "id" });
        s.createIndex("folderId", "folderId", { unique: false });
        s.createIndex("album", "album", { unique: false });
        s.createIndex("artist", "artist", { unique: false });
      }
      if (!db.objectStoreNames.contains("arts")) db.createObjectStore("arts", { keyPath: "id" });
      if (!db.objectStoreNames.contains("peaks")) db.createObjectStore("peaks", { keyPath: "id" });
      if (!db.objectStoreNames.contains("lyrics")) db.createObjectStore("lyrics", { keyPath: "trackId" });
      if (!db.objectStoreNames.contains("playlists")) db.createObjectStore("playlists", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;
function db() {
  if (!dbPromise) dbPromise = openDb();
  return dbPromise;
}

function txDone(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function reqTo<T>(req: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getAll<K extends keyof Stores>(store: K): Promise<Stores[K][]> {
  const database = await db();
  return reqTo(database.transaction(store).objectStore(store).getAll()) as Promise<Stores[K][]>;
}

export async function getOne<K extends keyof Stores>(store: K, id: string): Promise<Stores[K] | undefined> {
  const database = await db();
  return reqTo(database.transaction(store).objectStore(store).get(id)) as Promise<Stores[K] | undefined>;
}

export async function putOne<K extends keyof Stores>(store: K, value: Stores[K]) {
  const database = await db();
  const tx = database.transaction(store, "readwrite");
  tx.objectStore(store).put(value);
  await txDone(tx);
}

export async function putMany<K extends keyof Stores>(store: K, values: Stores[K][]) {
  if (values.length === 0) return;
  const database = await db();
  const tx = database.transaction(store, "readwrite");
  const os = tx.objectStore(store);
  for (const v of values) os.put(v);
  await txDone(tx);
}

export async function delOne(store: keyof Stores, id: string) {
  const database = await db();
  const tx = database.transaction(store, "readwrite");
  tx.objectStore(store).delete(id);
  await txDone(tx);
}

export async function deleteFolderData(folderId: string) {
  const tracks = await getAll("tracks");
  const mine = tracks.filter((t) => t.folderId === folderId);
  const database = await db();
  const tx = database.transaction(["folders", "tracks", "arts", "peaks", "lyrics"], "readwrite");
  tx.objectStore("folders").delete(folderId);
  for (const t of mine) {
    tx.objectStore("tracks").delete(t.id);
    tx.objectStore("arts").delete(t.id);
    tx.objectStore("peaks").delete(t.id);
    tx.objectStore("lyrics").delete(t.id);
  }
  await txDone(tx);
  return mine.map((t) => t.id);
}
