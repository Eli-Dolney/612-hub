export type Platform = {
  id: string;
  name: string;
  max: string;
  kind: string;
};

export type FormatRow = {
  id: string;
  ext: string;
  note: string;
  width: number;
  height: number;
  fps: number;
  vcodec: string | null;
  acodec: string | null;
  abr: number;
  tbr: number;
  size: number;
  dynamic_range: string;
  protocol: string;
};

export type PlaylistEntry = {
  index: number;
  id: string;
  title: string;
  duration: number;
  uploader: string;
  thumbnail: string;
  url: string;
  selected: boolean;
};

export type Chapter = { title: string; start: number };

export type Probe = {
  url: string;
  id: string;
  title: string;
  uploader: string;
  duration: number;
  thumbnail: string;
  webpage_url: string;
  platform: Platform;
  is_playlist: boolean;
  playlist_count: number;
  entries: PlaylistEntry[];
  formats: FormatRow[];
  max_height: number;
  has_hdr: boolean;
  description: string;
  upload_date: string;
  view_count: number;
  chapters: Chapter[];
  suggested_mode: string;
  extractor: string;
};

export type JobStatus = "queued" | "downloading" | "postprocessing" | "done" | "error" | "cancelled";

export type Job = {
  id: string;
  url: string;
  source_url: string;
  mode: "audio" | "video";
  quality: string;
  audio_quality: string;
  container: string;
  status: JobStatus;
  percent: number;
  speed: number;
  eta: number;
  title: string;
  thumbnail: string;
  uploader: string;
  duration?: number;
  platform: Platform;
  filename: string;
  folder: string;
  error: string;
  quality_note: string;
  playlist_items?: string | null;
};

export type Settings = {
  video_folder: string;
  music_folder: string;
  mode: "audio" | "video";
  quality: string;
  audio_quality: string;
  container: string;
  playlist: boolean;
  subtitles: boolean;
  sponsorblock: "off" | "mark" | "remove";
  auto_open: boolean;
  cookies_browser: string;
  cookie_file: string;
};

export type MediaInfo = {
  path: string;
  name: string;
  folder: string;
  kind: "video" | "audio";
  container: string;
  vcodec: string;
  acodec: string;
  width: number;
  height: number;
  pix_fmt: string;
  duration: number;
  size: number;
  quicktime: boolean;
  direct: boolean;
  label: string;
  why: string;
  reasons: string[];
  subtitles: string[];
  transcript: string;
};

export type LibraryItem = {
  path: string;
  name: string;
  file: string;
  folder: string;
  ext: string;
  size: number;
  mtime: number;
  duration?: number;
  vcodec?: string;
  acodec?: string;
  width?: number;
  height?: number;
  quicktime?: boolean;
  kind?: string;
  label?: string;
};

export type Health = {
  ffmpeg: boolean;
  ffprobe: boolean;
  node: boolean;
  js_ready?: boolean;
  pot?: boolean;
  ytdlp: string;
  python: string;
  qualities: {
    video: string[];
    audio: string[];
    containers: string[];
    browsers: string[];
  };
};
