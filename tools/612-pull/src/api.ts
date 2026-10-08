import type { Health, Job, LibraryItem, MediaInfo, Probe, Settings } from "./types";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || JSON.stringify(body);
    } catch {
      detail = await res.text();
    }
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => fetch("/api/health").then((r) => json<Health>(r)),
  settings: () => fetch("/api/settings").then((r) => json<Settings>(r)),
  saveSettings: (patch: Partial<Settings>) =>
    fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then((r) => json<Settings>(r)),
  browseFolder: () =>
    fetch("/api/browse-folder", { method: "POST" }).then((r) => json<{ path: string }>(r)),
  browseFile: () =>
    fetch("/api/browse-file", { method: "POST" }).then((r) => json<{ path: string }>(r)),
  probe: (text: string, playlist: boolean) =>
    fetch("/api/probe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, playlist }),
    }).then((r) => json<{ items: Probe[]; errors: { url: string; error: string }[] }>(r)),
  queue: () => fetch("/api/queue").then((r) => json<{ jobs: Job[]; queue_len: number; busy: boolean }>(r)),
  enqueue: (payload: {
    items: {
      url: string;
      title?: string;
      thumbnail?: string;
      uploader?: string;
      duration?: number;
      playlist_items?: string;
    }[];
    overrides?: Partial<Settings>;
  }) =>
    fetch("/api/queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then((r) => json<{ jobs: Job[] }>(r)),
  cancel: (id: string) => fetch(`/api/queue/${id}/cancel`, { method: "POST" }).then((r) => json(r)),
  retry: (id: string) => fetch(`/api/queue/${id}/retry`, { method: "POST" }).then((r) => json<Job>(r)),
  remove: (id: string) => fetch(`/api/queue/${id}`, { method: "DELETE" }).then((r) => json(r)),
  open: (path: string, reveal = false) =>
    fetch("/api/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, reveal }),
    }).then((r) => json(r)),
  updateYtdlp: () => fetch("/api/update-ytdlp", { method: "POST" }).then((r) => json<{ version: string }>(r)),
  browseMedia: () =>
    fetch("/api/browse-media", { method: "POST" }).then((r) => json<{ path: string }>(r)),
  library: () => fetch("/api/media/library").then((r) => json<{ items: LibraryItem[] }>(r)),
  mediaProbe: (path: string) =>
    fetch("/api/media/probe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    }).then((r) => json<MediaInfo>(r)),
  mediaText: (path: string) =>
    fetch(`/api/media/text?path=${encodeURIComponent(path)}`).then((r) => json<{ text: string }>(r)),
  quicktime: (path: string) =>
    fetch("/api/media/quicktime", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    }).then((r) => json<{ path: string; size: number }>(r)),
  clip: (path: string, start: number, end: number, kind: "master" | "quicktime") =>
    fetch("/api/media/clip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, start, end, kind }),
    }).then((r) => json<{ path: string; size: number; copied: boolean; kind: string }>(r)),
  frame: (path: string, time: number, open_edit = true) =>
    fetch("/api/media/frame", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, time, open_edit }),
    }).then((r) => json<{ path: string; size: number; time: number; opened: boolean; edit_url: string }>(r)),
};

export function thumbSrc(path: string): string {
  return `/api/media/thumb?path=${encodeURIComponent(path)}`;
}

export function mediaSrc(path: string, direct: boolean, start = 0): string {
  const q = `path=${encodeURIComponent(path)}`;
  if (direct) return `/api/media/raw?${q}`;
  return `/api/media/stream?${q}&t=${start.toFixed(3)}`;
}

export function events(onEvent: (data: Record<string, unknown>) => void): () => void {
  const src = new EventSource("/api/events");
  src.onmessage = (ev) => {
    try {
      onEvent(JSON.parse(ev.data));
    } catch {
      /* ignore */
    }
  };
  return () => src.close();
}

export function fmtDur(seconds?: number | null): string {
  if (seconds == null || Number.isNaN(seconds)) return "—";
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function fmtTimecode(seconds: number): string {
  const total = Math.max(0, seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const tenths = Math.floor((total % 1) * 10);
  const core = h
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
  return tenths ? `${core}.${tenths}` : core;
}

export function parseTimecode(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  const parts = t.split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => Number.isNaN(n))) return null;
  if (nums.length === 2) return nums[0] * 60 + nums[1];
  return nums[0] * 3600 + nums[1] * 60 + nums[2];
}

export function fmtEta(seconds?: number | null): string {
  if (!seconds) return "—";
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export function fmtSpeed(bps?: number | null): string {
  if (!bps) return "—";
  return `${(bps / 1_000_000).toFixed(2)} MB/s`;
}

export function fmtSize(bytes?: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function fmtViews(n?: number | null): string {
  if (!n) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M views`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K views`;
  return `${n} views`;
}

export function shortPath(path: string): string {
  if (!path) return "—";
  const home = "/Users/";
  if (path.startsWith(home)) {
    const parts = path.split("/");
    if (parts.length > 3) return `~/${parts.slice(3).join("/")}`;
  }
  return path;
}
