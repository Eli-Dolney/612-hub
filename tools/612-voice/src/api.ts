import type { Health, Job, ShowDetail, ShowSummary, Voice } from "./types";

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
  voices: () => fetch("/api/voices").then((r) => json<{ voices: Voice[] }>(r)),
  uploadVoice: async (file: File, name = "") => {
    const body = new FormData();
    body.append("file", file);
    if (name) body.append("name", name);
    return fetch("/api/voices", { method: "POST", body }).then((r) => json<Voice>(r));
  },
  youtubeVoice: (payload: { url: string; name?: string; start?: string; duration?: number }) =>
    fetch("/api/voices/youtube", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then((r) => json<Job>(r)),
  patchVoice: (id: string, payload: Partial<Voice>) =>
    fetch(`/api/voices/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then((r) => json<Voice>(r)),
  removeVoice: (id: string) =>
    fetch(`/api/voices/${encodeURIComponent(id)}`, { method: "DELETE" }).then((r) => json(r)),
  shows: () => fetch("/api/shows").then((r) => json<{ shows: ShowSummary[] }>(r)),
  show: (name: string) => fetch(`/api/shows/${encodeURIComponent(name)}`).then((r) => json<ShowDetail>(r)),
  createShow: (title: string) =>
    fetch("/api/shows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    }).then((r) => json<ShowSummary>(r)),
  patchShow: (name: string, payload: Record<string, unknown>) =>
    fetch(`/api/shows/${encodeURIComponent(name)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then((r) => json<ShowDetail>(r)),
  removeShow: (name: string) =>
    fetch(`/api/shows/${encodeURIComponent(name)}`, { method: "DELETE" }).then((r) => json(r)),
  split: (name: string, text: string, mode: string) =>
    fetch(`/api/shows/${encodeURIComponent(name)}/split`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, mode }),
    }).then((r) => json<ShowDetail>(r)),
  story: (name: string, text?: string) =>
    fetch(`/api/shows/${encodeURIComponent(name)}/story`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    }).then((r) => json<ShowDetail>(r)),
  emphasis: (name: string, indices: number[], preset: string) =>
    fetch(`/api/shows/${encodeURIComponent(name)}/emphasis`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ indices, preset }),
    }).then((r) => json<ShowDetail>(r)),
  render: (name: string, indices?: number[] | null) =>
    fetch(`/api/shows/${encodeURIComponent(name)}/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ indices: indices || null }),
    }).then((r) => json<Job>(r)),
  concat: (name: string) =>
    fetch(`/api/shows/${encodeURIComponent(name)}/concat`, { method: "POST" }).then((r) => json<Job>(r)),
  effects: (name: string, payload: Record<string, number>) =>
    fetch(`/api/shows/${encodeURIComponent(name)}/effects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then((r) => json<Job>(r)),
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

export function mediaUrl(show: string, rel: string): string {
  return `/api/media/${encodeURIComponent(show)}/${rel.split("/").map(encodeURIComponent).join("/")}`;
}

export function voiceUrl(id: string): string {
  return `/api/voice-media/${encodeURIComponent(id)}`;
}

export function fmtDur(seconds: number | null | undefined): string {
  if (seconds == null || Number.isNaN(seconds)) return "—";
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}
