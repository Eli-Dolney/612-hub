import { create } from "zustand";
import { engine } from "../lib/audioEngine";
import { getTrackFile } from "../lib/fs";
import { computePeaks, loadPeaks } from "../lib/peaks";
import { clamp, shuffleCopy } from "../lib/format";
import { EQ_FREQS, EQ_PRESETS, type RepeatMode, type VisMode } from "../lib/types";
import { useLibrary } from "./library";

type Prefs = {
  volume: number;
  muted: boolean;
  crossfadeMs: number;
  eqOn: boolean;
  bands: number[];
  glue: boolean;
  vis: VisMode;
  queueOpen: boolean;
  lyricsOpen: boolean;
};

// Legacy storage key retained so existing 612 Play libraries/preferences survive the rename.
const PREF_KEY = "grokplay-prefs";

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return defaults;
}

const defaults: Prefs = {
  volume: 0.9,
  muted: false,
  crossfadeMs: 3000,
  eqOn: true,
  bands: EQ_FREQS.map(() => 0),
  glue: true,
  vis: "aurora",
  queueOpen: true,
  lyricsOpen: false,
};

function savePrefs(p: Partial<Prefs>) {
  const next = { ...loadPrefs(), ...p };
  localStorage.setItem(PREF_KEY, JSON.stringify(next));
}

type PlayerState = Prefs & {
  currentId?: string;
  queue: string[];
  original: string[];
  index: number;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  shuffled: boolean;
  repeat: RepeatMode;
  peaks: number[];
  error?: string;
  crossfadeArmed: boolean;
  playIds: (ids: string[], start: number) => Promise<void>;
  toggle: () => void;
  next: (opts?: { fromCrossfade?: boolean }) => Promise<void>;
  prev: () => Promise<void>;
  seek: (t: number) => void;
  setVolume: (v: number) => void;
  setMuted: (m: boolean) => void;
  toggleMute: () => void;
  setCrossfade: (ms: number) => void;
  setEqOn: (on: boolean) => void;
  setBand: (i: number, g: number) => void;
  applyPreset: (name: string) => void;
  setGlue: (on: boolean) => void;
  setVis: (v: VisMode) => void;
  setQueueOpen: (v: boolean) => void;
  setLyricsOpen: (v: boolean) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  addToQueue: (ids: string[]) => void;
  playNext: (ids: string[]) => void;
  removeFromQueue: (i: number) => void;
  jumpTo: (i: number) => Promise<void>;
  clearQueue: () => void;
};

async function loadCurrent(id: string, crossfadeMs: number) {
  const lib = useLibrary.getState();
  const track = lib.tracks.find((t) => t.id === id);
  const folder = track && lib.folders.find((f) => f.id === track.folderId);
  if (!track || !folder) throw new Error("Track is missing from the library.");
  const file = await getTrackFile(folder, track);
  await engine.playFile(file, crossfadeMs);
  void (async () => {
    try {
      const existing = await loadPeaks(id);
      if (existing) {
        usePlayer.setState({ peaks: existing });
        return;
      }
      if (engine.ctx) {
        const peaks = await computePeaks(id, file, engine.ctx);
        if (usePlayer.getState().currentId === id) usePlayer.setState({ peaks });
      }
    } catch {
      /* peaks are optional */
    }
  })();
  if (navigator.mediaSession) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album,
    });
    navigator.mediaSession.playbackState = "playing";
  }
}

function recordListen(id: string, completed: boolean, sec: number) {
  const lib = useLibrary.getState();
  const t = lib.tracks.find((x) => x.id === id);
  if (!t) return;
  lib.patchTrack(id, {
    playCount: t.playCount + (completed || sec > 12 ? 1 : 0),
    lastPlayedAt: Date.now(),
    listenSec: t.listenSec + Math.max(0, sec),
    duration: t.duration || usePlayer.getState().duration || t.duration,
  });
}

