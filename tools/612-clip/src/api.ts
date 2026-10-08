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
  patchClip: (slug: string, id: number, body: Partial<Pick<Clip, "start" | "end" | "label" | "kept" | "kind">>) =>
    send(`/api/projects/${encodeURIComponent(slug)}/clips/${id}`, "PATCH", body).then((r) => json<Detail>(r)),
  removeClip: (slug: string, id: number) =>
    send(`/api/projects/${encodeURIComponent(slug)}/clips/${id}`, "DELETE").then((r) => json<Detail>(r)),
  exportClip: (slug: string, id: number) =>
    send(`/api/projects/${encodeURIComponent(slug)}/clips/${id}/export`, "POST").then((r) => json<Job>(r)),
  exportKeptClips: (slug: string) =>
    send(`/api/projects/${encodeURIComponent(slug)}/clips/export-kept`, "POST").then((r) => json<Job>(r)),
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
  open: (slug: string) => send(`/api/projects/${encodeURIComponent(slug)}/open`, "POST").then((r) => json(r)),
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
  const parts = s.match(/^(\d+):(\d{1,2}(?:\.\d+)?)$/);
  if (parts) {
    return Math.max(0, Math.min(duration, Number(parts[1]) * 60 + Number(parts[2])));
  }
  return null;
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
