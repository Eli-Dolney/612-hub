import type { Clip, Detail, Health, InboxState, Job, PullFile, Recipe, Summary } from "./types";

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
  pulls: () => fetch("/api/pulls").then((r) => json<{ files: PullFile[] }>(r)),
  upload: async (file: File, name = "") => {
    const body = new FormData();
    body.append("file", file);
    if (name) body.append("name", name);
    return fetch("/api/projects", { method: "POST", body }).then((r) => json<Summary>(r));
  },
  importPath: (path: string, name = "") =>
    send("/api/import", "POST", { path, name }).then((r) => json<Summary>(r)),
  patch: (slug: string, payload: { name?: string; settings?: Record<string, unknown> }) =>
    send(`/api/projects/${encodeURIComponent(slug)}`, "PATCH", payload).then((r) => json<Detail>(r)),
  remove: (slug: string) => send(`/api/projects/${encodeURIComponent(slug)}`, "DELETE").then((r) => json(r)),
  keep: (slug: string, ids: number[], kept: boolean) =>
    send(`/api/projects/${encodeURIComponent(slug)}/keep`, "POST", { ids, kept }).then((r) => json<Detail>(r)),
  keepAll: (slug: string, kept: boolean) =>
    send(`/api/projects/${encodeURIComponent(slug)}/keep-all`, "POST", { kept }).then((r) => json<Detail>(r)),
  addClip: (slug: string, body: { start: number; end: number; label?: string; kept?: boolean; kind?: string }) =>
    send(`/api/projects/${encodeURIComponent(slug)}/clips`, "POST", body).then((r) => json<Detail>(r)),
  addClipRanges: (slug: string, ranges: ClipRange[]) =>
    send(`/api/projects/${encodeURIComponent(slug)}/clips/ranges`, "POST", { ranges }).then((r) => json<Detail>(r)),
  patchClip: (slug: string, id: number, body: Partial<Pick<Clip, "start" | "end" | "label" | "kept" | "kind">>) =>
    send(`/api/projects/${encodeURIComponent(slug)}/clips/${id}`, "PATCH", body).then((r) => json<Detail>(r)),
  removeClip: (slug: string, id: number) =>
    send(`/api/projects/${encodeURIComponent(slug)}/clips/${id}`, "DELETE").then((r) => json<Detail>(r)),
  exportClip: (slug: string, id: number) =>
    send(`/api/projects/${encodeURIComponent(slug)}/clips/${id}/export`, "POST").then((r) => json<Job>(r)),
  exportKeptClips: (slug: string, besideSource = false) =>
    send(`/api/projects/${encodeURIComponent(slug)}/clips/export-kept?beside_source=${besideSource}`, "POST").then((r) => json<Job>(r)),
  patchSegment: (slug: string, id: number, text: string) =>
    send(`/api/projects/${encodeURIComponent(slug)}/transcript/${id}`, "PATCH", { text }).then((r) => json<Detail>(r)),
  probe: (slug: string) => send(`/api/projects/${encodeURIComponent(slug)}/probe`, "POST").then((r) => json<Job>(r)),
  transcribe: (slug: string, scope: "all" | "kept" = "all") =>
    send(`/api/projects/${encodeURIComponent(slug)}/transcribe?scope=${scope}`, "POST").then((r) => json<Job>(r)),
  export: (slug: string) => send(`/api/projects/${encodeURIComponent(slug)}/export`, "POST").then((r) => json<Job>(r)),
  suggest: (slug: string, body: { mode: "hooks" | "silence" | "both"; target_s?: number; replace?: boolean }) =>
    send(`/api/projects/${encodeURIComponent(slug)}/suggest`, "POST", body).then((r) => json<Job>(r)),
  captions: (slug: string) =>
    send(`/api/projects/${encodeURIComponent(slug)}/captions`, "POST").then((r) => json<Detail & { captions?: { srt?: string; ass?: string } }>(r)),
  open: (slug: string, besideSource = false) =>
    send(`/api/projects/${encodeURIComponent(slug)}/open?beside_source=${besideSource}`, "POST").then((r) => json(r)),
  grokedit: (slug: string) => send(`/api/projects/${encodeURIComponent(slug)}/grokedit`, "POST").then((r) => json(r)),
  order: (recipe: Recipe) => send("/api/orders", "POST", recipe).then((r) => json<Job>(r)),
  inbox: () => fetch("/api/inbox").then((r) => json<InboxState>(r)),
  patchInbox: (body: Partial<Pick<InboxState, "enabled" | "recipe" | "path">>) =>
    send("/api/inbox", "PATCH", body).then((r) => json<InboxState>(r)),
  openInbox: () => send("/api/inbox/open", "POST").then((r) => json<{ ok: boolean; path: string }>(r)),
  uploadLogo: async (slug: string, file: File) => {
    const body = new FormData();
    body.append("file", file);
    return fetch(`/api/projects/${encodeURIComponent(slug)}/logo`, { method: "POST", body }).then((r) => json<Detail>(r));
  },
  clearLogo: (slug: string) =>
    send(`/api/projects/${encodeURIComponent(slug)}/logo`, "DELETE").then((r) => json<Detail>(r)),
  queue: () => fetch("/api/queue").then((r) => json<{ jobs: Job[]; queue_len: number; busy: boolean }>(r)),
  cancel: (id: string) => send(`/api/queue/${encodeURIComponent(id)}/cancel`, "POST").then((r) => json<Job>(r)),
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

