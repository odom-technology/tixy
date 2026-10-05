import type { StepNote, TrackData } from '../_tetris-music-score';
import {
  TETRIS_THEME_BPM,
  TETRIS_THEME_ORCHESTRAL_FORM,
  n,
  type TrackNote,
} from '../_tetris-music-score';

// ---------------------------------------------------------------------------
// Track 6: "Orchestral" — Epic cinematic arrangement
// Intimate strings opening that builds to a massive orchestral climax.
// Long legato lines, lush pads, powerful horn fanfares, and sparse timpani
// that only punctuates key structural moments.
// ---------------------------------------------------------------------------

type SectionWindow = { start: number; end: number; index: number };
type ChordVoicing = [string, string, string, string];

const CHORD_BY_ROOT: Record<string, ChordVoicing> = {
  A: ['A3', 'C4', 'E4', 'A4'],
  B: ['B3', 'D4', 'F4', 'B4'],
  C: ['C3', 'E3', 'G3', 'C4'],
  D: ['D3', 'F3', 'A3', 'D4'],
  E: ['E3', 'G#3', 'B3', 'E4'],
  F: ['F3', 'A3', 'C4', 'F4'],
  G: ['G3', 'B3', 'D4', 'G4'],
  Bb: ['Bb3', 'D4', 'F4', 'Bb4'],
  Eb: ['Eb3', 'G3', 'Bb3', 'Eb4'],
};

// Dramatic arc: whisper → warmth → grandeur → triumph
function sectionIntensity(index: number): number {
  if (index < 2) return 0.42; // intimate opening
  if (index < 4) return 0.58; // gentle warmth
  if (index < 6) return 0.76; // building momentum
  if (index < 8) return 0.92; // grand
  if (index < 10) return 1.08; // powerful climax
  return 1.2; // triumphant finale
}

function getRootToken(note: string): string {
  return note.replace(/[0-9]/g, '');
}

function chordFromBassRoot(note: string): ChordVoicing {
  const token = getRootToken(note);
  return CHORD_BY_ROOT[token] ?? CHORD_BY_ROOT.A;
}

function buildSectionChordPlan(bass: StepNote[]): ChordVoicing[] {
  const beatRoots: string[] = [];
  let carryRoot = 'A3';
  for (const [note, steps] of bass) {
    if (note) carryRoot = note;
    const beats = Math.max(1, Math.round(steps / 2));
    for (let b = 0; b < beats; b++) beatRoots.push(carryRoot);
  }
  if (beatRoots.length === 0) return [CHORD_BY_ROOT.A];

  const plan: ChordVoicing[] = [];
  for (let b = 0; b < beatRoots.length; b += 2) {
    plan.push(chordFromBassRoot(beatRoots[b]));
  }
  return plan;
}

