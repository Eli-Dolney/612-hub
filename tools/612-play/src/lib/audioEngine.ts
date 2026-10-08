import { EQ_FREQS } from "./types";

type EndedFn = () => void;
type TimeFn = (t: number, d: number) => void;

class Engine {
  ctx: AudioContext | null = null;
  a = new Audio();
  b = new Audio();
  sourceA: MediaElementAudioSourceNode | null = null;
  sourceB: MediaElementAudioSourceNode | null = null;
  gainA: GainNode | null = null;
  gainB: GainNode | null = null;
  master: GainNode | null = null;
  filters: BiquadFilterNode[] = [];
  compressor: DynamicsCompressorNode | null = null;
  analyser: AnalyserNode | null = null;
  using: "a" | "b" = "a";
  urlA = "";
  urlB = "";
  volume = 0.9;
  muted = false;
  eqOn = true;
  bands = EQ_FREQS.map(() => 0);
  glue = true;
  onEnded: EndedFn | null = null;
  onTime: TimeFn | null = null;
  private raf = 0;

  constructor() {
    for (const el of [this.a, this.b]) {
      el.preload = "auto";
      el.crossOrigin = "anonymous";
      el.addEventListener("ended", () => {
        if (this.currentEl() === el) this.onEnded?.();
      });
    }
  }

  currentEl() {
    return this.using === "a" ? this.a : this.b;
  }

  otherEl() {
    return this.using === "a" ? this.b : this.a;
  }

  ensureGraph() {
    if (this.ctx) return this.ctx;
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.a.volume = 1;
    this.b.volume = 1;
    this.sourceA = ctx.createMediaElementSource(this.a);
    this.sourceB = ctx.createMediaElementSource(this.b);
    this.gainA = ctx.createGain();
    this.gainB = ctx.createGain();
    this.master = ctx.createGain();
    this.compressor = ctx.createDynamicsCompressor();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.72;
    this.filters = EQ_FREQS.map((freq, i) => {
      const f = ctx.createBiquadFilter();
      f.type = i === 0 ? "lowshelf" : i === EQ_FREQS.length - 1 ? "highshelf" : "peaking";
      f.frequency.value = freq;
      f.Q.value = 0.9;
      f.gain.value = 0;
      return f;
    });
    this.sourceA.connect(this.gainA);
    this.sourceB.connect(this.gainB);
    this.gainA.connect(this.master);
    this.gainB.connect(this.master);
    let node: AudioNode = this.master;
    for (const f of this.filters) {
      node.connect(f);
      node = f;
    }
    node.connect(this.compressor);
    this.compressor.connect(this.analyser);
    this.analyser.connect(ctx.destination);
    this.gainA.gain.value = 1;
    this.gainB.gain.value = 0;
    this.applyVolume();
    this.applyEq();
    this.applyGlue();
    return ctx;
  }

  async resume() {
    const ctx = this.ensureGraph();
    if (ctx.state === "suspended") await ctx.resume();
  }

  applyVolume() {
    if (!this.master || !this.ctx) return;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.03);
  }

  setVolume(v: number) {
    this.volume = v;
    this.applyVolume();
  }

  setMuted(m: boolean) {
    this.muted = m;
    this.applyVolume();
  }

  setEq(on: boolean, bands: number[]) {
    this.eqOn = on;
    this.bands = bands;
    this.applyEq();
  }

  applyEq() {
    this.filters.forEach((f, i) => {
      f.gain.value = this.eqOn ? this.bands[i] ?? 0 : 0;
    });
  }

  setGlue(on: boolean) {
    this.glue = on;
    this.applyGlue();
  }

  applyGlue() {
    const c = this.compressor;
    if (!c) return;
    if (this.glue) {
      c.threshold.value = -18;
      c.knee.value = 12;
      c.ratio.value = 2.4;
      c.attack.value = 0.012;
      c.release.value = 0.18;
    } else {
      c.threshold.value = 0;
      c.knee.value = 0;
      c.ratio.value = 1;
      c.attack.value = 0.003;
      c.release.value = 0.1;
    }
  }

  private setSrc(el: HTMLAudioElement, which: "a" | "b", url: string) {
    if (which === "a") {
      if (this.urlA) URL.revokeObjectURL(this.urlA);
      this.urlA = url;
    } else {
      if (this.urlB) URL.revokeObjectURL(this.urlB);
      this.urlB = url;
    }
    el.src = url;
  }

  private tick = () => {
    const el = this.currentEl();
    this.onTime?.(el.currentTime || 0, el.duration || 0);
    this.raf = requestAnimationFrame(this.tick);
  };

  startClock() {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.tick);
  }

  stopClock() {
    cancelAnimationFrame(this.raf);
  }

  async playFile(file: File, crossfadeMs: number) {
    await this.resume();
    const url = URL.createObjectURL(file);
    const next: "a" | "b" = this.using === "a" ? "b" : "a";
    const incoming = next === "a" ? this.a : this.b;
    const outgoing = this.currentEl();
    const gIn = next === "a" ? this.gainA! : this.gainB!;
    const gOut = this.using === "a" ? this.gainA! : this.gainB!;
    this.setSrc(incoming, next, url);
    incoming.currentTime = 0;
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const fade = Math.max(0, crossfadeMs) / 1000;
    const playing = !outgoing.paused && Boolean(outgoing.src);

    if (playing && fade > 0.05) {
      gIn.gain.cancelScheduledValues(now);
      gOut.gain.cancelScheduledValues(now);
      gIn.gain.setValueAtTime(0, now);
      gOut.gain.setValueAtTime(gOut.gain.value, now);
      gIn.gain.linearRampToValueAtTime(1, now + fade);
      gOut.gain.linearRampToValueAtTime(0, now + fade);
      await incoming.play();
      this.using = next;
      this.startClock();
      window.setTimeout(() => {
        if (this.currentEl() !== outgoing) {
          outgoing.pause();
          outgoing.removeAttribute("src");
          outgoing.load();
        }
      }, crossfadeMs + 40);
    } else {
      outgoing.pause();
      gOut.gain.cancelScheduledValues(now);
      gIn.gain.cancelScheduledValues(now);
      gOut.gain.setValueAtTime(0, now);
      gIn.gain.setValueAtTime(1, now);
      await incoming.play();
      this.using = next;
      this.startClock();
    }
  }

  pause() {
    this.a.pause();
    this.b.pause();
    this.stopClock();
  }

  async resumePlay() {
    await this.resume();
    await this.currentEl().play();
    this.startClock();
  }

  seek(t: number) {
    this.currentEl().currentTime = t;
    this.onTime?.(t, this.currentEl().duration || 0);
  }

  getTime() {
    return this.currentEl().currentTime || 0;
  }

  getDuration() {
    return this.currentEl().duration || 0;
  }
}

export const engine = new Engine();
