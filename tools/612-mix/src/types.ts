export type Health = {
  ok: boolean;
  app: string;
  version: string;
  device: string;
  demucs: boolean;
  methods: Record<string, string>;
  formats: string[];
};

export type ProjectSummary = {
  name: string;
  filename: string;
  source: string | null;
  duration: number | null;
  sr: number | null;
  tempo: number | null;
  key: string | null;
  status: string;
  stems: string[];
  analysis: string[];
  patterns: string[];
  peaks: number[];
  created_at?: string;
  has_stems: boolean;
  has_analysis: boolean;
  has_strudel: boolean;
};

export type RemixPreset = {
  id: string;
  name: string;
  emoji: string;
};

export type ProjectDetail = ProjectSummary & {
  total_beats?: number;
  time_signature?: { numerator?: number; denominator?: number };
  drum_hits?: number;
  drum_distribution?: Record<string, number>;
  melody_notes?: number;
  bass_notes?: number;
  chord_labels?: string[];
  total_chords?: number;
  codes: Record<string, string>;
  presets: RemixPreset[];
  sounds: Record<string, string[]>;
};

export type Job = {
  id: string;
  project: string;
  kind: "split" | "analyze" | "strudel" | "pipeline";
  method?: string;
  status: "queued" | "running" | "done" | "error" | "cancelled";
  progress: number;
  step: string;
  error?: string | null;
};

export type RemixResult = {
  filename: string;
  code: string;
};