export function orchestralTrack(): TrackData {
  const bpm = TETRIS_THEME_BPM;
  const beat = 60 / bpm;
  const step = beat / 2;
  const allNotes: TrackNote[] = [];

  // Slow majestic autopan for melody — barely perceptible drift
  const melodyPan = (t: number) => Math.sin(t * 2 * Math.PI * 0.11) * 0.3;

  const sectionWindows: SectionWindow[] = [];
  let melodyTime = 0;

  // ── Pass 1: melody timeline ──────────────────────────────────────────
  for (let i = 0; i < TETRIS_THEME_ORCHESTRAL_FORM.length; i++) {
    const section = TETRIS_THEME_ORCHESTRAL_FORM[i];
    const start = melodyTime;
    const intensity = sectionIntensity(i);
    const grand = i >= 6;
    const climax = i >= 8;
    const finale = i >= 10;

    for (const [note, steps] of section.melody) {
      const dur = steps * step;
      if (note) {
        const freq = n(note);
        const leadVol = 0.11 + intensity * 0.1;
        const mp = melodyPan(melodyTime);

        // Main violin/string ensemble melody — legato, expressive
        // (freq 220–1400, dur >= 0.08, vol >= 0.11 → "melody" → string_ensemble_1)
        allNotes.push({
          time: melodyTime,
          freq,
          dur: dur * 0.97,
          wave: 'triangle',
          vol: leadVol,
          pan: mp,
        });

        // Ensemble width layer — subtle detune for richness
        allNotes.push({
          time: melodyTime + 0.005,
          freq: freq * 1.003,
          dur: dur * 0.92,
          wave: 'sawtooth',
          vol: leadVol * 0.18,
          pan: mp + 0.25,
        });

        // Octave doubling only in grand/climax sections on sustained notes
        if (grand && steps >= 2) {
          allNotes.push({
            time: melodyTime + dur * 0.06,
            freq: freq * 2,
            dur: dur * 0.7,
            wave: 'triangle',
            vol: leadVol * (finale ? 0.52 : climax ? 0.4 : 0.28),
            pan: -mp * 0.5,
          });
        }

        // Horn counter-melody under long sustained notes (climactic sections)
        // (freq 220–1400, lower vol → "harmony" → french_horn)
        if (climax && steps >= 3) {
          const hornFreq = Math.max(220, freq * 0.5);
          allNotes.push({
            time: melodyTime + dur * 0.2,
            freq: hornFreq,
            dur: dur * 0.6,
            wave: 'triangle',
            vol: 0.065 + intensity * 0.04,
            pan: 0.3,
          });
        }
      }
      melodyTime += dur;
    }

    sectionWindows.push({ start, end: melodyTime, index: i });
  }

  // ── Pass 2: harmony, bass, and texture layers ────────────────────────
  for (let i = 0; i < sectionWindows.length; i++) {
    const win = sectionWindows[i];
    const section = TETRIS_THEME_ORCHESTRAL_FORM[i];
    const intensity = sectionIntensity(i);
    const warm = i >= 2;
    const grand = i >= 6;
    const climax = i >= 8;
    const finale = i >= 10;
    const chordPlan = buildSectionChordPlan(section.bass);

    // ── Contrabass + cello — long sustained legato, no staccato pulse ──
    // (freq <= 220, vol >= 0.04 → "bass" → contrabass)
    let bassTime = win.start;
    for (const [note, steps] of section.bass) {
      const dur = steps * step;
      if (note) {
        const root = n(note);
        const contra = Math.max(42, root * 0.25);
        const cello = Math.max(70, root * 0.5);

        // Deep contrabass — centered, warm sustained bow
        allNotes.push({
          time: bassTime,
          freq: contra,
          dur: dur * 0.94,
          wave: 'sine',
          vol: (0.06 + intensity * 0.055) * (grand ? 1.2 : 1),
          pan: 0,
        });

        // Cello layer — slightly warmer, gentle off-center
        allNotes.push({
          time: bassTime + 0.006,
          freq: cello,
          dur: dur * 0.92,
          wave: 'triangle',
          vol: (0.05 + intensity * 0.04) * (grand ? 1.15 : 1),
          pan: Math.sin(bassTime * 0.8) * 0.15,
        });
      }
      bassTime += dur;
    }

    // ── String pad harmony — lush sustained chords ──
    // (mid freq, lower vol → "harmony" → french_horn / falls through)
    const chordPans = [-0.38, -0.13, 0.13, 0.38];
    for (let h = 0; h < chordPlan.length; h++) {
      const t = win.start + h * beat * 2;
      if (t >= win.end) break;
      const chord = chordPlan[h];
      // Long, breathing sustain — not clipped to a bar
      const sustain = beat * (finale ? 3.8 : climax ? 3.4 : grand ? 3.0 : 2.6);

      for (let c = 0; c < chord.length; c++) {
        const baseFreq = n(chord[c]);
        const padVol = (0.035 + intensity * 0.025) * (finale ? 1.2 : 1);
        // Warm string pad voice
        allNotes.push({
          time: t,
          freq: baseFreq,
          dur: sustain,
          wave: 'triangle',
          vol: padVol,
          pan: chordPans[c],
        });
        // Slight detune for ensemble width
        allNotes.push({
          time: t + 0.006,
          freq: baseFreq * 1.002,
          dur: sustain * 0.85,
          wave: 'sine',
          vol: padVol * 0.35,
          pan: chordPans[c] * 0.6,
        });
      }

      // ── Horn fanfares — only at key moments in grand/climax sections ──
      // Appear on the second beat of every other chord change
      if (grand && h % 2 === 0) {
        const hornRoot = n(chord[2]);
        const hornFreq = Math.max(220, hornRoot);
        const hornVol = 0.06 + intensity * 0.06;
        // Powerful horn stab
        allNotes.push({
          time: t + beat * 1.0,
          freq: hornFreq,
          dur: beat * (climax ? 1.6 : 1.1),
          wave: 'triangle',
          vol: hornVol,
          pan: -0.22,
        });
        // Horn doubling for power
        allNotes.push({
          time: t + beat * 1.02,
          freq: hornFreq * 1.005,
          dur: beat * (climax ? 1.4 : 0.9),
          wave: 'sawtooth',
          vol: hornVol * 0.35,
          pan: 0.22,
        });
        // Additional horn fifth in finale
        if (finale) {
          allNotes.push({
            time: t + beat * 1.04,
            freq: hornFreq * 1.5,
            dur: beat * 1.2,
            wave: 'triangle',
            vol: hornVol * 0.5,
            pan: 0.35,
          });
        }
      }

      // ── Sparse upper shimmer — only in warm+ sections, on long chord changes ──
      if (warm && h % 2 === 0) {
        const shimmerNote = chord[3] ?? chord[0];
        allNotes.push({
          time: t + beat * 0.3,
          freq: n(shimmerNote) * 2,
          dur: beat * (grand ? 1.5 : 0.9),
          wave: 'triangle',
          vol: 0.018 + intensity * 0.014,
          pan: Math.sin(t * 1.3) * 0.45,
        });
      }
    }
  }

  const duration = melodyTime;

  // ── Timpani — sparse, powerful, structural only ──────────────────────
  // NOT on every beat. Only at downbeats of 4-bar phrases, section starts,
  // and building intensity in climactic passages.
  let sectionPtr = 0;
  for (let b = 0; b < duration / beat; b++) {
    const t = b * beat;
    while (
      sectionPtr < sectionWindows.length - 1 &&
      t >= sectionWindows[sectionPtr].end
    ) {
      sectionPtr++;
    }
    const secIdx = sectionWindows[sectionPtr].index;
    const intensity = sectionIntensity(secIdx);

    // Sparse timpani — frequency depends on section intensity
    const playTimp =
      secIdx < 2
        ? false // no timpani in intimate opening
        : secIdx < 4
          ? b % 8 === 0 // every 8 beats (2 bars) in warm sections
          : secIdx < 6
            ? b % 4 === 0 // every 4 beats (1 bar) in building sections
            : secIdx < 8
              ? b % 4 === 0 || b % 4 === 2 // half notes in grand sections
              : b % 2 === 0; // quarter notes only in climax/finale

    if (playTimp) {
      const isDownbeat = b % 4 === 0;
      // Deep timpani hit — centered
      allNotes.push({
        time: t,
        freq: isDownbeat ? 78 : 88,
        freqEnd: 32,
        dur: beat * 0.7,
        wave: 'sine',
        vol: (isDownbeat ? 0.1 : 0.07) + intensity * 0.06,
        pan: 0,
      });
      // Attack transient layer
      allNotes.push({
        time: t + 0.008,
        freq: 156,
        freqEnd: 62,
        dur: beat * 0.2,
        wave: 'triangle',
        vol: 0.03 + intensity * 0.04,
        pan: 0.05,
      });
    }

    // Timpani roll only before section transitions in grand+ sections
    if (secIdx >= 6 && b % 8 === 7) {
      const rollStart = t + beat * 0.4;
      for (let r = 0; r < 4; r++) {
        const rp = r / 3;
        allNotes.push({
          time: rollStart + r * step * 0.3,
          freq: 92 + rp * 20,
          freqEnd: 50,
          dur: step * 0.28,
          wave: 'sine',
          vol: 0.04 + rp * 0.06 + intensity * 0.03,
          pan: r % 2 === 0 ? -0.1 : 0.1,
        });
      }
    }
  }

  // ── Section transitions — cinematic swells and impacts ───────────────
  for (let i = 1; i < sectionWindows.length; i++) {
    const boundary = sectionWindows[i].start;
    const secIdx = sectionWindows[i].index;
    const intensity = sectionIntensity(secIdx);
    const grand = secIdx >= 6;
    const climax = secIdx >= 8;

    // Impact hit at section start — deep, resonant, centered
    allNotes.push({
      time: boundary,
      freq: climax ? 58 : 68,
      freqEnd: 26,
      dur: beat * (climax ? 1.6 : 1.2),
      wave: 'sine',
      vol: climax ? 0.3 : grand ? 0.2 : 0.12,
      pan: 0,
    });

    // Mid-range impact layer
    if (grand) {
      allNotes.push({
        time: boundary + 0.012,
        freq: 170,
        freqEnd: 76,
        dur: beat * 0.5,
        wave: 'triangle',
        vol: climax ? 0.12 : 0.08,
        pan: -0.15,
      });
    }

    // Rising string swell before grand+ transitions
    if (grand) {
      const swellLen = climax ? beat * 3.2 : beat * 2.0;
      const swellStart = Math.max(0, boundary - swellLen);
      // Low rising strings
      allNotes.push({
        time: swellStart,
        freq: 160,
        freqEnd: 320,
        dur: swellLen * 0.95,
        wave: 'triangle',
        vol: 0.05 + intensity * 0.03,
        pan: -0.3,
      });
      // Mid rising strings
      allNotes.push({
        time: swellStart + beat * 0.15,
        freq: 220,
        freqEnd: 440,
        dur: swellLen * 0.9,
        wave: 'sine',
        vol: 0.04 + intensity * 0.025,
        pan: 0.3,
      });
      // High shimmer riser in climax
      if (climax) {
        allNotes.push({
          time: swellStart + beat * 0.3,
          freq: 440,
          freqEnd: 880,
          dur: swellLen * 0.85,
          wave: 'triangle',
          vol: 0.025 + intensity * 0.015,
          pan: Math.sin(swellStart * 1.5) * 0.4,
        });
      }
    }
  }

  return { duration, notes: allNotes };
}
