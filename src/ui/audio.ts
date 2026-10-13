/**
 * Music (generated tracks, crossfaded) and sound effects (synthesized with
 * WebAudio so they stay crisp, tiny and in a consistent retro voice).
 */
import { assetUrl } from './assets';

export type Track = 'title' | 'game' | 'auction';
export type Sfx =
  | 'blip' | 'select' | 'back' | 'coin' | 'error' | 'claim' | 'cursor' | 'buy' | 'outfit' | 'install'
  | 'lost' | 'wampus' | 'turn' | 'tick' | 'trade' | 'event' | 'good' | 'bad' | 'gavel' | 'fanfare';

interface Settings { music: number; sfx: number }

const SETTINGS_KEY = 'mule.audio';

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { music: 0.55, sfx: 0.7, ...JSON.parse(raw) };
  } catch { /* storage unavailable */ }
  return { music: 0.55, sfx: 0.7 };
}

class AudioManager {
  settings: Settings = loadSettings();
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private tracks = new Map<Track, HTMLAudioElement>();
  private current: Track | null = null;
  private fades = new Map<HTMLAudioElement, number>();

  /** Must be called from a user gesture before anything plays. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.settings.sfx;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    if (this.current) this.ensurePlaying(this.current);
  }

  save(): void {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch { /* ignore */ }
    if (this.master) this.master.gain.value = this.settings.sfx;
    const el = this.current && this.tracks.get(this.current);
    if (el && !this.fades.has(el)) el.volume = this.settings.music;
  }

  private el(track: Track): HTMLAudioElement {
    let el = this.tracks.get(track);
    if (!el) {
      el = new Audio(assetUrl(`music/${track}.mp3`));
      el.preload = 'auto';
      el.loop = false;
      el.volume = 0;
      // The tracks end with a fade-out, so restart them a little early.
      el.addEventListener('timeupdate', () => {
        if (this.current === track && el!.duration && el!.currentTime > el!.duration - 2.6) el!.currentTime = 0.05;
      });
      this.tracks.set(track, el);
    }
    return el;
  }

  private ensurePlaying(track: Track): void {
    const el = this.el(track);
    if (el.paused) void el.play().catch(() => { /* needs a gesture; unlock() retries */ });
  }

  music(track: Track | null): void {
    if (track === this.current) return;
    const prev = this.current && this.tracks.get(this.current);
    if (prev) this.fade(prev, 0, 900, true);
    this.current = track;
    if (!track) return;
    const el = this.el(track);
    el.currentTime = 0;
    this.ensurePlaying(track);
    this.fade(el, this.settings.music, 1200, false);
  }

  private fade(el: HTMLAudioElement, to: number, ms: number, pauseAtEnd: boolean): void {
    const prev = this.fades.get(el);
    if (prev) cancelAnimationFrame(prev);
    const from = el.volume;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      el.volume = Math.max(0, Math.min(1, from + (to - from) * t));
      if (t < 1) this.fades.set(el, requestAnimationFrame(step));
      else {
        this.fades.delete(el);
        if (pauseAtEnd) el.pause();
      }
    };
    this.fades.set(el, requestAnimationFrame(step));
  }

  // ---- synthesized effects ----

  private tone(freq: number, dur: number, opts: { type?: OscillatorType; vol?: number; slide?: number; delay?: number; attack?: number } = {}): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.settings.sfx <= 0) return;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = opts.type ?? 'square';
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * opts.slide), t0 + dur);
    const vol = (opts.vol ?? 0.18);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + (opts.attack ?? 0.008));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private noise(dur: number, vol = 0.15, delay = 0, freq = 1200): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.settings.sfx <= 0) return;
    const t0 = ctx.currentTime + delay;
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(this.master);
    src.start(t0);
  }

  sfx(name: Sfx): void {
    switch (name) {
      case 'blip': return this.tone(880, 0.06, { vol: 0.08 });
      case 'cursor': return this.tone(520, 0.05, { vol: 0.06, type: 'triangle' });
      case 'select': this.tone(660, 0.07, { vol: 0.12 }); return this.tone(990, 0.09, { vol: 0.12, delay: 0.06 });
      case 'back': return this.tone(440, 0.1, { vol: 0.1, slide: 0.6 });
      case 'error': this.tone(180, 0.14, { vol: 0.14, type: 'sawtooth' }); return this.tone(140, 0.18, { vol: 0.14, type: 'sawtooth', delay: 0.1 });
      case 'coin': this.tone(988, 0.07, { vol: 0.13 }); return this.tone(1319, 0.22, { vol: 0.13, delay: 0.07 });
      case 'claim': [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.12, { vol: 0.13, delay: i * 0.06 })); return;
      case 'buy': this.tone(392, 0.08, { vol: 0.12 }); return this.tone(587, 0.12, { vol: 0.12, delay: 0.07 });
      case 'outfit': [700, 900, 1200].forEach((f, i) => this.tone(f, 0.06, { vol: 0.1, type: 'triangle', delay: i * 0.045 })); this.noise(0.12, 0.06, 0.1, 3000); return;
      case 'install': this.noise(0.18, 0.18, 0, 400); this.tone(220, 0.16, { vol: 0.14, type: 'triangle', slide: 1.8, delay: 0.05 }); return this.tone(660, 0.18, { vol: 0.1, delay: 0.2 });
      case 'lost': return this.tone(600, 0.6, { vol: 0.12, type: 'sawtooth', slide: 0.25 });
      case 'wampus': [1200, 900, 1500, 1100, 1800].forEach((f, i) => this.tone(f, 0.08, { vol: 0.1, type: 'triangle', delay: i * 0.07 })); return;
      case 'turn': this.tone(523, 0.12, { vol: 0.12, type: 'triangle' }); return this.tone(784, 0.2, { vol: 0.12, type: 'triangle', delay: 0.1 });
      case 'tick': return this.tone(1400, 0.03, { vol: 0.05 });
      case 'trade': return this.tone(1046, 0.05, { vol: 0.07, type: 'triangle' });
      case 'event': this.tone(330, 0.25, { vol: 0.12, type: 'triangle' }); return this.tone(247, 0.4, { vol: 0.12, type: 'triangle', delay: 0.2 });
      case 'good': [523, 659, 784].forEach((f, i) => this.tone(f, 0.16, { vol: 0.11, type: 'triangle', delay: i * 0.08 })); return;
      case 'bad': [392, 330, 262].forEach((f, i) => this.tone(f, 0.18, { vol: 0.11, type: 'triangle', delay: i * 0.1 })); return;
      case 'gavel': this.noise(0.08, 0.3, 0, 900); return this.noise(0.08, 0.3, 0.14, 900);
      case 'fanfare': [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone(f, i === 5 ? 0.5 : 0.14, { vol: 0.12, delay: i * 0.12 })); return;
    }
  }
}

export const audio = new AudioManager();
