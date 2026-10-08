import { getOne, putOne } from "./db";

const N = 720;

export async function loadPeaks(trackId: string) {
  const row = await getOne("peaks", trackId);
  return row?.peaks ?? null;
}

export async function computePeaks(trackId: string, file: File, ctx: AudioContext) {
  const existing = await loadPeaks(trackId);
  if (existing) return existing;
  const raw = await file.arrayBuffer();
  const audio = await ctx.decodeAudioData(raw.slice(0));
  const ch = audio.getChannelData(0);
  const peaks = new Array<number>(N);
  const block = Math.max(1, Math.floor(ch.length / N));
  for (let i = 0; i < N; i++) {
    let m = 0;
    const start = i * block;
    const end = Math.min(ch.length, start + block);
    for (let j = start; j < end; j += 8) {
      const v = Math.abs(ch[j]);
      if (v > m) m = v;
    }
    peaks[i] = m;
  }
  let max = 0.0001;
  for (const p of peaks) if (p > max) max = p;
  const norm = peaks.map((p) => p / max);
  await putOne("peaks", { id: trackId, peaks: norm });
  return norm;
}
