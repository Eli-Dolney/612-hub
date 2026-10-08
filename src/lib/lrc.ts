export type LyricLine = { t: number; text: string };

export function parseLrc(src: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const raw of src.split(/\r?\n/)) {
    const times = [...raw.matchAll(/\[(\d{1,2}):(\d{2}(?:\.\d+)?)\]/g)];
    if (times.length === 0) continue;
    const text = raw.replace(/\[\d{1,2}:\d{2}(?:\.\d+)?\]/g, "").trim();
    if (!text) continue;
    for (const m of times) {
      lines.push({ t: Number(m[1]) * 60 + Number(m[2]), text });
    }
  }
  return lines.sort((a, b) => a.t - b.t);
}

export function activeLineIndex(lines: LyricLine[], t: number) {
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].t <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}
