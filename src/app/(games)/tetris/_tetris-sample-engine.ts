// ---------------------------------------------------------------------------
// Tetris — SoundFont Sample Engine
// Loads real instrument samples from the free MIDI.js SoundFont CDN and
// provides sample-based playback for orchestral & ambient tracks.
// Zero npm dependencies — uses raw Web Audio API + fetch.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// CDN & types
// ---------------------------------------------------------------------------

const SF_CDN = 'https://gleitz.github.io/midi-js-soundfonts/MusyngKite';
const SAMPLE_FETCH_TIMEOUT_MS = 12000;

/** General MIDI instrument names used in the CDN path. */
type SfInstrument =
  | 'violin'
  | 'cello'
  | 'contrabass'
  | 'french_horn'
  | 'string_ensemble_1'
  | 'timpani'
  | 'pad_2_warm'
  | 'flute'
  | 'acoustic_bass'
  | 'choir_aahs'
  | 'pizzicato_strings';

/** Instrument sets required per sample-based track. */
const ORCHESTRAL_INSTRUMENTS: SfInstrument[] = [
  'violin',
  'contrabass',
  'cello',
  'french_horn',
  'string_ensemble_1',
  'timpani',
];

const AMBIENT_INSTRUMENTS: SfInstrument[] = [
  'violin',
  'cello',
  'contrabass',
  'string_ensemble_1',
  'pizzicato_strings',
];

// ---------------------------------------------------------------------------
// Note ↔ frequency helpers
// ---------------------------------------------------------------------------

const NOTE_NAMES = [
  'C',
  'Db',
  'D',
  'Eb',
  'E',
  'F',
  'Gb',
  'G',
  'Ab',
  'A',
  'Bb',
  'B',
];

/** Convert a frequency (Hz) to the nearest MIDI note name like "A4". */
function freqToNoteName(freq: number): string {
  if (freq <= 0) return 'A0';
  const midi = Math.round(12 * Math.log2(freq / 440) + 69);
  const clamped = Math.max(21, Math.min(108, midi)); // A0–C8
  const octave = Math.floor((clamped - 12) / 12);
  const noteIdx = ((clamped % 12) + 12) % 12;
  return `${NOTE_NAMES[noteIdx]}${octave}`;
}

/** Convert a note name like "A4" to a frequency (Hz). */
function noteNameToFreq(name: string): number {
  const match = name.match(/^([A-G]b?)(\d+)$/);
  if (!match) return 440;
  const note = match[1];
  const octave = parseInt(match[2], 10);
  const idx = NOTE_NAMES.indexOf(note);
  if (idx < 0) return 440;
  const midi = (octave + 1) * 12 + idx;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// ---------------------------------------------------------------------------
// Sample cache — per instrument, stores decoded AudioBuffers keyed by note
// ---------------------------------------------------------------------------

type NoteBufferMap = Map<string, AudioBuffer>;

/** Global cache: instrument → note → AudioBuffer */
const sampleCache = new Map<SfInstrument, NoteBufferMap>();

/** Tracks in-flight fetches so we don't double-fetch the same instrument. */
const loadingPromises = new Map<SfInstrument, Promise<NoteBufferMap>>();

/**
 * Extract a JS object literal assigned in a script by scanning matching braces.
 * This avoids accidentally capturing trailing script text.
 */
function extractObjectLiteral(text: string, fromIndex: number): string | null {
  const start = text.indexOf('{', fromIndex);
  if (start < 0) return null;

  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') {
      depth++;
      continue;
    }
    if (ch === '}') {
      depth--;
      if (depth === 0) return text.substring(start, i + 1);
    }
  }
  return null;
}

/**
 * Fetch and decode all note samples for a single instrument.
 * The CDN serves a JS file that assigns base64-encoded MP3 data URIs.
 * We parse the data URIs and decode them into AudioBuffers.
 */
