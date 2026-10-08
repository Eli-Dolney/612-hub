export type Job = {
  id?: string;
  app: string;
  app_name?: string;
  kind?: string;
  status?: string;
  progress?: number;
  step?: string;
  project?: string;
  folder?: string | null;
  filename?: string | null;
  error?: string | null;
};

export type Recent = {
  app: string;
  name: string;
  path: string;
  kind: string;
  mtime: string;
  size?: number | null;
};

export type MediaItem = {
  id: string;
  app: string;
  app_name: string;
  title: string;
  path: string;
  folder: string;
  kind: string;
  mtime: string;
  size?: number | null;
};

export type Prefs = {
  auto_open: boolean;
};

export type AppCard = {
  id: string;
  name: string;
  short: string;
  folder: string;
  blurb: string;
  category: string;
  vs: string;
  color: string;
  ui_port: number;
  api_port: number | null;
  url: string;
  path: string;
  step: string;
  installed: boolean;
  configured: boolean;
  running: boolean;
  pid?: number | null;
  cpu?: number;
  rss_mb?: number;
  idle_s?: number | null;
  jobs: Job[];
  recent: Recent[];
};

export type Load = {
  live: number;
  recommend: number;
  max: number;
  cpu: number;
  rss_mb: number;
  level: "ok" | "busy" | "full";
  block_launch: boolean;
  hint: string;
  heaviest?: string | null;
};

export type Requirement = {
  id: string;
  name: string;
  available: boolean;
  version: string;
  need: string;
};

export type Status = {
  apps: AppCard[];
  jobs: Job[];
  recent: Recent[];
  running: number;
  installed: number;
  desktop: string;
  pipeline: string[];
  requirements: Requirement[];
  load?: Load;
  prefs?: Prefs;
};
