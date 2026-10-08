import type { Candidate, Detail, Health, Job, Summary } from "./types";

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

function send(path: string, method: string, body?: unknown) {
  return fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

export const api = {
  health: () => fetch("/api/health").then((r) => json<Health>(r)),
  projects: () => fetch("/api/projects").then((r) => json<{ projects: Summary[] }>(r)),
  project: (slug: string) => fetch(`/api/projects/${encodeURIComponent(slug)}`).then((r) => json<Detail>(r)),
  parse: (payload: { text: string; name: string; mode: string }) =>
    send("/api/parse", "POST", payload).then((r) => json<Detail>(r)),
  upload: async (file: File, name: string, mode: string) => {
    const body = new FormData();
    body.append("file", file);
    body.append("name", name);
    body.append("mode", mode);
    return fetch("/api/upload", { method: "POST", body }).then((r) => json<Detail>(r));
  },
  patch: (slug: string, payload: Record<string, unknown>) =>
    send(`/api/projects/${encodeURIComponent(slug)}`, "PATCH", payload).then((r) => json<Detail>(r)),
  remove: (slug: string) => send(`/api/projects/${encodeURIComponent(slug)}`, "DELETE").then((r) => json(r)),
  addShot: (slug: string, payload: { section_slug: string; query: string; category?: string }) =>
    send(`/api/projects/${encodeURIComponent(slug)}/shots`, "POST", payload).then((r) => json<Detail>(r)),
  scout: (slug: string, shotId?: string | null) =>
    send(`/api/projects/${encodeURIComponent(slug)}/scout`, "POST", { shot_id: shotId || null }).then((r) =>
      json<Job>(r),
    ),
  keep: (slug: string, uids: string[], kept: boolean) =>
    send(`/api/projects/${encodeURIComponent(slug)}/keep`, "POST", { uids, kept }).then((r) => json<Detail>(r)),
  keepBest: (slug: string, shotId: string, count = 3) =>
    send(`/api/projects/${encodeURIComponent(slug)}/keep-best`, "POST", { shot_id: shotId, count }).then((r) =>
      json<Detail>(r),
    ),
  pull: (slug: string, keepersOnly = true) =>
    send(`/api/projects/${encodeURIComponent(slug)}/pull`, "POST", { keepers_only: keepersOnly }).then((r) =>
      json<Job>(r),
    ),
  open: (slug: string) => send(`/api/projects/${encodeURIComponent(slug)}/open`, "POST").then((r) => json(r)),
  saveKeys: (payload: { pexels?: string; pixabay?: string; unsplash?: string }) =>
    send("/api/config", "POST", payload).then((r) => json(r)),
  queue: () => fetch("/api/queue").then((r) => json<{ jobs: Job[]; queue_len: number; busy: boolean }>(r)),
};

export function events(onEvent: (data: Record<string, unknown>) => void): () => void {
  const src = new EventSource("/api/events");
  src.onmessage = (ev) => {
    try {
      onEvent(JSON.parse(ev.data) as Record<string, unknown>);
    } catch {
      /* ignore */
    }
  };
  return () => src.close();
}

export function thumbUrl(url: string): string {
  if (!url) return "";
  if (url.startsWith("/")) return url;
  return `/api/thumb?url=${encodeURIComponent(url)}`;
}

export function mediaUrl(slug: string, rel: string): string {
  return `/api/media/${encodeURIComponent(slug)}/${rel.split("/").map(encodeURIComponent).join("/")}`;
}

export function previewFor(slug: string, row: Candidate): string {
  if (row.pulled && row.file_path && row.media_type !== "videos") return mediaUrl(slug, row.file_path);
  return thumbUrl(row.preview_url || row.download_url);
}

export function playFor(slug: string, row: Candidate): string {
  if (row.pulled && row.file_path && row.media_type === "videos") return mediaUrl(slug, row.file_path);
  return row.play_url || row.download_url;
}