export function mediaUrl(slug: string, rel: string): string {
  return `/api/media/${encodeURIComponent(slug)}/${rel.split("/").map(encodeURIComponent).join("/")}`;
}

export function parseTime(raw: string, duration = Infinity): number | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) {
    return Math.max(0, Math.min(duration, Number(s)));
  }
  const units = s.match(/^(\d+(?:\.\d+)?)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes)$/i);
  if (units) {
    const seconds = Number(units[1]) * (units[2].toLowerCase().startsWith("m") ? 60 : 1);
    return Math.min(duration, seconds);
  }
  const parts = s.match(/^(?:(\d+):)?(\d+):(\d{1,2}(?:\.\d+)?)$/);
  if (parts && Number(parts[3]) < 60 && (!parts[1] || Number(parts[2]) < 60)) {
    const seconds = Number(parts[1] || 0) * 3600 + Number(parts[2]) * 60 + Number(parts[3]);
    return Math.min(duration, seconds);
  }
  return null;
}

export type ClipRange = { start: number; end: number };

export function parseClipRanges(raw: string, duration: number): ClipRange[] {
  const entries = raw.split(/[\n,;]+/).map((entry) => entry.trim()).filter(Boolean);
  if (!entries.length) throw new Error("Enter at least one time range.");
  if (entries.length > 100) throw new Error("Add up to 100 ranges at a time.");
  return entries.map((entry, index) => {
    const match = entry.match(/^(.+?)\s*(?:[-–—]|\s+to\s+)\s*(.+)$/i);
    const start = match && parseTime(match[1]);
    const end = match && parseTime(match[2]);
    const label = `Range ${index + 1}`;
    if (start == null || end == null || !Number.isFinite(start) || !Number.isFinite(end)) {
      throw new Error(`${label} needs a start and end time, like 1:00-1:20.`);
    }
    if (start >= end) throw new Error(`${label} must end after it starts.`);
    if (end > duration) throw new Error(`${label} ends past the video (${fmtDur(duration)}).`);
    const from = Math.round(start * 1000);
    const to = Math.round(end * 1000);
    if (to - from < 50) throw new Error(`${label} must be at least 0.05 seconds.`);
    return { start: from / 1000, end: Math.min(duration, to / 1000) };
  });
}

export function fmtDur(seconds: number | null | undefined): string {
  if (seconds == null || Number.isNaN(seconds)) return "—";
  const total = Math.max(0, seconds);
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  const cs = Math.floor((total - Math.floor(total)) * 10);
  if (m > 0) return `${m}:${s.toString().padStart(2, "0")}`;
  return `0:${s.toString().padStart(2, "0")}.${cs}`;
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
