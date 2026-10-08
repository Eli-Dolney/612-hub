import type { Health, Job, ProjectDetail, ProjectSummary, RemixResult } from "./types";

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
  projects: () => fetch("/api/projects").then((r) => json<{ projects: ProjectSummary[] }>(r)),
  project: (name: string) => fetch(`/api/projects/${encodeURIComponent(name)}`).then((r) => json<ProjectDetail>(r)),
  upload: async (file: File, name = "") => {
    const body = new FormData();
    body.append("file", file);
    if (name) body.append("name", name);
    return fetch("/api/projects", { method: "POST", body }).then((r) => json<ProjectSummary>(r));
  },
  remove: (name: string) =>
    fetch(`/api/projects/${encodeURIComponent(name)}`, { method: "DELETE" }).then((r) => json(r)),
  split: (name: string) =>
    fetch(`/api/projects/${encodeURIComponent(name)}/split`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then((r) => json<Job>(r)),
  analyze: (name: string) =>
    fetch(`/api/projects/${encodeURIComponent(name)}/analyze`, { method: "POST" }).then((r) => json<Job>(r)),
  strudel: (name: string) =>
    fetch(`/api/projects/${encodeURIComponent(name)}/strudel`, { method: "POST" }).then((r) => json<Job>(r)),
  pipeline: (name: string) =>
    fetch(`/api/projects/${encodeURIComponent(name)}/pipeline`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then((r) => json<Job>(r)),
  remix: (name: string, payload: {
    preset_id: string;
    enabled_layers: string[];
    layer_sounds: Record<string, string>;
    intensity: number;
    seed: number | null;
  }) =>
    fetch(`/api/projects/${encodeURIComponent(name)}/remix`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then((r) => json<RemixResult>(r)),
  queue: () => fetch("/api/queue").then((r) => json<{ jobs: Job[]; queue_len: number; busy: boolean }>(r)),
  cancel: (id: string) => fetch(`/api/queue/${id}/cancel`, { method: "POST" }).then((r) => json(r)),
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

export function mediaUrl(project: string, rel: string): string {
  return `/api/media/${encodeURIComponent(project)}/${rel.split("/").map(encodeURIComponent).join("/")}`;
}

export function fmtDur(seconds: number | null | undefined): string {
  if (seconds == null || Number.isNaN(seconds)) return "—";
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export function fmtBpm(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n) || n <= 0) return "—";
  return `${n.toFixed(1)} BPM`;
}