export const usePlayer = create<PlayerState>((set, get) => ({
  ...loadPrefs(),
  currentId: undefined,
  queue: [],
  original: [],
  index: -1,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  shuffled: false,
  repeat: "off",
  peaks: [],
  crossfadeArmed: false,
  playIds: async (ids, start) => {
    if (ids.length === 0) return;
    const original = [...ids];
    let queue = original;
    let index = clamp(start, 0, ids.length - 1);
    if (get().shuffled) {
      const startId = original[index];
      queue = [startId, ...shuffleCopy(original.filter((id) => id !== startId))];
      index = 0;
    }
    const id = queue[index];
    set({ queue, original, index, currentId: id, isPlaying: true, error: undefined, crossfadeArmed: false, peaks: [] });
    try {
      await loadCurrent(id, 0);
    } catch (e) {
      set({ isPlaying: false, error: e instanceof Error ? e.message : "Could not play" });
    }
  },
  toggle: () => {
    const s = get();
    if (!s.currentId) return;
    if (s.isPlaying) {
      engine.pause();
      set({ isPlaying: false });
      if (navigator.mediaSession) navigator.mediaSession.playbackState = "paused";
    } else {
      void engine.resumePlay().then(() => set({ isPlaying: true }));
      if (navigator.mediaSession) navigator.mediaSession.playbackState = "playing";
    }
  },
  next: async (opts) => {
    const s = get();
    if (s.queue.length === 0) return;
    if (s.repeat === "one" && !opts?.fromCrossfade) {
      engine.seek(0);
      await engine.resumePlay();
      set({ isPlaying: true, currentTime: 0, crossfadeArmed: false });
      return;
    }
    let index = s.index + 1;
    if (index >= s.queue.length) {
      if (s.repeat === "all") index = 0;
      else {
        engine.pause();
        set({ isPlaying: false, crossfadeArmed: false });
        return;
      }
    }
    if (s.currentId) recordListen(s.currentId, true, s.currentTime);
    const id = s.queue[index];
    set({ index, currentId: id, isPlaying: true, currentTime: 0, duration: 0, peaks: [], error: undefined });
    try {
      await loadCurrent(id, opts?.fromCrossfade ? s.crossfadeMs : 0);
    } catch (e) {
      set({ isPlaying: false, error: e instanceof Error ? e.message : "Could not play" });
    }
  },
  prev: async () => {
    const s = get();
    if (s.queue.length === 0) return;
    if (s.currentTime > 3) {
      engine.seek(0);
      return;
    }
    let index = s.index - 1;
    if (index < 0) index = s.repeat === "all" ? s.queue.length - 1 : 0;
    const id = s.queue[index];
    set({ index, currentId: id, isPlaying: true, currentTime: 0, duration: 0, peaks: [], error: undefined });
    try {
      await loadCurrent(id, 0);
    } catch (e) {
      set({ isPlaying: false, error: e instanceof Error ? e.message : "Could not play" });
    }
  },
  seek: (t) => {
    engine.seek(t);
    set({ currentTime: t });
  },
  setVolume: (v) => {
    const volume = clamp(v, 0, 1);
    engine.setVolume(volume);
    savePrefs({ volume, muted: false });
    set({ volume, muted: false });
    engine.setMuted(false);
  },
  setMuted: (muted) => {
    engine.setMuted(muted);
    savePrefs({ muted });
    set({ muted });
  },
  toggleMute: () => get().setMuted(!get().muted),
  setCrossfade: (ms) => {
    savePrefs({ crossfadeMs: ms });
    set({ crossfadeMs: ms });
  },
  setEqOn: (eqOn) => {
    engine.setEq(eqOn, get().bands);
    savePrefs({ eqOn });
    set({ eqOn });
  },
  setBand: (i, g) => {
    const bands = [...get().bands];
    bands[i] = clamp(g, -12, 12);
    engine.setEq(get().eqOn, bands);
    savePrefs({ bands });
    set({ bands });
  },
  applyPreset: (name) => {
    const p = EQ_PRESETS.find((x) => x.name === name);
    if (!p) return;
    engine.setEq(true, p.bands);
    savePrefs({ bands: p.bands, eqOn: true });
    set({ bands: p.bands, eqOn: true });
  },
  setGlue: (glue) => {
    engine.setGlue(glue);
    savePrefs({ glue });
    set({ glue });
  },
  setVis: (vis) => {
    savePrefs({ vis });
    set({ vis });
  },
  setQueueOpen: (queueOpen) => {
    savePrefs({ queueOpen });
    set({ queueOpen });
  },
  setLyricsOpen: (lyricsOpen) => {
    savePrefs({ lyricsOpen });
    set({ lyricsOpen });
  },
  toggleShuffle: () => {
    const s = get();
    const shuffled = !s.shuffled;
    if (!s.currentId) {
      set({ shuffled });
      return;
    }
    if (shuffled) {
      const rest = shuffleCopy(s.original.filter((id) => id !== s.currentId));
      set({ shuffled: true, queue: [s.currentId, ...rest], index: 0 });
    } else {
      const index = Math.max(0, s.original.indexOf(s.currentId));
      set({ shuffled: false, queue: s.original, index });
    }
  },
  cycleRepeat: () => {
    const order: RepeatMode[] = ["off", "all", "one"];
    const repeat = order[(order.indexOf(get().repeat) + 1) % order.length];
    set({ repeat });
  },
  addToQueue: (ids) => {
    set((s) => ({ queue: [...s.queue, ...ids], original: [...s.original, ...ids] }));
  },
  playNext: (ids) => {
    set((s) => {
      const i = s.index + 1;
      const queue = [...s.queue.slice(0, i), ...ids, ...s.queue.slice(i)];
      const original = [...s.original.slice(0, i), ...ids, ...s.original.slice(i)];
      return { queue, original };
    });
  },
  removeFromQueue: (i) => {
    set((s) => {
      const id = s.queue[i];
      const queue = s.queue.filter((_, idx) => idx !== i);
      const original = s.original.filter((x) => x !== id);
      let index = s.index;
      if (i < s.index) index--;
      return { queue, original, index };
    });
  },
  jumpTo: async (i) => {
    const s = get();
    const id = s.queue[i];
    if (!id) return;
    set({ index: i, currentId: id, isPlaying: true, currentTime: 0, duration: 0, peaks: [], crossfadeArmed: false });
    try {
      await loadCurrent(id, 0);
    } catch (e) {
      set({ isPlaying: false, error: e instanceof Error ? e.message : "Could not play" });
    }
  },
  clearQueue: () => {
    engine.pause();
    set({ queue: [], original: [], index: -1, currentId: undefined, isPlaying: false, currentTime: 0, duration: 0, peaks: [] });
  },
}));

