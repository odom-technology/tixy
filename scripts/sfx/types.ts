/* The sample catalog's shape. A spec is one sound: the prompt ElevenLabs
   renders, how many takes to keep on disk, which takes ship, and how the
   build trims and levels them. See docs/ASSET_PROVENANCE.md. */

export type SfxSpec = {
  /** File and lookup id, kebab-case: `coin-clink`. Unique across banks. */
  id: string;
  /**
   * `core` loads on the first gesture on every page. Any other bank is a
   * game slug and loads when that game asks for it or first plays a cue.
   */
  bank: string;
  /** What the sound is, one event, plain words. No music unless it is music. */
  prompt?: string;
  /** Generation length, 0.5 to 30 seconds. ElevenLabs bills per second. */
  seconds?: number;
  /** 0 to 1: how literally to follow the prompt. Default 0.5. */
  influence?: number;
  /** Ask for a seamless loop (beds: motors, rolls, crowds). */
  loop?: boolean;
  /** Takes to generate and keep for audition. Default 3. */
  takes?: number;
  /** Take indices that ship, as variants played in turn. Default [0]. */
  pick?: number[];
  /** A file already in public/ to ship as is (no prompt, no processing). */
  file?: string;
  /** Trim and level. Every field has a default; see process.ts. */
  shape?: SfxShape;
};

export type SfxShape = {
  /** Keep only the event around the loudest moment (for multi-hit takes). */
  slice?: boolean;
  /** With slice: the hit starts where it rises out of this, in dB from its
   *  peak. Default -20; -12 for a click in a noisy take. */
  attackDb?: number;
  /** Longest the shipped file may be, in ms. */
  maxMs?: number;
  /** Fade at the end, in ms. */
  fadeMs?: number;
  /** Where the tail ends, in dB under the peak. Default -50. */
  tailDb?: number;
  /** Hiss under this, in dB from the peak, is pushed down. Default -45. */
  gateDb?: number;
  /** Loudest 50 ms window lands here, in dBFS, peak capped at -1. Default -16. */
  levelDb?: number;
  /** High-pass in Hz to clear rumble. Default 40. */
  highpass?: number;
  /** Low-pass in Hz to dull a harsh take. Off by default. */
  lowpass?: number;
};
