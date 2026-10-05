import { SoundManager } from '@/features/arcade/lib/sound-manager';
import {
  SampleEngine,
  ORCHESTRAL_CONFIG,
  AMBIENT_CONFIG,
  type SampleTrackConfig,
  type InstrumentRole,
} from '../_tetris-sample-engine';
import {
  TRACKS,
  type NoteRole,
  type TrackData,
  type TrackId,
  type TrackNote,
} from './_tetris-music-score';
import { buildTrackData } from './_tetris-music-track-builders';

const LS_TRACK_KEY = 'holocron_tetris_default_track';
const LS_MUSIC_MUTED_KEY = 'holocron_tetris_music_muted';
const CROSSFADE_MS = 500;

type WebkitWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

export class TetrisMusicManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private preMasterGain: GainNode | null = null;
  private sidechainGain: GainNode | null = null;
  private masterSubHighpass: BiquadFilterNode | null = null;
  private masterLowShelf: BiquadFilterNode | null = null;
  private masterLowMidCut: BiquadFilterNode | null = null;
  private masterPresence: BiquadFilterNode | null = null;
  private masterHighShelf: BiquadFilterNode | null = null;
  private masterAirShelf: BiquadFilterNode | null = null;
  private masterCompressor: DynamicsCompressorNode | null = null;
  private masterLimiter: DynamicsCompressorNode | null = null;
  private reverbInput: GainNode | null = null;
  private reverbConvolver: ConvolverNode | null = null;
  private reverbReturn: GainNode | null = null;
  private delayInput: GainNode | null = null;
  private delayLeft: DelayNode | null = null;
  private delayRight: DelayNode | null = null;
  private delayFeedbackLeft: GainNode | null = null;
  private delayFeedbackRight: GainNode | null = null;
  private delayFilterLeft: BiquadFilterNode | null = null;
  private delayFilterRight: BiquadFilterNode | null = null;
  private delayPanLeft: StereoPannerNode | null = null;
  private delayPanRight: StereoPannerNode | null = null;
  private delayReturn: GainNode | null = null;
  private delayLfo: OscillatorNode | null = null;
  private delayLfoDepthLeft: GainNode | null = null;
  private delayLfoDepthRight: GainNode | null = null;
  private whiteNoiseBuffer: AudioBuffer | null = null;
  private pinkNoiseBuffer: AudioBuffer | null = null;
  private currentTrack: TrackId = 'classic';
  private _musicMuted = false;
  private isPlaying = false;
  private schedulerTimer: number | null = null;
  private schedulerWorker: Worker | null = null;
  private schedulerWorkerUrl: string | null = null;
  private activeNodes: {
    osc: OscillatorNode | AudioBufferSourceNode;
    endTime: number;
    priority: number;
  }[] = [];
  private loopStartTime = 0;
  private scheduledUntil = 0;
  private tempoMultiplier = 1.0;
  private schedulerLoopIndex = 0;
  private schedulerNoteIndex = 0;
  private schedulerNeedsSync = true;
  private lastSidechainKickTime = Number.NEGATIVE_INFINITY;
  private pausedTrackTime = 0;
  private hasPausedTrackTime = false;
  private cachedTrackId: TrackId | null = null;
  private cachedTrackData: TrackData | null = null;
  private trackLoudnessGains: Partial<Record<TrackId, number>> = {};
  // Each play session gets its own trackGain so crossfade can overlap independently
  private trackGain: GainNode | null = null;
  // SoundFont sample engine for orchestral & ambient tracks
  private sampleEngine = new SampleEngine();
  private samplePreloadPromise: Promise<boolean> | null = null;
  private samplePreloadStartedAt = 0;
  private sampleLogTimestamps: Partial<Record<string, number>> = {};
  private sampleFallbackCount = 0;
  private sampleScheduledCount = 0;
  private sampleNoScheduleTicks = 0;
  private sampleGateActive = false;

  constructor() {
    try {
      if (typeof window !== 'undefined') {
        const stored = localStorage.getItem(LS_TRACK_KEY);
        if (stored && TRACKS.some((t) => t.id === stored))
          this.currentTrack = stored as TrackId;
        this._musicMuted = localStorage.getItem(LS_MUSIC_MUTED_KEY) === 'true';
      }
    } catch {
      // Ignore localStorage read failures (privacy mode, restricted storage, etc.)
    }
    // Tetris owns a richer music graph, but tixy master mute remains the
    // single source of truth across routes and browser tabs.
    SoundManager.subscribe(() => this.updateVolume());
  }

  private isSampleTrack(trackId: TrackId = this.currentTrack): boolean {
    return trackId === 'orchestral' || trackId === 'ambient';
  }

  private logSample(
    level: 'info' | 'warn' | 'error',
    key: string,
    message: string,
    details?: Record<string, unknown>,
    throttleMs = 1000,
  ) {
    if (!this.isSampleTrack()) return;
    const now = Date.now();
    if (throttleMs > 0) {
      const last = this.sampleLogTimestamps[key] ?? 0;
      if (now - last < throttleMs) return;
      this.sampleLogTimestamps[key] = now;
    }
    const prefix = `[TetrisMusic:${this.currentTrack}] ${message}`;
    if (level === 'error') {
      if (details) console.error(prefix, details);
      else console.error(prefix);
      return;
    }
    if (level === 'warn') {
      if (details) console.warn(prefix, details);
      else console.warn(prefix);
      return;
    }
    if (details) console.info(prefix, details);
    else console.info(prefix);
  }

  private getAudioContextConstructor(): typeof AudioContext | null {
    if (typeof window === 'undefined') return null;
    return window.AudioContext ?? (window as WebkitWindow).webkitAudioContext ?? null;
  }

  private resumeContext() {
    if (!this.ctx || this.ctx.state !== 'suspended') return;
    void this.ctx.resume().catch(() => {
      // Mobile browsers may reject resume outside a direct user gesture.
    });
  }

  private ensureContext(): boolean {
    if (this.ctx && this.ctx.state !== 'closed') return true;
    try {
      const AudioContextConstructor = this.getAudioContextConstructor();
      if (!AudioContextConstructor) return false;
      this.ctx = new AudioContextConstructor();
      this.preMasterGain = this.ctx.createGain();
      this.masterSubHighpass = this.ctx.createBiquadFilter();
      this.masterSubHighpass.type = 'highpass';
      this.masterSubHighpass.frequency.value = 34;
      this.masterSubHighpass.Q.value = 0.74;

      this.masterLowShelf = this.ctx.createBiquadFilter();
      this.masterLowShelf.type = 'lowshelf';
      this.masterLowShelf.frequency.value = 150;
      this.masterLowShelf.gain.value = 1.9;

      this.masterLowMidCut = this.ctx.createBiquadFilter();
      this.masterLowMidCut.type = 'peaking';
      this.masterLowMidCut.frequency.value = 320;
      this.masterLowMidCut.Q.value = 0.95;
      this.masterLowMidCut.gain.value = -1.9;

      this.masterPresence = this.ctx.createBiquadFilter();
      this.masterPresence.type = 'peaking';
      this.masterPresence.frequency.value = 2350;
      this.masterPresence.Q.value = 1.0;
      this.masterPresence.gain.value = 1.2;

      this.masterHighShelf = this.ctx.createBiquadFilter();
      this.masterHighShelf.type = 'highshelf';
      this.masterHighShelf.frequency.value = 7200;
      this.masterHighShelf.gain.value = -1.6;

      this.masterAirShelf = this.ctx.createBiquadFilter();
      this.masterAirShelf.type = 'highshelf';
      this.masterAirShelf.frequency.value = 11000;
      this.masterAirShelf.gain.value = 0.8;

      this.masterCompressor = this.ctx.createDynamicsCompressor();
      this.masterCompressor.threshold.value = -19;
      this.masterCompressor.knee.value = 24;
      this.masterCompressor.ratio.value = 3.2;
      this.masterCompressor.attack.value = 0.003;
      this.masterCompressor.release.value = 0.16;

      this.masterLimiter = this.ctx.createDynamicsCompressor();
      this.masterLimiter.threshold.value = -3.4;
      this.masterLimiter.knee.value = 0.6;
      this.masterLimiter.ratio.value = 18;
      this.masterLimiter.attack.value = 0.001;
      this.masterLimiter.release.value = 0.08;

      this.masterGain = this.ctx.createGain();
      this.sidechainGain = this.ctx.createGain();
      this.sidechainGain.gain.value = 1;

      this.preMasterGain.connect(this.sidechainGain);
      this.sidechainGain.connect(this.masterSubHighpass);
      this.masterSubHighpass.connect(this.masterLowShelf);
      this.masterLowShelf.connect(this.masterLowMidCut);
      this.masterLowMidCut.connect(this.masterPresence);
      this.masterPresence.connect(this.masterHighShelf);
      this.masterHighShelf.connect(this.masterAirShelf);
      this.masterAirShelf.connect(this.masterCompressor);
      this.masterCompressor.connect(this.masterLimiter);
      this.masterLimiter.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);

      // Shared FX buses so each track can send different wet amounts.
      this.reverbInput = this.ctx.createGain();
      this.reverbConvolver = this.ctx.createConvolver();
      this.reverbConvolver.buffer = this.createImpulseResponse(2.8, 2.5);
      this.reverbReturn = this.ctx.createGain();
      this.reverbReturn.gain.value = 0.52;
      this.reverbInput.connect(this.reverbConvolver);
      this.reverbConvolver.connect(this.reverbReturn);
      this.reverbReturn.connect(this.preMasterGain);

      this.delayInput = this.ctx.createGain();
      this.delayLeft = this.ctx.createDelay(1.2);
      this.delayRight = this.ctx.createDelay(1.2);
      this.delayLeft.delayTime.value = 0.23;
      this.delayRight.delayTime.value = 0.31;
      this.delayFilterLeft = this.ctx.createBiquadFilter();
      this.delayFilterLeft.type = 'lowpass';
      this.delayFilterLeft.frequency.value = 4300;
      this.delayFilterLeft.Q.value = 0.5;
      this.delayFilterRight = this.ctx.createBiquadFilter();
      this.delayFilterRight.type = 'lowpass';
      this.delayFilterRight.frequency.value = 3800;
      this.delayFilterRight.Q.value = 0.5;
      this.delayFeedbackLeft = this.ctx.createGain();
      this.delayFeedbackRight = this.ctx.createGain();
      this.delayFeedbackLeft.gain.value = 0.31;
      this.delayFeedbackRight.gain.value = 0.31;
      this.delayPanLeft = this.ctx.createStereoPanner();
      this.delayPanRight = this.ctx.createStereoPanner();
      this.delayPanLeft.pan.value = -0.78;
      this.delayPanRight.pan.value = 0.78;
      this.delayReturn = this.ctx.createGain();
      this.delayReturn.gain.value = 0.46;

      this.delayInput.connect(this.delayLeft);
      this.delayInput.connect(this.delayRight);
      this.delayLeft.connect(this.delayFilterLeft);
      this.delayRight.connect(this.delayFilterRight);

      // Ping-pong feedback across channels for a wider stereo field.
      this.delayFilterLeft.connect(this.delayFeedbackLeft);
      this.delayFeedbackLeft.connect(this.delayRight);
      this.delayFilterRight.connect(this.delayFeedbackRight);
      this.delayFeedbackRight.connect(this.delayLeft);

      this.delayFilterLeft.connect(this.delayPanLeft);
      this.delayFilterRight.connect(this.delayPanRight);
      this.delayPanLeft.connect(this.delayReturn);
      this.delayPanRight.connect(this.delayReturn);
      this.delayReturn.connect(this.preMasterGain);

      this.delayLfo = this.ctx.createOscillator();
      this.delayLfo.type = 'sine';
      this.delayLfo.frequency.value = 0.17;
      this.delayLfoDepthLeft = this.ctx.createGain();
      this.delayLfoDepthRight = this.ctx.createGain();
      this.delayLfoDepthLeft.gain.value = 0.004;
      this.delayLfoDepthRight.gain.value = -0.004;
      this.delayLfo.connect(this.delayLfoDepthLeft);
      this.delayLfo.connect(this.delayLfoDepthRight);
      this.delayLfoDepthLeft.connect(this.delayLeft.delayTime);
      this.delayLfoDepthRight.connect(this.delayRight.delayTime);
      this.delayLfo.start();

      this.whiteNoiseBuffer = this.createNoiseBuffer('white', 1.3);
      this.pinkNoiseBuffer = this.createNoiseBuffer('pink', 1.3);

      this.updateVolume();
      this.resumeContext();
      return true;
    } catch {
      return false;
    }
  }

  unlock() {
    if (!this.ensureContext() || !this.ctx) return;
    this.resumeContext();
    try {
      const source = this.ctx.createBufferSource();
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      source.buffer = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
      source.connect(gain);
      gain.connect(this.ctx.destination);
      source.start(0);
      source.stop(this.ctx.currentTime + 0.01);
    } catch {
      // Audio unlock is best-effort; playback can still attempt to start later.
    }
  }

  private createImpulseResponse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        const progress = i / length;
        const env = Math.pow(1 - progress, decay);
        const width = ch === 0 ? 1 : 0.94;
        data[i] = (Math.random() * 2 - 1) * env * width;
      }
    }
    return impulse;
  }

  private createNoiseBuffer(
    kind: 'white' | 'pink',
    seconds: number,
  ): AudioBuffer {
    const ctx = this.ctx!;
    const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noise.getChannelData(0);

    if (kind === 'white') {
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      return noise;
    }

    // Lightweight pink-noise approximation.
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    let b4 = 0;
    let b5 = 0;
    let b6 = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
      b6 = white * 0.115926;
      data[i] = pink * 0.11;
    }
    return noise;
  }

  private getTrackFxProfile(trackId: TrackId): {
    dry: number;
    reverb: number;
    delay: number;
    pan: number;
    width: number;
  } {
    switch (trackId) {
      case 'classic':
        return { dry: 1, reverb: 0.08, delay: 0.05, pan: 0.1, width: 0.22 };
      case 'synthwave':
        return { dry: 1, reverb: 0.14, delay: 0.22, pan: 0.28, width: 0.72 };
      case 'chiptune':
        return { dry: 1, reverb: 0.03, delay: 0.09, pan: 0.14, width: 0.36 };
      case 'ambient':
        return { dry: 1.18, reverb: 0.56, delay: 0.12, pan: 0.1, width: 0.78 };
      case 'orchestral':
        return { dry: 1.2, reverb: 0.54, delay: 0.1, pan: 0.12, width: 0.8 };
      case 'edm-bass':
        return { dry: 1, reverb: 0.18, delay: 0.24, pan: 0.32, width: 0.84 };
      default:
        return { dry: 1, reverb: 0, delay: 0, pan: 0, width: 0 };
    }
  }

  private getSidechainProfile(trackId: TrackId): {
    depth: number;
    attack: number;
    release: number;
    minInterval: number;
  } {
    switch (trackId) {
      case 'edm-bass':
        return { depth: 0.34, attack: 0.008, release: 0.14, minInterval: 0.08 };
      case 'synthwave':
        return { depth: 0.22, attack: 0.012, release: 0.18, minInterval: 0.1 };
      default:
        return { depth: 0, attack: 0.012, release: 0.18, minInterval: 0.1 };
    }
  }

  private classifyNoteRole(note: TrackNote): NoteRole {
    const dur = note.dur / this.tempoMultiplier;
    const hasSweep = note.freqEnd !== undefined;
    const downSweep = hasSweep && note.freqEnd! < note.freq * 0.78;
    const highShort = note.freq >= 1800 && dur <= 0.12;
    const lowShort = note.freq <= 150 && dur <= 0.5;

    if (lowShort && downSweep && note.vol >= 0.07) return 'kick';
    if (note.freq <= 220 && dur >= 0.08 && note.vol >= 0.04) return 'bass';
    if (highShort && note.vol <= 0.12) return 'fx';
    if (dur <= 0.12 && (hasSweep || note.wave === 'square')) return 'perc';
    if (
      note.freq >= 220 &&
      note.freq <= 1400 &&
      dur >= 0.08 &&
      note.vol >= 0.11
    )
      return 'melody';
    return 'harmony';
  }

  private getNotePriorityFromRole(role: NoteRole): number {
    switch (role) {
      case 'kick':
        return 130;
      case 'bass':
        return 115;
      case 'melody':
        return 105;
      case 'harmony':
        return 78;
      case 'perc':
        return 58;
      default:
        return 26;
    }
  }

  private getMaxVoices(trackId: TrackId): number {
    switch (trackId) {
      case 'edm-bass':
      case 'synthwave':
        return 100;
      case 'ambient':
      case 'orchestral':
        return 90;
      default:
        return 76;
    }
  }

  private triggerSidechain(time: number, note: TrackNote) {
    if (!this.ctx || !this.sidechainGain) return;
    if (this.classifyNoteRole(note) !== 'kick') return;
    const profile = this.getSidechainProfile(this.currentTrack);
    if (profile.depth <= 0) return;
    if (time - this.lastSidechainKickTime < profile.minInterval) return;
    this.lastSidechainKickTime = time;

    const g = this.sidechainGain.gain;
    const start = Math.max(time, this.ctx.currentTime);
    const duck = Math.max(0.25, 1 - profile.depth);
    const attackEnd = start + profile.attack;
    g.cancelScheduledValues(start);
    g.setValueAtTime(Math.max(0.0001, g.value), start);
    g.linearRampToValueAtTime(duck, attackEnd);
    g.setTargetAtTime(1, attackEnd, profile.release);
  }

  private addNoiseBurst(
    time: number,
    dur: number,
    pan: number,
    opts: {
      kind: 'white' | 'pink';
      filter: BiquadFilterType;
      cutoff: number;
      cutoffEnd?: number;
      q: number;
      vol: number;
    },
  ) {
    if (!this.ctx || !this.trackGain) return;
    const buffer =
      opts.kind === 'pink' ? this.pinkNoiseBuffer : this.whiteNoiseBuffer;
    if (!buffer) return;

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = opts.filter;
    filter.Q.value = opts.q;
    filter.frequency.setValueAtTime(Math.max(20, opts.cutoff), time);
    if (opts.cutoffEnd && opts.cutoffEnd > 20) {
      const end = time + Math.max(0.01, dur);
      filter.frequency.exponentialRampToValueAtTime(opts.cutoffEnd, end);
    }

    const gain = this.ctx.createGain();
    const panner = this.ctx.createStereoPanner();
    panner.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), time);
    const peak = Math.max(0.00012, opts.vol);
    const attack = Math.min(0.008, Math.max(0.0015, dur * 0.15));
    const end = time + Math.max(0.015, dur);
    const releaseStart = Math.max(time + attack + 0.001, end - dur * 0.55);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(peak, time + attack);
    gain.gain.setValueAtTime(peak * 0.75, releaseStart);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(panner);
    panner.connect(this.trackGain);
    source.start(time);
    source.stop(end + 0.02);
  }

  private playDrumNoiseLayer(
    time: number,
    note: TrackNote,
    role: NoteRole,
    pan: number,
  ) {
    if (this.currentTrack === 'ambient' || this.currentTrack === 'orchestral')
      return;
    if (role !== 'kick' && role !== 'perc' && role !== 'fx') return;

    const dur = Math.max(0.01, note.dur / this.tempoMultiplier);
    const baseVol = Math.max(0.0001, note.vol);

    if (role === 'kick') {
      this.addNoiseBurst(time, Math.min(0.07, dur * 0.32), pan * 0.3, {
        kind: 'pink',
        filter: 'lowpass',
        cutoff: 460,
        cutoffEnd: 180,
        q: 0.8,
        vol: baseVol * 0.08,
      });
      return;
    }

    const hatLike = note.freq >= 2000 || dur <= 0.08;
    if (hatLike) {
      this.addNoiseBurst(time, Math.min(0.05, dur * 0.5), pan * 0.85, {
        kind: 'white',
        filter: 'highpass',
        cutoff: 5200,
        cutoffEnd: 7000,
        q: 0.7,
        vol: baseVol * 0.13,
      });
      return;
    }

    this.addNoiseBurst(time, Math.min(0.11, dur * 0.68), pan * 0.6, {
      kind: 'pink',
      filter: 'bandpass',
      cutoff: 1750,
      cutoffEnd: 1200,
      q: 1.1,
      vol: baseVol * 0.1,
    });
    this.addNoiseBurst(time + 0.0015, Math.min(0.06, dur * 0.42), pan * 0.75, {
      kind: 'white',
      filter: 'highpass',
      cutoff: 3400,
      cutoffEnd: 5100,
      q: 0.72,
      vol: baseVol * 0.07,
    });
  }

  private getTrackLoudnessTarget(trackId: TrackId): number {
    switch (trackId) {
      case 'ambient':
        return 0.332;
      case 'orchestral':
        return 0.344;
      case 'chiptune':
        return 0.232;
      case 'classic':
        return 0.24;
      case 'synthwave':
        return 0.25;
      case 'edm-bass':
        return 0.264;
      default:
        return 0.238;
    }
  }

  private estimateTrackLoudnessGain(trackId: TrackId, data: TrackData): number {
    if (!data.notes.length || data.duration <= 0) return 1;

    let weightedEnergy = 0;
    for (const note of data.notes) {
      const role = this.classifyNoteRole(note);
      const roleWeight =
        role === 'melody'
          ? 1.18
          : role === 'bass'
            ? 1.12
            : role === 'kick'
              ? 1.08
              : role === 'harmony'
                ? 1
                : role === 'perc'
                  ? 0.86
                  : 0.62;
      const dur = Math.max(0.01, note.dur);
      weightedEnergy += note.vol * note.vol * dur * roleWeight;
    }

    const integrated = Math.sqrt(weightedEnergy / data.duration);
    const target = this.getTrackLoudnessTarget(trackId);
    if (!Number.isFinite(integrated) || integrated <= 1e-6) return 1;
    const gain = target / integrated;
    const maxGain = this.isSampleTrack(trackId) ? 3.4 : 1.6;
    return Math.max(0.7, Math.min(maxGain, gain));
  }

  private getSampleVolumeBoost(trackId: TrackId): number {
    switch (trackId) {
      case 'ambient':
        return 3.4;
      case 'orchestral':
        return 3.35;
      default:
        return 1;
    }
  }

  private createSchedulerWorker(): Worker | null {
    if (typeof window === 'undefined' || typeof Worker === 'undefined')
      return null;
    if (this.schedulerWorker) return this.schedulerWorker;
    try {
      const code = `
        let timer = null;
        self.onmessage = (ev) => {
          const msg = ev.data || {};
          if (msg.type === 'start') {
            if (timer) clearInterval(timer);
            const interval = Math.max(16, Number(msg.intervalMs) || 40);
            timer = setInterval(() => self.postMessage({ type: 'tick' }), interval);
            return;
          }
          if (msg.type === 'stop') {
            if (timer) { clearInterval(timer); timer = null; }
          }
        };
      `;
      const blob = new Blob([code], { type: 'text/javascript' });
      this.schedulerWorkerUrl = URL.createObjectURL(blob);
      this.schedulerWorker = new Worker(this.schedulerWorkerUrl);
      this.schedulerWorker.onmessage = (
        ev: MessageEvent<{ type?: string }>,
      ) => {
        if (ev.data?.type === 'tick') this.tickScheduleAhead();
      };
      this.schedulerWorker.onerror = (ev) => {
        this.logSample(
          'warn',
          'scheduler-worker-error',
          'Scheduler worker failed; falling back to interval timer.',
          {
            message: ev.message,
            filename: ev.filename,
            line: ev.lineno,
            column: ev.colno,
          },
          0,
        );
        this.stopSchedulerWorker();
        if (this.schedulerTimer === null) {
          this.schedulerTimer = window.setInterval(
            () => this.tickScheduleAhead(),
            40,
          );
        }
      };
      return this.schedulerWorker;
    } catch {
      this.stopSchedulerWorker();
      return null;
    }
  }

  private startSchedulerClock() {
    const worker = this.createSchedulerWorker();
    if (worker) worker.postMessage({ type: 'start', intervalMs: 40 });
    // Keep a JS timer backup even when worker scheduling is enabled.
    if (this.schedulerTimer === null) {
      this.schedulerTimer = window.setInterval(
        () => this.tickScheduleAhead(),
        worker ? 120 : 40,
      );
    }
  }

  private stopSchedulerWorker() {
    if (this.schedulerWorker) {
      try {
        this.schedulerWorker.postMessage({ type: 'stop' });
      } catch {
        // Worker may already be gone.
      }
      this.schedulerWorker.terminate();
      this.schedulerWorker = null;
    }
    if (this.schedulerWorkerUrl) {
      URL.revokeObjectURL(this.schedulerWorkerUrl);
      this.schedulerWorkerUrl = null;
    }
  }

  private stopSchedulerClock() {
    if (this.schedulerTimer !== null) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
    this.stopSchedulerWorker();
  }

  private syncSchedulerCursor(track: TrackData, atTime: number) {
    const notes = track.notes;
    if (!notes.length) {
      this.schedulerLoopIndex = 0;
      this.schedulerNoteIndex = 0;
      this.schedulerNeedsSync = false;
      return;
    }

    const loopDuration = track.duration / this.tempoMultiplier;
    if (loopDuration <= 0) {
      this.schedulerLoopIndex = 0;
      this.schedulerNoteIndex = 0;
      this.schedulerNeedsSync = false;
      return;
    }

    const elapsed = atTime - this.loopStartTime;
    if (elapsed <= 0) {
      this.schedulerLoopIndex = 0;
      this.schedulerNoteIndex = 0;
      this.schedulerNeedsSync = false;
      return;
    }

    this.schedulerLoopIndex = Math.floor(elapsed / loopDuration);
    const localWall = elapsed - this.schedulerLoopIndex * loopDuration;
    const localTrackTime = localWall * this.tempoMultiplier;
    let lo = 0;
    let hi = notes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (notes[mid].time < localTrackTime - 1e-7) lo = mid + 1;
      else hi = mid;
    }
    this.schedulerNoteIndex = lo;
    if (this.schedulerNoteIndex >= notes.length) {
      this.schedulerNoteIndex = 0;
      this.schedulerLoopIndex++;
    }
    this.schedulerNeedsSync = false;
  }

  private advanceSchedulerCursor(notesLength: number) {
    this.schedulerNoteIndex++;
    if (this.schedulerNoteIndex >= notesLength) {
      this.schedulerNoteIndex = 0;
      this.schedulerLoopIndex++;
    }
  }

  private setPannerPosition(
    panner: PannerNode,
    x: number,
    y: number,
    z: number,
  ) {
    if (
      'positionX' in panner &&
      panner.positionX &&
      panner.positionY &&
      panner.positionZ
    ) {
      panner.positionX.value = x;
      panner.positionY.value = y;
      panner.positionZ.value = z;
    } else if ('setPosition' in panner) {
      (
        panner as unknown as {
          setPosition: (px: number, py: number, pz: number) => void;
        }
      ).setPosition(x, y, z);
    }
  }

  private setPannerOrientation(
    panner: PannerNode,
    x: number,
    y: number,
    z: number,
  ) {
    if (
      'orientationX' in panner &&
      panner.orientationX &&
      panner.orientationY &&
      panner.orientationZ
    ) {
      panner.orientationX.value = x;
      panner.orientationY.value = y;
      panner.orientationZ.value = z;
    } else if ('setOrientation' in panner) {
      (
        panner as unknown as {
          setOrientation: (ox: number, oy: number, oz: number) => void;
        }
      ).setOrientation(x, y, z);
    }
  }

  private connectVirtualSpeaker(
    input: AudioNode,
    output: AudioNode,
    opts: {
      azimuthDeg: number;
      distance: number;
      gain: number;
      delayMs?: number;
      highpassHz?: number;
      lowpassHz?: number;
    },
  ) {
    if (!this.ctx) return;
    const send = this.ctx.createGain();
    send.gain.value = Math.max(0, opts.gain);
    input.connect(send);

    let node: AudioNode = send;
    if (opts.delayMs && opts.delayMs > 0) {
      const delay = this.ctx.createDelay(0.12);
      delay.delayTime.value = Math.min(0.12, opts.delayMs / 1000);
      node.connect(delay);
      node = delay;
    }
    if (opts.highpassHz && opts.highpassHz > 20) {
      const hp = this.ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = opts.highpassHz;
      hp.Q.value = 0.65;
      node.connect(hp);
      node = hp;
    }
    if (opts.lowpassHz && opts.lowpassHz > 200) {
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = opts.lowpassHz;
      lp.Q.value = 0.72;
      node.connect(lp);
      node = lp;
    }

    const panner = this.ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 1;
    panner.maxDistance = 8;
    panner.rolloffFactor = 1.15;
    panner.coneInnerAngle = 360;
    panner.coneOuterAngle = 360;
    panner.coneOuterGain = 1;

    const rad = (opts.azimuthDeg * Math.PI) / 180;
    const x = Math.sin(rad) * opts.distance;
    const y = 0;
    const z = -Math.cos(rad) * opts.distance;
    this.setPannerPosition(panner, x, y, z);

    const oxRaw = -x;
    const oyRaw = 0;
    const ozRaw = -z;
    const len = Math.max(1e-6, Math.hypot(oxRaw, oyRaw, ozRaw));
    this.setPannerOrientation(panner, oxRaw / len, oyRaw / len, ozRaw / len);

    node.connect(panner);
    panner.connect(output);
  }

  private connectVirtualSurround(
    input: AudioNode,
    spread: number,
    output: AudioNode,
  ) {
    if (!this.ctx) return;
    const surroundAmount = Math.max(0.4, Math.min(1, 0.45 + spread * 0.65));
    const surroundBus = this.ctx.createGain();
    surroundBus.gain.value = 0.24 + surroundAmount * 0.34;
    input.connect(surroundBus);

    // Front stage
    this.connectVirtualSpeaker(surroundBus, output, {
      azimuthDeg: -32,
      distance: 1.1,
      gain: 0.46 * surroundAmount,
      delayMs: 0,
      lowpassHz: 12500,
    });
    this.connectVirtualSpeaker(surroundBus, output, {
      azimuthDeg: 32,
      distance: 1.1,
      gain: 0.46 * surroundAmount,
      delayMs: 0,
      lowpassHz: 12500,
    });

    // Side channels (slight Haas delay for envelopment)
    this.connectVirtualSpeaker(surroundBus, output, {
      azimuthDeg: -95,
      distance: 1.7,
      gain: 0.4 * surroundAmount,
      delayMs: 8,
      highpassHz: 180,
      lowpassHz: 9800,
    });
    this.connectVirtualSpeaker(surroundBus, output, {
      azimuthDeg: 95,
      distance: 1.7,
      gain: 0.4 * surroundAmount,
      delayMs: 8.6,
      highpassHz: 180,
      lowpassHz: 9800,
    });

    // Rear channels (more delayed/diffuse)
    this.connectVirtualSpeaker(surroundBus, output, {
      azimuthDeg: -145,
      distance: 2.2,
      gain: 0.34 * surroundAmount,
      delayMs: 15,
      highpassHz: 220,
      lowpassHz: 7600,
    });
    this.connectVirtualSpeaker(surroundBus, output, {
      azimuthDeg: 145,
      distance: 2.2,
      gain: 0.34 * surroundAmount,
      delayMs: 16.2,
      highpassHz: 220,
      lowpassHz: 7600,
    });
  }

  private createTrackGain(): GainNode {
    const g = this.ctx!.createGain();
    const trackData = this.getTrackData();
    let loudnessGain = this.trackLoudnessGains[this.currentTrack];
    if (loudnessGain === undefined && trackData) {
      loudnessGain = this.estimateTrackLoudnessGain(
        this.currentTrack,
        trackData,
      );
      this.trackLoudnessGains[this.currentTrack] = loudnessGain;
    }
    g.gain.value = loudnessGain ?? 1;

    const fx = this.getTrackFxProfile(this.currentTrack);
    const dry = this.ctx!.createGain();
    dry.gain.value = fx.dry;
    g.connect(dry);

    const center = this.ctx!.createGain();
    center.gain.value = 0.54;
    dry.connect(center);
    center.connect(this.preMasterGain ?? this.masterGain!);

    // Virtual surround field (front/side/rear) for all tracks.
    const spread = Math.max(0, Math.min(1, fx.width));
    this.connectVirtualSurround(
      dry,
      spread,
      this.preMasterGain ?? this.masterGain!,
    );

    if (this.reverbInput) {
      const reverbSend = this.ctx!.createGain();
      reverbSend.gain.value = fx.reverb;
      g.connect(reverbSend);
      reverbSend.connect(this.reverbInput);
    }
    if (this.delayInput) {
      const delaySend = this.ctx!.createGain();
      delaySend.gain.value = fx.delay;
      const delaySendPan = this.ctx!.createStereoPanner();
      delaySendPan.pan.value = spread * 0.25;
      g.connect(delaySend);
      delaySend.connect(delaySendPan);
      delaySendPan.connect(this.delayInput);
    }
    return g;
  }

  private updateVolume() {
    if (!this.masterGain || !this.ctx) return;
    // Music follows the shared sound level: 0 when off, scaled at low.
    const muted = this._musicMuted || SoundManager.isMuted();
    this.masterGain.gain.setTargetAtTime(
      muted ? 0 : 0.62 * SoundManager.getGain(),
      this.ctx.currentTime,
      0.05,
    );
  }

  getTrack(): TrackId {
    return this.currentTrack;
  }
  // fallow-ignore-next-line unused-class-member
  isMusicMuted(): boolean {
    return this._musicMuted;
  }

  isEffectivelyMuted(): boolean {
    return this._musicMuted || SoundManager.isMuted();
  }

  setMusicMuted(muted: boolean) {
    this._musicMuted = muted;
    try {
      localStorage.setItem(LS_MUSIC_MUTED_KEY, String(muted));
    } catch {
      // Ignore localStorage write failures.
    }
    this.updateVolume();
  }

  setTrack(trackId: TrackId) {
    if (trackId === this.currentTrack) return;
    const wasPlaying = this.isPlaying;

    if (wasPlaying && this.trackGain && this.ctx) {
      // Fade out old track on its OWN gain node — doesn't affect new track
      const oldGain = this.trackGain;
      const oldNodes = [...this.activeNodes];
      const t = this.ctx.currentTime;
      oldGain.gain.setValueAtTime(oldGain.gain.value, t);
      oldGain.gain.linearRampToValueAtTime(0, t + CROSSFADE_MS / 1000);
      setTimeout(() => {
        for (const nd of oldNodes) {
          try {
            nd.osc.stop();
          } catch {
            // Oscillator may already be stopped.
          }
        }
        try {
          oldGain.disconnect();
        } catch {
          // Node may already be disconnected.
        }
      }, CROSSFADE_MS + 100);
      // Clear so stopInternal doesn't double-kill them
      this.activeNodes = [];
      this.trackGain = null;
    }

    this.stopInternal(false);
    this.currentTrack = trackId;
    this.schedulerNeedsSync = true;
    this.pausedTrackTime = 0;
    this.hasPausedTrackTime = false;
    this.cachedTrackId = null;
    this.cachedTrackData = null;
    this.sampleFallbackCount = 0;
    this.sampleScheduledCount = 0;
    this.sampleNoScheduleTicks = 0;
    this.sampleGateActive = false;
    this.sampleLogTimestamps = {};
    if (this.isSampleTrack(trackId)) {
      this.logSample(
        'info',
        'sample-track-selected',
        'Switched to sample-backed track.',
        { wasPlaying, hasAudioContext: Boolean(this.ctx) },
        0,
      );
    }
    // Eagerly preload SoundFont samples when switching to a sample-based track
    this.samplePreloadPromise = null;
    if (this.ctx) this.preloadSamplesIfNeeded();
    try {
      localStorage.setItem(LS_TRACK_KEY, trackId);
    } catch {
      // Ignore localStorage write failures.
    }

    if (wasPlaying && trackId !== 'off') {
      this.play();
      // Fade in new track
      if (this.trackGain && this.ctx) {
        const t = this.ctx.currentTime;
        this.trackGain.gain.setValueAtTime(0, t);
        this.trackGain.gain.linearRampToValueAtTime(1, t + CROSSFADE_MS / 1000);
      }
    }
  }

  setTempo(multiplier: number) {
    this.tempoMultiplier = Math.max(0.8, Math.min(1.2, multiplier));
    this.schedulerNeedsSync = true;
  }

  play() {
    if (this.currentTrack === 'off' || this.isPlaying) return;
    if (!this.ensureContext()) return;
    this.resumeContext();
    this.pausedTrackTime = 0;
    this.hasPausedTrackTime = false;
    this.updateVolume();
    this.trackGain = this.createTrackGain();
    this.isPlaying = true;
    this.loopStartTime = this.ctx!.currentTime;
    this.scheduledUntil = this.loopStartTime;
    this.schedulerLoopIndex = 0;
    this.schedulerNoteIndex = 0;
    this.schedulerNeedsSync = true;
    // Begin loading SoundFont samples (orchestral/ambient). These tracks stay
    // silent until their sample set is ready, then restart from the intro.
    const sampleConfig = this.getSampleConfig();
    this.sampleGateActive = Boolean(
      sampleConfig &&
      !this.sampleEngine.hasInstruments(sampleConfig.instruments),
    );
    this.preloadSamplesIfNeeded();
    if (this.sampleGateActive) {
      this.logSample(
        'info',
        'sample-gate-armed-play',
        'Holding sample track silent until instruments finish loading.',
        {
          instrumentsReady: false,
        },
        0,
      );
    }
    this.logSample(
      'info',
      'sample-play-start',
      'Starting playback.',
      {
        now: this.ctx!.currentTime,
        hasTrackGain: Boolean(this.trackGain),
      },
      0,
    );
    this.scheduleAhead();
    this.startSchedulerClock();
  }

  pause() {
    if (!this.isPlaying || !this.ctx) return;
    const track = this.getTrackData();
    if (track && track.duration > 0) {
      const elapsedWallTime = this.ctx.currentTime - this.loopStartTime;
      const elapsedTrackTime = elapsedWallTime * this.tempoMultiplier;
      this.pausedTrackTime =
        ((elapsedTrackTime % track.duration) + track.duration) % track.duration;
      this.hasPausedTrackTime = true;
    }
    this.stopInternal(true);
  }

  resume() {
    if (this.currentTrack === 'off' || this.isPlaying) return;
    if (!this.ensureContext()) return;
    this.resumeContext();
    this.updateVolume();
    this.trackGain = this.createTrackGain();
    this.isPlaying = true;
    const sampleConfig = this.getSampleConfig();
    this.sampleGateActive = Boolean(
      sampleConfig &&
      !this.sampleEngine.hasInstruments(sampleConfig.instruments),
    );
    this.preloadSamplesIfNeeded();
    if (this.sampleGateActive) {
      this.logSample(
        'info',
        'sample-gate-armed-resume',
        'Holding sample track silent until instruments finish loading.',
        {
          instrumentsReady: false,
        },
        0,
      );
    }
    this.logSample(
      'info',
      'sample-play-resume',
      'Resuming playback.',
      {
        now: this.ctx!.currentTime,
        hadPauseOffset: this.hasPausedTrackTime,
      },
      0,
    );

    const now = this.ctx!.currentTime;
    const track = this.getTrackData();
    if (track && track.duration > 0 && this.hasPausedTrackTime) {
      const offsetWallTime = this.pausedTrackTime / this.tempoMultiplier;
      this.loopStartTime = now - offsetWallTime;
      this.hasPausedTrackTime = false;
    } else {
      this.loopStartTime = now;
    }

    this.scheduledUntil = now;
    this.schedulerNeedsSync = true;
    this.scheduleAhead();
    this.startSchedulerClock();
  }

  stop() {
    this.stopInternal(true);
    this.schedulerLoopIndex = 0;
    this.schedulerNoteIndex = 0;
    this.schedulerNeedsSync = true;
    this.pausedTrackTime = 0;
    this.hasPausedTrackTime = false;
  }

  private stopInternal(killNodes: boolean) {
    this.isPlaying = false;
    this.sampleGateActive = false;
    this.stopSchedulerClock();
    if (killNodes) {
      for (const n of this.activeNodes) {
        try {
          n.osc.stop();
        } catch {
          // Node (oscillator or sample source) may already be stopped.
        }
      }
      this.activeNodes = [];
    }
    if (killNodes && this.trackGain) {
      try {
        this.trackGain.disconnect();
      } catch {
        // Gain may already be disconnected.
      }
      this.trackGain = null;
    }
  }

  private tickScheduleAhead() {
    try {
      this.scheduleAhead();
    } catch (err) {
      // Keep playback alive even if one scheduler tick throws.
      this.schedulerNeedsSync = true;
      this.logSample(
        'error',
        'scheduler-tick-throw',
        'Scheduler tick threw; forcing cursor resync.',
        {
          error: err instanceof Error ? err.message : String(err),
          isPlaying: this.isPlaying,
          scheduledUntil: this.scheduledUntil,
          activeNodes: this.activeNodes.length,
        },
        0,
      );
    }
  }

  private scheduleAhead() {
    if (!this.ctx || !this.trackGain || !this.isPlaying) return;
    // Re-check global mute each tick
    this.updateVolume();

    const lookAhead = 1.0;
    const until = this.ctx.currentTime + lookAhead;
    if (this.scheduledUntil >= until) return;

    const sampleTrack = this.isSampleTrack();
    const track = this.getTrackData();
    if (!track || track.duration <= 0) {
      this.logSample(
        'warn',
        'schedule-invalid-track-data',
        'No valid track data while scheduling sample track.',
        {
          hasTrack: Boolean(track),
          duration: track?.duration ?? null,
        },
      );
      return;
    }
    const notes = track.notes;
    if (!notes.length) {
      this.logSample(
        'warn',
        'schedule-no-notes',
        'Track contains zero notes while scheduling sample track.',
        { duration: track.duration },
      );
      return;
    }

    const loopDuration = track.duration / this.tempoMultiplier;
    if (loopDuration <= 0) {
      this.logSample(
        'warn',
        'schedule-invalid-loop-duration',
        'Computed non-positive loop duration for sample track.',
        {
          duration: track.duration,
          tempoMultiplier: this.tempoMultiplier,
        },
      );
      return;
    }
    if (this.schedulerNeedsSync)
      this.syncSchedulerCursor(track, this.scheduledUntil);

    if (sampleTrack && this.sampleGateActive) {
      const sampleConfig = this.getSampleConfig();
      if (
        sampleConfig &&
        !this.sampleEngine.hasInstruments(sampleConfig.instruments)
      ) {
        this.preloadSamplesIfNeeded();
        this.scheduledUntil = until;
        const missingInstruments = Array.from(sampleConfig.instruments).filter(
          (instrument) => !this.sampleEngine.hasInstrument(instrument),
        );
        this.logSample(
          'info',
          'sample-gate-wait',
          'Waiting for sample instruments before starting playback.',
          { missingInstruments },
          1800,
        );
        return;
      }

      const restartAt = this.ctx.currentTime;
      this.sampleGateActive = false;
      this.loopStartTime = restartAt;
      this.scheduledUntil = restartAt;
      this.schedulerLoopIndex = 0;
      this.schedulerNoteIndex = 0;
      this.schedulerNeedsSync = true;
      this.logSample(
        'info',
        'sample-gate-open',
        'Sample instruments ready; starting track from the intro.',
        { restartAt },
        0,
      );
      return;
    }

    const now = this.ctx.currentTime;
    this.activeNodes = this.activeNodes.filter((n) => n.endTime > now);
    let safety = 0;
    let scheduledNotesThisTick = 0;
    while (safety < 4096) {
      safety++;
      const note = notes[this.schedulerNoteIndex];
      const noteTime =
        this.loopStartTime +
        this.schedulerLoopIndex * loopDuration +
        note.time / this.tempoMultiplier;
      if (noteTime >= until) break;
      if (noteTime >= this.scheduledUntil - 1e-6) {
        this.playNote(noteTime, note);
        scheduledNotesThisTick++;
      }
      this.advanceSchedulerCursor(notes.length);
    }
    this.scheduledUntil = until;

    if (sampleTrack) {
      if (scheduledNotesThisTick > 0) {
        this.sampleNoScheduleTicks = 0;
        this.sampleScheduledCount += scheduledNotesThisTick;
      } else {
        // Check if the next note is genuinely in the future (natural gap) vs stuck.
        const nextNote = notes[this.schedulerNoteIndex];
        const nextNoteTime = nextNote
          ? this.loopStartTime +
            this.schedulerLoopIndex * loopDuration +
            nextNote.time / this.tempoMultiplier
          : Infinity;
        // Only count as "no progress" if the next note should already be past.
        if (nextNoteTime <= this.scheduledUntil) {
          this.sampleNoScheduleTicks++;
        } else {
          // Next note is naturally in the future — reset counter.
          this.sampleNoScheduleTicks = 0;
        }
        if (this.sampleNoScheduleTicks >= 30) {
          this.logSample(
            'warn',
            'schedule-no-progress',
            'Scheduler cursor appears stuck for sample track.',
            {
              noScheduleTicks: this.sampleNoScheduleTicks,
              schedulerLoopIndex: this.schedulerLoopIndex,
              schedulerNoteIndex: this.schedulerNoteIndex,
              now: this.ctx.currentTime,
              scheduledUntil: this.scheduledUntil,
              nextNoteTime,
            },
          );
          this.sampleNoScheduleTicks = 0;
        }
      }
      if (safety >= 4096) {
        this.logSample(
          'warn',
          'schedule-safety-cap',
          'Scheduler hit safety cap while processing sample track.',
          {
            schedulerLoopIndex: this.schedulerLoopIndex,
            schedulerNoteIndex: this.schedulerNoteIndex,
          },
          0,
        );
      }
      if (
        this.sampleScheduledCount > 0 &&
        this.sampleScheduledCount % 192 <= scheduledNotesThisTick
      ) {
        this.logSample(
          'info',
          'schedule-heartbeat',
          'Sample track scheduling heartbeat.',
          {
            totalScheduled: this.sampleScheduledCount,
            activeNodes: this.activeNodes.length,
            now: this.ctx.currentTime,
          },
          0,
        );
      }
    }

    // Cleanup finished oscillators
    const after = this.ctx.currentTime;
    this.activeNodes = this.activeNodes.filter((n) => n.endTime > after);
  }

  /** Return the SampleTrackConfig for sample-based tracks, or null for oscillator tracks. */
  private getSampleConfig(): SampleTrackConfig | null {
    if (this.currentTrack === 'orchestral') return ORCHESTRAL_CONFIG;
    if (this.currentTrack === 'ambient') return AMBIENT_CONFIG;
    return null;
  }

  /** Map internal NoteRole to the sample engine's InstrumentRole. */
  private noteRoleToInstrumentRole(role: NoteRole): InstrumentRole {
    switch (role) {
      case 'melody':
        return 'melody';
      case 'bass':
        return 'bass';
      case 'harmony':
        return 'harmony';
      case 'kick':
      case 'perc':
        return 'percussion';
      case 'fx':
        return 'fx';
      default:
        return 'pad';
    }
  }

  /** Kick off sample preloading for the current track (if it uses samples). */
  private preloadSamplesIfNeeded(): void {
    const config = this.getSampleConfig();
    if (!config) return;
    if (!this.ctx) {
      this.logSample(
        'warn',
        'preload-missing-context',
        'Sample preload requested before AudioContext was ready.',
      );
      return;
    }
    const instruments = Array.from(config.instruments);
    if (this.sampleEngine.hasInstruments(config.instruments)) {
      this.logSample(
        'info',
        'preload-skip-loaded',
        'Sample instruments already loaded.',
        { instruments },
        3000,
      );
      return;
    }
    if (this.samplePreloadPromise) {
      const ageMs = Date.now() - this.samplePreloadStartedAt;
      if (ageMs > 15000) {
        this.logSample(
          'warn',
          'preload-stale',
          'Sample preload promise looks stale; restarting preload.',
          { ageMs },
          0,
        );
        this.samplePreloadPromise = null;
      } else {
        this.logSample(
          'info',
          'preload-in-flight',
          'Sample preload already in progress.',
          { instruments, ageMs },
          2000,
        );
        return;
      }
    }
    this.logSample(
      'info',
      'preload-start',
      'Starting sample preload.',
      { instruments },
      0,
    );
    this.samplePreloadStartedAt = Date.now();
    this.samplePreloadPromise = this.sampleEngine
      .preload(config, this.ctx)
      .then((ready) => {
        const missing = instruments.filter(
          (instrument) => !this.sampleEngine.hasInstrument(instrument),
        );
        this.logSample(
          ready ? 'info' : 'warn',
          ready ? 'preload-ready' : 'preload-not-ready',
          ready
            ? 'Sample preload finished and core roles are ready.'
            : 'Sample preload finished but engine still not fully ready.',
          { missingInstruments: missing },
          0,
        );
        return ready;
      })
      .catch((err) => {
        this.logSample(
          'error',
          'preload-error',
          'Sample preload threw an exception.',
          { error: err instanceof Error ? err.message : String(err) },
          0,
        );
        return false;
      })
      .finally(() => {
        this.samplePreloadPromise = null;
        this.samplePreloadStartedAt = 0;
      });
  }

  private playNote(time: number, note: TrackNote) {
    if (!this.ctx || !this.trackGain) return;
    const noteRole = this.classifyNoteRole(note);
    const notePriority = this.getNotePriorityFromRole(noteRole);
    const maxVoices = this.getMaxVoices(this.currentTrack);
    this.activeNodes = this.activeNodes.filter((n) => n.endTime > time - 0.002);
    if (this.activeNodes.length >= maxVoices) {
      let lowestIdx = -1;
      let lowestPriority = Number.POSITIVE_INFINITY;
      for (let i = 0; i < this.activeNodes.length; i++) {
        const p = this.activeNodes[i].priority;
        if (p < lowestPriority) {
          lowestPriority = p;
          lowestIdx = i;
        }
      }
      if (lowestIdx < 0 || lowestPriority >= notePriority) return;
      const victim = this.activeNodes[lowestIdx];
      try {
        victim.osc.stop(time + 0.002);
      } catch {
        // Node may already be stopped.
      }
      this.activeNodes.splice(lowestIdx, 1);
    }

    this.triggerSidechain(time, note);

    const dur = note.dur / this.tempoMultiplier;
    const fx = this.getTrackFxProfile(this.currentTrack);
    // Use explicit note.pan when the track generator supplies one;
    // otherwise fall back to the random-within-FX-profile approach.
    const pan =
      note.pan !== undefined
        ? Math.max(-1, Math.min(1, note.pan))
        : (Math.random() * 2 - 1) *
          fx.pan *
          (note.freq < 180 ? 0.35 : note.freq < 500 ? 0.6 : 1);

    // ── Sample-based playback (orchestral / ambient) ──────────────────
    const sampleConfig = this.getSampleConfig();
    if (sampleConfig) {
      const missingInstruments = Array.from(sampleConfig.instruments).filter(
        (instrument) => !this.sampleEngine.hasInstrument(instrument),
      );
      if (missingInstruments.length > 0) {
        // Sample-only modes: stay silent until required instruments are ready.
        this.sampleFallbackCount++;
        this.logSample(
          'warn',
          'sample-missing-instruments',
          'Sample instruments missing at note time; muting note while loading.',
          {
            missingInstruments,
            role: noteRole,
            noteHz: Number(note.freq.toFixed(2)),
            mutedCount: this.sampleFallbackCount,
          },
        );
        this.preloadSamplesIfNeeded();
        return;
      }
      const instRole = this.noteRoleToInstrumentRole(noteRole);
      const roleInstrument = sampleConfig.roleMap[instRole];
      if (this.sampleEngine.hasInstrument(roleInstrument)) {
        const sampleBoost = this.getSampleVolumeBoost(this.currentTrack);
        const sampleVol = Math.max(
          0.00012,
          Math.min(2.1, note.vol * 0.72 * sampleBoost),
        );
        let src: AudioBufferSourceNode | null = null;
        try {
          src = this.sampleEngine.playSample(
            time,
            note.freq,
            dur,
            sampleVol,
            instRole,
            sampleConfig,
            this.trackGain,
            pan,
          );
        } catch (err) {
          this.logSample(
            'error',
            'sample-play-throw',
            'SampleEngine.playSample threw during scheduling.',
            {
              role: instRole,
              instrument: roleInstrument,
              noteHz: Number(note.freq.toFixed(2)),
              duration: Number(dur.toFixed(4)),
              error: err instanceof Error ? err.message : String(err),
            },
            0,
          );
        }
        if (src) {
          const endTime = time + dur + 0.05;
          this.trackActiveNode(src, endTime, notePriority);
          return;
        }
        this.logSample(
          'warn',
          'sample-play-null',
          'SampleEngine returned null source; muting note instead of oscillator fallback.',
          {
            role: instRole,
            instrument: roleInstrument,
            noteHz: Number(note.freq.toFixed(2)),
            duration: Number(dur.toFixed(4)),
          },
        );
        this.sampleFallbackCount++;
        return;
      } else {
        this.sampleFallbackCount++;
        this.logSample(
          'warn',
          `sample-role-missing-${roleInstrument}`,
          'Role-mapped instrument missing; muting note instead of oscillator fallback.',
          {
            role: instRole,
            instrument: roleInstrument,
            noteHz: Number(note.freq.toFixed(2)),
            mutedCount: this.sampleFallbackCount,
          },
        );
        return;
      }
      // If sample playback fails for a note, keep silence (do not inject
      // synthetic oscillator timbre into orchestral/ambient tracks).
      return;
    }

    // ── Oscillator path (non-sample tracks only) ──────────────────────
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const panner = this.ctx.createStereoPanner();
    osc.type = note.wave;
    osc.frequency.setValueAtTime(note.freq, time);
    if (note.freqEnd)
      osc.frequency.linearRampToValueAtTime(
        note.freqEnd,
        time + note.dur / this.tempoMultiplier,
      );

    const v = Math.max(0.00012, note.vol * 0.3);
    const attack = Math.min(
      0.018,
      Math.max(
        0.003,
        dur *
          (note.wave === 'square' || note.wave === 'sawtooth' ? 0.18 : 0.12),
      ),
    );
    const release = Math.min(0.06, Math.max(0.012, dur * 0.28));
    const releaseStart = Math.max(time + attack + 0.001, time + dur - release);
    const sustainLevel = Math.max(
      0.00012,
      v * (note.wave === 'sine' ? 0.9 : 0.82),
    );
    panner.pan.setValueAtTime(pan, time);

    this.playDrumNoiseLayer(time, note, noteRole, pan);

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(v, time + attack);
    gain.gain.setValueAtTime(sustainLevel, releaseStart);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);

    osc.connect(gain);
    gain.connect(panner);
    panner.connect(this.trackGain);
    osc.start(time);
    const endTime = time + dur + 0.02;
    osc.stop(endTime);
    this.trackActiveNode(osc, endTime, notePriority);
  }

  private trackActiveNode(
    osc: OscillatorNode | AudioBufferSourceNode,
    endTime: number,
    priority: number,
  ) {
    this.activeNodes.push({ osc, endTime, priority });
    // Sample sources may end before our desired envelope duration due source
    // buffer length. Remove ended nodes immediately so voice limiting remains accurate.
    osc.onended = () => {
      this.activeNodes = this.activeNodes.filter((n) => n.osc !== osc);
    };
  }

  private getTrackData(): TrackData | null {
    if (this.cachedTrackId === this.currentTrack && this.cachedTrackData)
      return this.cachedTrackData;
    const data = buildTrackData(this.currentTrack);
    if (data) {
      data.notes.sort((a, b) => a.time - b.time || b.vol - a.vol);
      this.trackLoudnessGains[this.currentTrack] =
        this.estimateTrackLoudnessGain(this.currentTrack, data);
    }
    this.cachedTrackId = this.currentTrack;
    this.cachedTrackData = data;
    return data;
  }
}
