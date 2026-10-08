export type Health = {
  ok: boolean;
  app: string;
  version: string;
  device: string;
  chatterbox: boolean;
  macos_say: boolean;
  voices: number;
  shows: number;
};

export type Voice = {
  id: string;
  name: string;
  prompt: string;
  exaggeration: number;
  cfg_weight: number;
  temperature: number;
  source: string;
  duration?: number;
  has_prompt: boolean;
  peaks: number[];
};

export type Line = {
  index: number;
  text: string;
  speaker: string;
  voice: string;
  filename: string;
  exaggeration: number;
  cfg_weight: number;
  temperature: number;
  has_audio?: boolean;
  duration?: number | null;
  file?: string | null;
  peaks?: number[];
  qc?: string;
  retries?: number;
};

export type ShowSummary = {
  name: string;
  title: string;
  mode: string;
  engine: string;
  lines: number;
  rendered: number;
  has_mix: boolean;
  created_at?: string;
  duration?: number | null;
};

export type ShowDetail = Omit<ShowSummary, "lines"> & {
  cast: Record<string, string>;
  settings: {
    gap?: number;
    crossfade_ms?: number;
    to_48k?: boolean;
    lufs?: number;
    qc?: boolean;
    retries?: number;
  };
  story_text: string;
  lines: Line[];
  takes: unknown[];
  mix_file: string | null;
  mix_peaks: number[];
  voices: Voice[];
};

export type Job = {
  id: string;
  project: string;
  kind: "render" | "concat" | "effects" | "youtube";
  status: "queued" | "running" | "done" | "error" | "cancelled";
  progress: number;
  step: string;
  error?: string | null;
};