async function loadInstrumentSamples(
  instrument: SfInstrument,
  ctx: AudioContext,
): Promise<NoteBufferMap> {
  // Return from cache if already loaded
  const cached = sampleCache.get(instrument);
  if (cached) return cached;

  // Deduplicate concurrent loads
  const existing = loadingPromises.get(instrument);
  if (existing) return existing;

  const promise = (async () => {
    const url = `${SF_CDN}/${instrument}-mp3.js`;
    const controller = new AbortController();
    const timeoutId = globalThis.setTimeout(
      () => controller.abort(),
      SAMPLE_FETCH_TIMEOUT_MS,
    );
    let resp: Response;
    try {
      resp = await fetch(url, { signal: controller.signal });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error(`SF fetch timeout: ${instrument}`);
      }
      throw err;
    } finally {
      globalThis.clearTimeout(timeoutId);
    }
    if (!resp.ok)
      throw new Error(`SF fetch failed: ${resp.status} ${instrument}`);
    const text = await resp.text();

    // The JS file format (single-quoted):
    //   if (typeof(MIDI) === 'undefined') var MIDI = {};
    //   if (typeof(MIDI.Soundfont) === 'undefined') MIDI.Soundfont = {};
    //   MIDI.Soundfont.violin = { "A3": "data:audio/mp3;base64,...", ... };
    // We find the real data assignment (not the preamble === checks).
    const assignMatch = text.match(/MIDI\.Soundfont\.\w+\s*=\s*\{/);
    if (!assignMatch || assignMatch.index === undefined) {
      console.warn(
        `[SampleEngine] Could not find data assignment in ${instrument}-mp3.js`,
      );
      throw new Error(`SF parse failed: ${instrument}`);
    }
    const jsonStr = extractObjectLiteral(text, assignMatch.index);
    if (!jsonStr) {
      console.warn(
        `[SampleEngine] Could not delimit JSON object for ${instrument}`,
      );
      throw new Error(`SF parse failed: ${instrument}`);
    }

    // The keys are double-quoted note names, values are data URIs
    let noteMap: Record<string, string>;
    try {
      noteMap = JSON.parse(jsonStr);
    } catch {
      // Fallback: replace single quotes with double, quote bare keys
      try {
        const fixed = jsonStr
          .replace(/'/g, '"')
          .replace(/([{,]\s*)([A-Ga-g][b#]?\d)(\s*:)/g, '$1"$2"$3')
          // Some SoundFont files have a trailing comma before the closing brace.
          .replace(/,(\s*[}\]])/g, '$1');
        noteMap = JSON.parse(fixed);
      } catch (e2) {
        // Last-resort parser: extract note/data-URI pairs directly from object text.
        const parsedByRegex: Record<string, string> = {};
        const pairRegex = /["']([A-Ga-g][b#]?\d)["']\s*:\s*["']([^"']+)["']/g;
        let match: RegExpExecArray | null = pairRegex.exec(jsonStr);
        while (match) {
          parsedByRegex[match[1]] = match[2];
          match = pairRegex.exec(jsonStr);
        }

        if (Object.keys(parsedByRegex).length === 0) {
          console.warn(
            `[SampleEngine] JSON parse failed for ${instrument}:`,
            e2,
          );
          throw new Error(`SF parse failed: ${instrument}`);
        }

        noteMap = parsedByRegex;
      }
    }

    const bufferMap: NoteBufferMap = new Map();
    const decodePromises: Promise<void>[] = [];

    for (const [noteName, dataUri] of Object.entries(noteMap)) {
      if (!dataUri.startsWith('data:')) continue;
      const base64 = dataUri.split(',')[1];
      if (!base64) continue;

      decodePromises.push(
        (async () => {
          try {
            const binary = atob(base64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++)
              bytes[i] = binary.charCodeAt(i);
            const audioBuffer = await ctx.decodeAudioData(
              bytes.buffer.slice(0),
            );
            bufferMap.set(noteName, audioBuffer);
          } catch {
            // Skip notes that fail to decode
          }
        })(),
      );
    }

    await Promise.all(decodePromises);
    console.log(
      `[SampleEngine] ${instrument}: decoded ${bufferMap.size}/${Object.keys(noteMap).length} note samples`,
    );
    sampleCache.set(instrument, bufferMap);
    loadingPromises.delete(instrument);
    return bufferMap;
  })().catch((err) => {
    // Clean up so a retry can re-fetch instead of returning the rejected promise
    loadingPromises.delete(instrument);
    throw err;
  });

  loadingPromises.set(instrument, promise);
  return promise;
}

// ---------------------------------------------------------------------------
// SampleEngine — public API for the music manager
// ---------------------------------------------------------------------------

export type InstrumentRole =
  | 'melody'
  | 'bass'
  | 'harmony'
  | 'pad'
  | 'percussion'
  | 'fx';

export interface SampleTrackConfig {
  roleMap: Record<InstrumentRole, SfInstrument>;
  instruments: SfInstrument[];
}

export const ORCHESTRAL_CONFIG: SampleTrackConfig = {
  roleMap: {
    melody: 'string_ensemble_1',
    bass: 'contrabass',
    harmony: 'french_horn',
    pad: 'cello',
    percussion: 'timpani',
    fx: 'violin',
  },
  instruments: ORCHESTRAL_INSTRUMENTS,
};

export const AMBIENT_CONFIG: SampleTrackConfig = {
  roleMap: {
    melody: 'violin',
    bass: 'contrabass',
    harmony: 'cello',
    pad: 'string_ensemble_1',
    percussion: 'pizzicato_strings',
    fx: 'pizzicato_strings',
  },
  instruments: AMBIENT_INSTRUMENTS,
};

export class SampleEngine {
  private ctx: AudioContext | null = null;
  private loaded = new Set<SfInstrument>();
  private loading = false;
  private _ready = false;
  private playLogTimestamps: Partial<Record<string, number>> = {};

  private logPlayWarning(
    key: string,
    message: string,
    details?: Record<string, unknown>,
    throttleMs = 1000,
  ) {
    const now = Date.now();
    const last = this.playLogTimestamps[key] ?? 0;
    if (throttleMs > 0 && now - last < throttleMs) return;
    this.playLogTimestamps[key] = now;
    if (details) console.warn(`[SampleEngine] ${message}`, details);
    else console.warn(`[SampleEngine] ${message}`);
  }

  /** True once all instruments for the requested config are decoded. */
  // fallow-ignore-next-line unused-class-member
  get ready(): boolean {
    return this._ready;
  }
  // fallow-ignore-next-line unused-class-member
  get isLoading(): boolean {
    return this.loading;
  }

  /**
   * Preload all instrument samples for a given track config.
   * Returns a promise that resolves when all samples are ready.
   * Safe to call multiple times — already-loaded instruments are skipped.
   */
  async preload(
    config: SampleTrackConfig,
    ctx: AudioContext,
  ): Promise<boolean> {
    this.ctx = ctx;
    this.loading = true;

    try {
      const needed = config.instruments.filter((i) => !this.loaded.has(i));
      const roleMap = config.roleMap;
      if (needed.length === 0) {
        this._ready =
          this.loaded.has(roleMap.melody) && this.loaded.has(roleMap.bass);
        this.loading = false;
        return this._ready;
      }

      console.log(
        `[SampleEngine] Loading ${needed.length} instruments:`,
        needed.join(', '),
      );

      const results = await Promise.allSettled(
        needed.map(async (inst) => {
          const bufMap = await loadInstrumentSamples(inst, ctx);
          console.log(
            `[SampleEngine] ✓ ${inst}: ${bufMap?.size ?? 0} notes decoded`,
          );
          // Mark successful instruments immediately so role routing can start using
          // partial sample availability while slower instruments are still loading.
          this.loaded.add(inst);
          this._ready =
            this.loaded.has(roleMap.melody) && this.loaded.has(roleMap.bass);
        }),
      );

      for (let i = 0; i < results.length; i++) {
        if (results[i].status === 'fulfilled') continue;
        const reason = (results[i] as PromiseRejectedResult).reason;
        console.warn(`[SampleEngine] ✗ ${needed[i]} failed:`, reason);
      }

      // Consider ready if at least melody + bass loaded
      this._ready =
        this.loaded.has(roleMap.melody) && this.loaded.has(roleMap.bass);
      console.log(
        `[SampleEngine] Ready: ${this._ready} (melody=${this.loaded.has(roleMap.melody)}, bass=${this.loaded.has(roleMap.bass)})`,
      );
      this.loading = false;
      return this._ready;
    } catch (err) {
      console.warn('[SampleEngine] Preload error:', err);
      this.loading = false;
      return false;
    }
  }

  /**
   * Play a single note using the sample engine.
   * Returns an AudioBufferSourceNode (for stop/tracking), or null if no sample available.
   *
   * @param time      - AudioContext schedule time
   * @param freq      - Note frequency in Hz
   * @param dur       - Duration in seconds
   * @param vol       - Volume 0–1
   * @param role      - Instrument role to select which instrument to use
   * @param config    - Track config (orchestral or ambient)
   * @param dest      - Destination node (typically trackGain)
   * @param panValue  - Stereo pan -1 to 1
   */
  playSample(
    time: number,
    freq: number,
    dur: number,
    vol: number,
    role: InstrumentRole,
    config: SampleTrackConfig,
    dest: AudioNode,
    panValue: number = 0,
  ): AudioBufferSourceNode | null {
    if (!this.ctx) {
      this.logPlayWarning(
        'play-no-context',
        'playSample called before AudioContext was assigned.',
      );
      return null;
    }

    const instrument = config.roleMap[role];
    const bufferMap = sampleCache.get(instrument);
    if (!bufferMap || bufferMap.size === 0) {
      this.logPlayWarning(
        `play-missing-buffer-map-${instrument}`,
        'No decoded samples found for mapped instrument.',
        { role, instrument },
      );
      return null;
    }

    // Find the closest available sample note
    const targetNote = freqToNoteName(freq);
    let buffer = bufferMap.get(targetNote);
    let sampleBaseFreq = freq;

    if (!buffer) {
      // Find nearest available note by semitone distance
      let bestDist = Infinity;
      for (const [noteName, buf] of bufferMap) {
        const noteFreq = noteNameToFreq(noteName);
        const dist = Math.abs(12 * Math.log2(freq / noteFreq));
        if (dist < bestDist) {
          bestDist = dist;
          buffer = buf;
          sampleBaseFreq = noteFreq;
        }
      }
      if (!buffer) {
        this.logPlayWarning(
          `play-no-nearest-buffer-${instrument}`,
          'Could not locate a nearest sample buffer for frequency.',
          {
            role,
            instrument,
            targetNote,
            freq: Number(freq.toFixed(2)),
          },
        );
        return null;
      }
    } else {
      sampleBaseFreq = noteNameToFreq(targetNote);
    }

    // Create source with playback rate adjustment for pitch shifting
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;

    // Pitch-shift by adjusting playback rate
    const playbackRate = freq / sampleBaseFreq;
    const clampedPlaybackRate = Math.max(0.25, Math.min(4, playbackRate));
    source.playbackRate.setValueAtTime(clampedPlaybackRate, time);

    // Sustain support: when the source sample is much shorter than the target
    // note duration, loop the stable body region for legato roles.
    const sourceNaturalDur = buffer.duration / clampedPlaybackRate;
    const sustainRole =
      role === 'melody' || role === 'harmony' || role === 'pad';
    if (
      sustainRole &&
      sourceNaturalDur < dur * 0.85 &&
      buffer.duration > 0.18
    ) {
      const edge = Math.min(0.08, buffer.duration * 0.12);
      const loopStart = edge;
      const loopEnd = buffer.duration - edge;
      if (loopEnd > loopStart + 0.05) {
        source.loop = true;
        source.loopStart = loopStart;
        source.loopEnd = loopEnd;
      }
    }

    // Envelope: attack → sustain → release
    const gain = this.ctx.createGain();
    const attack = Math.min(0.04, dur * 0.15);
    const release = Math.min(0.12, dur * 0.3);
    const sustainLevel = Math.max(0.0001, vol);
    const releaseStart = Math.max(time + attack + 0.001, time + dur - release);

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(sustainLevel, time + attack);
    gain.gain.setValueAtTime(sustainLevel * 0.85, releaseStart);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);

    // Stereo panning
    const panner = this.ctx.createStereoPanner();
    panner.pan.setValueAtTime(Math.max(-1, Math.min(1, panValue)), time);

    // Connect: source → gain → panner → dest
    try {
      source.connect(gain);
      gain.connect(panner);
      panner.connect(dest);

      source.start(time);
      // Stop slightly after envelope ends to avoid clicks
      source.stop(time + dur + 0.05);
    } catch (err) {
      this.logPlayWarning(
        'play-start-stop-error',
        'Failed while connecting or scheduling sample source.',
        {
          role,
          instrument,
          freq: Number(freq.toFixed(2)),
          dur: Number(dur.toFixed(4)),
          time: Number(time.toFixed(4)),
          error: err instanceof Error ? err.message : String(err),
        },
        0,
      );
      try {
        source.disconnect();
      } catch {
        // Source may already be disconnected.
      }
      return null;
    }

    return source;
  }

  /**
   * Check if a specific instrument has been loaded.
   */
  hasInstrument(instrument: SfInstrument): boolean {
    return this.loaded.has(instrument);
  }

  /**
   * Check whether all instruments in a set are loaded.
   */
  hasInstruments(instruments: Iterable<SfInstrument>): boolean {
    for (const instrument of instruments) {
      if (!this.loaded.has(instrument)) return false;
    }
    return true;
  }

  /** Dispose of all cached buffers and reset state. */
  // fallow-ignore-next-line unused-class-member
  dispose(): void {
    this.loaded.clear();
    this._ready = false;
    this.loading = false;
    this.ctx = null;
    // Don't clear the global sampleCache — it can be reused across instances
  }
}
