export type ProviderStatus = {
  name: string;
  configured: boolean;
  needs_key: boolean;
  images: boolean;
  videos: boolean;
  zero_key: boolean;
};

export type Health = {
  ok: boolean;
  app: string;
  version: string;
  zero_key: string[];
  providers: ProviderStatus[];
  projects: number;
  keys: Record<string, boolean>;
};

export type Job = {
  id: string;
  project: string;
  kind: "scout" | "pull";
  status: "queued" | "running" | "done" | "error" | "cancelled";
  progress: number;
  step: string;
  error?: string | null;
};

export type Settings = {
  images: boolean;
  videos: boolean;
  per_provider: number;
  orientation: "any" | "widescreen" | "vertical" | "square";
  min_width: number;
  providers: string[];
  expand_queries: boolean;
  safe: boolean;
  lang: string;
};

export type Shot = {
  id: string;
  query: string;
  category: string;
  harvest: boolean;
  notes: string;
};

export type Section = {
  title: string;
  slug: string;
  order: number;
  time_start?: string | null;
  time_end?: string | null;
  narration: string;
  shots: Shot[];
};

export type Candidate = {
  uid: string;
  provider: string;
  media_type: "images" | "videos" | string;
  id: string;
  author: string;
  source_url: string;
  download_url: string;
  preview_url: string;
  play_url: string;
  license: string;
  width: number;
  height: number;
  duration: number;
  query: string;
  shot_id: string;
  section_slug: string;
  kept: boolean;
  pulled: boolean;
  file_path: string;
  error: string;
};

export type Summary = {
  id: string;
  name: string;
  slug: string;
  mode: string;
  status: string;
  created_at: string;
  updated_at: string;
  sections: number;
  shots: number;
  harvestable: number;
  scouted: number;
  kept: number;
  pulled: number;
  error_message: string;
};

export type Detail = {
  id: string;
  name: string;
  slug: string;
  mode: string;
  raw_input: string;
  sections: Section[];
  settings: Settings;
  status: string;
  created_at: string;
  updated_at: string;
  error_message: string;
  candidates: Candidate[];
  summary: Summary;
  credits: string;
  files: { rel: string; name: string; bytes: number }[];
  ai: { section: string; query: string }[];
  overlays: { section: string; query: string }[];
};
