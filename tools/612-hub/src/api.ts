import type { Load, MediaItem, Prefs, Status } from "./types";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail: unknown = res.statusText;
    try {
      const body = await res.json();
      detail = (body as { detail?: unknown }).detail ?? body;
    } catch {
      detail = await res.text();
    }
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return res.json() as Promise<T>;
}

export const api = {
  status: () => fetch("/api/status").then((r) => json<Status>(r)),
  launch: (id: string, force = false) =>
    fetch(`/api/apps/${encodeURIComponent(id)}/launch?external=false${force ? "&force=true" : ""}`, { method: "POST" }).then((r) =>
      json<{ message: string; url?: string }>(r),
    ),
  stop: (id: string) =>
    fetch(`/api/apps/${encodeURIComponent(id)}/stop`, { method: "POST" }).then((r) => json<{ message: string }>(r)),
  open: (id: string) =>
    fetch(`/api/apps/${encodeURIComponent(id)}/open?external=false`, { method: "POST" }).then((r) => json<{ url: string; message?: string }>(r)),
  stopOthers: (keep?: string) =>
    fetch(`/api/stop-others${keep ? `?keep=${encodeURIComponent(keep)}` : ""}`, { method: "POST" }).then((r) =>
      json<{ message: string; stopped: string[] }>(r),
    ),
  reveal: (path: string, finder = false) =>
    fetch("/api/reveal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, finder }),
    }).then((r) => json(r)),
  openPath: (path: string) =>
    fetch("/api/open-path", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    }).then((r) => json(r)),
  media: () => fetch("/api/media").then((r) => json<{ items: MediaItem[] }>(r)),
  deleteMedia: (path: string) =>
    fetch("/api/media/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    }).then((r) => json(r)),
  setPrefs: (prefs: Partial<Prefs>) =>
    fetch("/api/prefs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(prefs),
    }).then((r) => json<Prefs>(r)),
};

export function fmtIdle(seconds: number | null | undefined): string {
  if (seconds == null) return "";
  if (seconds < 90) return "just opened";
  if (seconds < 3600) return `idle ${Math.floor(seconds / 60)}m`;
  return `idle ${Math.floor(seconds / 3600)}h`;
}

export function loadTone(load?: Load | null): string {
  return load?.level || "ok";
}

export function ago(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const s = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function fmtSize(bytes?: number | null): string {
  if (bytes == null || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function jobOpenPath(job: { filename?: string | null; folder?: string | null }): string | null {
  return job.filename || job.folder || null;
}
