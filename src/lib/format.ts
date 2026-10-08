export function formatTime(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const s = Math.floor(sec % 60);
  const m = Math.floor(sec / 60) % 60;
  const h = Math.floor(sec / 3600);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function formatCount(n: number) {
  if (n < 1000) return String(n);
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}

export function uid() {
  return crypto.randomUUID();
}

export function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

export function shuffleInPlace<T>(arr: T[]) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function shuffleCopy<T>(arr: T[]) {
  return shuffleInPlace([...arr]);
}

export function displayTitle(t: { title: string; fileName: string }) {
  return t.title || stemName(t.fileName);
}

export function stemName(fileName: string) {
  const i = fileName.lastIndexOf(".");
  return (i >= 0 ? fileName.slice(0, i) : fileName).replace(/[_]+/g, " ");
}

export function byTrackNo<T extends { discNo?: number; trackNo?: number; title: string }>(a: T, b: T) {
  const d = (a.discNo ?? 1) - (b.discNo ?? 1);
  if (d) return d;
  const n = (a.trackNo ?? 9999) - (b.trackNo ?? 9999);
  if (n) return n;
  return a.title.localeCompare(b.title);
}