export function bindEngine() {
  const prefs = usePlayer.getState();
  engine.setVolume(prefs.volume);
  engine.setMuted(prefs.muted);
  engine.setEq(prefs.eqOn, prefs.bands);
  engine.setGlue(prefs.glue);

  engine.onTime = (t, d) => {
    const s = usePlayer.getState();
    usePlayer.setState({ currentTime: t, duration: d || s.duration });
    const fade = s.crossfadeMs / 1000;
    if (
      s.isPlaying &&
      fade > 0.2 &&
      d > fade * 2 &&
      d - t <= fade &&
      !s.crossfadeArmed &&
      s.repeat !== "one"
    ) {
      usePlayer.setState({ crossfadeArmed: true });
      void usePlayer.getState().next({ fromCrossfade: true });
    }
  };
  engine.onEnded = () => {
    const s = usePlayer.getState();
    if (s.crossfadeArmed) {
      usePlayer.setState({ crossfadeArmed: false });
      return;
    }
    void s.next();
  };

  if (navigator.mediaSession) {
    navigator.mediaSession.setActionHandler("play", () => {
      if (!usePlayer.getState().isPlaying) usePlayer.getState().toggle();
    });
    navigator.mediaSession.setActionHandler("pause", () => {
      if (usePlayer.getState().isPlaying) usePlayer.getState().toggle();
    });
    navigator.mediaSession.setActionHandler("previoustrack", () => {
      void usePlayer.getState().prev();
    });
    navigator.mediaSession.setActionHandler("nexttrack", () => {
      void usePlayer.getState().next();
    });
    navigator.mediaSession.setActionHandler("seekto", (e) => {
      if (typeof e.seekTime === "number") usePlayer.getState().seek(e.seekTime);
    });
  }
}
