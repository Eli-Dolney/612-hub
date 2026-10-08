export type Health = {
  ok: boolean;
  app: string;
  version: string;
  ffmpeg: boolean;
  videotoolbox: boolean;
  whisper: boolean;
  device: string;
  models: string[];
  formats: string[];
  grokedit: boolean;
  pulls: boolean;
  ytdlp?: boolean;
};

export type Settings = {
  model: string;
  remove_fillers: boolean;
  tighten_pauses: boolean;
  split_pause_s: number;
  padding_s: number;
  merge_gap_s: number;
  layout: "crop" | "blur";
  frame: "9:16" | "16:9" | "1:1" | "4:5";
  captions: boolean;
  caption_profile: "intro" | "tts" | "silent" | "custom" | string;
  caption_style: "hook" | "boxed" | "minimal" | string;
  caption_position: "blur" | "lower" | "center" | string;
  caption_font: string;
  caption_active: string;
  caption_rest: string;
  caption_size: "s" | "m" | "l" | string;
  caption_words: number;
  caption_karaoke: boolean;
  caption_uppercase: boolean;
  vad_filter?: string;
  credit: string;
  credit_corner: "bl" | "br";
  border: "none" | "solid" | "glow";
  border_color: string;
  logo: string;
  suggest_target_s?: number;
};

export type Word = {
  word: string;
  start: number;
  end: number;
};

export type Segment = {
  id: number;
  start: number;
  end: number;
  text: string;
  kept: boolean;
  words: Word[];
};

export type Range = {
  start: number;
  end: number;
  duration: number;
  text: string;
};

export type Clip = {
  id: number;
  start: number;
  end: number;
  duration: number;
  label: string;
  kept: boolean;
  kind?: "talk" | "broll" | "intro" | string;
  text?: string;
};

export type Bundle = {
  primary?: string;
  portrait?: string;
  landscape?: string;
  captions?: string;
  captions_ass?: string;
  youtube?: string;
  thumbnail?: string;
  frame?: string;
  meta?: {
    title: string;
    description: string;
    tags: string;
    hashtags: string;
    thumbnail_text: string;
  };
  ranges?: number;
  duration?: number;
  edit_url?: string;
  clip_files?: string[];
  from_clips?: boolean;
};

export type Summary = {
  slug: string;
  name: string;
  status: string;
  duration: number | null;
  width?: number;
  height?: number;
  codec?: string;
  has_audio?: boolean;
  peaks: number[];
  poster: string | null;
  created_at?: string;
  bundle?: Bundle | null;
  lines: number;
  kept_lines: number;
  ranges: number;
  kept_duration: number;
  window?: { start: number; end: number; duration?: number } | null;
  clip_count?: number;
  kept_clips?: number;
};

export type Detail = Summary & {
  settings: Settings;
  probe: Record<string, unknown>;
  transcript: { language?: string; model?: string; segments: Segment[] };
  ranges: Range[];
  clips?: Clip[];
  original_path?: string;
  source?: string;
  youtube?: Bundle["meta"];
};

export type PullFile = {
  path: string;
  name: string;
  size: number;
  duration?: number | null;
  mtime: string;
};

export type TrimMode = "keep" | "drop_head" | "drop_tail";

export type Step =
  | { id: string; op: "pull" }
  | { id: string; op: "trim"; mode: TrimMode; start: number; duration: number }
  | { id: string; op: "transcribe" }
  | { id: string; op: "suggest"; mode?: "hooks" | "silence" | "both"; target_s?: number }
  | { id: string; op: "export"; captions: boolean };

export type RecipeSource = { kind: "project"; slug: string } | { kind: "url"; url: string };

export type Recipe = {
  name?: string;
  source: RecipeSource;
  steps: Step[];
  settings?: Partial<Settings>;
};

export type Job = {
  id: string;
  project: string;
  kind: "probe" | "transcribe" | "export" | "order" | "clip" | "clips" | "suggest";
  status: "queued" | "running" | "done" | "error" | "cancelled";
  progress: number;
  step: string;
  error?: string | null;
  title?: string;
  step_index?: number;
  steps_total?: number;
  recipe?: Recipe;
};

export type InboxState = {
  enabled: boolean;
  recipe: "suggest" | "shorts" | "silent" | string;
  path: string;
  watching?: boolean;
  recipes?: string[];
  recent?: { path: string; name: string; slug?: string; recipe?: string; job_id?: string; error?: string; at?: number }[];
};
