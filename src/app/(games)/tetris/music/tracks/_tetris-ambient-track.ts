import type { TrackData, StepNote } from '../_tetris-music-score';
import { TETRIS_THEME_BPM, n, type TrackNote } from '../_tetris-music-score';

// ---------------------------------------------------------------------------
// Track: "Ambient" — peaceful strings ensemble with pizzicato
// Gentle violin melody, warm cello harmony, lush string pads, contrabass,
// and delicate pizzicato ornaments. No percussion — purely strings-based.
// ---------------------------------------------------------------------------

type SymphonySection = {
  melody: StepNote[];
  bass: StepNote[];
  chords: [string, string, string, string][];
};

const AMBIENT_SYMPHONY_SECTIONS: SymphonySection[] = [
  {
    melody: [
      ['E5', 3],
      ['D5', 1],
      ['C5', 2],
      ['B4', 2],
      ['A4', 4],
      ['C5', 2],
      ['E5', 2],
      ['D5', 2],
      ['C5', 2],
      ['B4', 2],
      ['A4', 4],
      ['E5', 2],
      ['D5', 2],
      ['C5', 2],
    ],
    bass: [
      ['A3', 2],
      ['E3', 2],
      ['A3', 2],
      ['E3', 2],
      ['F3', 2],
      ['C4', 2],
      ['F3', 2],
      ['C4', 2],
      ['G3', 2],
      ['D3', 2],
      ['G3', 2],
      ['D3', 2],
      ['E3', 2],
      ['B3', 2],
      ['E3', 2],
      ['B3', 2],
    ],
    chords: [
      ['A3', 'C4', 'E4', 'A4'],
      ['F3', 'A3', 'C4', 'F4'],
      ['G3', 'B3', 'D4', 'G4'],
      ['E3', 'G#3', 'B3', 'E4'],
    ],
  },
  {
    melody: [
      ['C5', 2],
      ['E5', 2],
      ['G5', 2],
      ['E5', 2],
      ['D5', 2],
      ['F5', 2],
      ['A5', 2],
      ['F5', 2],
      ['E5', 2],
      ['D5', 2],
      ['C5', 2],
      ['B4', 2],
      ['A4', 4],
      ['B4', 2],
      ['C5', 2],
    ],
    bass: [
      ['C3', 2],
      ['G3', 2],
      ['C3', 2],
      ['G3', 2],
      ['D3', 2],
      ['A3', 2],
      ['D3', 2],
      ['A3', 2],
      ['F3', 2],
      ['C4', 2],
      ['F3', 2],
      ['C4', 2],
      ['E3', 2],
      ['B3', 2],
      ['E3', 2],
      ['B3', 2],
    ],
    chords: [
      ['C4', 'E4', 'G4', 'C5'],
      ['D4', 'F4', 'A4', 'D5'],
      ['F3', 'A3', 'C4', 'F4'],
      ['E3', 'G#3', 'B3', 'D4'],
    ],
  },
  {
    melody: [
      ['A4', 2],
      ['C5', 2],
      ['E5', 2],
      ['G5', 2],
      ['F5', 2],
      ['E5', 2],
      ['D5', 2],
      ['C5', 2],
      ['B4', 2],
      ['C5', 2],
      ['D5', 2],
      ['E5', 2],
      ['F5', 2],
      ['E5', 2],
      ['D5', 2],
      ['C5', 2],
    ],
    bass: [
      ['A3', 2],
      ['E3', 2],
      ['A3', 2],
      ['E3', 2],
      ['D3', 2],
      ['A3', 2],
      ['D3', 2],
      ['A3', 2],
      ['C3', 2],
      ['G3', 2],
      ['C3', 2],
      ['G3', 2],
      ['B3', 2],
      ['F3', 2],
      ['B3', 2],
      ['E3', 2],
    ],
    chords: [
      ['A3', 'C4', 'E4', 'A4'],
      ['D3', 'F3', 'A3', 'D4'],
      ['C3', 'E3', 'G3', 'C4'],
      ['B3', 'D4', 'F4', 'B4'],
    ],
  },
  {
    melody: [
      ['D5', 4],
      ['F5', 2],
      ['E5', 2],
      ['D5', 2],
      ['C5', 2],
      ['B4', 2],
      ['A4', 2],
      ['C5', 2],
      ['E5', 2],
      ['D5', 2],
      ['C5', 2],
      ['B4', 2],
      ['A4', 4],
    ],
    bass: [
      ['D3', 2],
      ['A3', 2],
      ['D3', 2],
      ['A3', 2],
      ['F3', 2],
      ['C4', 2],
      ['F3', 2],
      ['C4', 2],
      ['G3', 2],
      ['D3', 2],
      ['G3', 2],
      ['D3', 2],
      ['A3', 2],
      ['E3', 2],
      ['A3', 2],
      ['E3', 2],
    ],
    chords: [
      ['D3', 'F3', 'A3', 'D4'],
      ['F3', 'A3', 'C4', 'F4'],
      ['G3', 'B3', 'D4', 'G4'],
      ['A3', 'C4', 'E4', 'A4'],
    ],
  },
  {
    melody: [
      ['E5', 2],
      ['G5', 2],
      ['A5', 2],
      ['G5', 2],
      ['F5', 2],
      ['E5', 2],
      ['D5', 2],
      ['C5', 2],
      ['B4', 2],
      ['D5', 2],
      ['F5', 2],
      ['E5', 2],
      ['D5', 2],
      ['C5', 2],
      ['B4', 2],
      ['A4', 2],
    ],
    bass: [
      ['E3', 2],
      ['B3', 2],
      ['E3', 2],
      ['B3', 2],
      ['A3', 2],
      ['E3', 2],
      ['A3', 2],
      ['E3', 2],
      ['F3', 2],
      ['C4', 2],
      ['F3', 2],
      ['C4', 2],
      ['D3', 2],
      ['A3', 2],
      ['D3', 2],
      ['A3', 2],
    ],
    chords: [
      ['E3', 'G#3', 'B3', 'E4'],
      ['A3', 'C4', 'E4', 'A4'],
      ['F3', 'A3', 'C4', 'F4'],
      ['D3', 'F3', 'A3', 'D4'],
    ],
  },
  {
    melody: [
      ['C5', 3],
      ['B4', 1],
      ['A4', 2],
      ['C5', 2],
      ['E5', 2],
      ['D5', 2],
      ['C5', 2],
      ['B4', 2],
      ['A4', 2],
      ['G4', 2],
      ['A4', 2],
      ['B4', 2],
      ['C5', 2],
      ['D5', 2],
      ['E5', 2],
    ],
    bass: [
      ['C3', 2],
      ['G3', 2],
      ['C3', 2],
      ['G3', 2],
      ['A3', 2],
      ['E3', 2],
      ['A3', 2],
      ['E3', 2],
      ['F3', 2],
      ['C4', 2],
      ['F3', 2],
      ['C4', 2],
      ['E3', 2],
      ['B3', 2],
      ['E3', 2],
      ['B3', 2],
    ],
    chords: [
      ['C3', 'E3', 'G3', 'C4'],
      ['A3', 'C4', 'E4', 'A4'],
      ['F3', 'A3', 'C4', 'F4'],
      ['E3', 'G#3', 'B3', 'E4'],
    ],
  },
  {
    melody: [
      ['A4', 2],
      ['B4', 2],
      ['C5', 2],
      ['D5', 2],
      ['E5', 2],
      ['F5', 2],
      ['G5', 2],
      ['A5', 2],
      ['G5', 2],
      ['F5', 2],
      ['E5', 2],
      ['D5', 2],
      ['C5', 2],
      ['B4', 2],
      ['A4', 4],
    ],
    bass: [
      ['A3', 2],
      ['E3', 2],
      ['A3', 2],
      ['E3', 2],
      ['G3', 2],
      ['D3', 2],
      ['G3', 2],
      ['D3', 2],
      ['F3', 2],
      ['C4', 2],
      ['F3', 2],
      ['C4', 2],
      ['E3', 2],
      ['B3', 2],
      ['E3', 2],
      ['B3', 2],
    ],
    chords: [
      ['A3', 'C4', 'E4', 'A4'],
      ['G3', 'B3', 'D4', 'G4'],
      ['F3', 'A3', 'C4', 'F4'],
      ['E3', 'G#3', 'B3', 'E4'],
    ],
  },
  {
    melody: [
      ['E5', 2],
      ['D5', 2],
      ['C5', 2],
      ['B4', 2],
      ['A4', 2],
      ['C5', 2],
      ['E5', 2],
      ['G5', 2],
      ['F5', 2],
      ['E5', 2],
      ['D5', 2],
      ['C5', 2],
      ['B4', 2],
      ['C5', 2],
      ['D5', 2],
      ['E5', 2],
    ],
    bass: [
      ['E3', 2],
      ['B3', 2],
      ['E3', 2],
      ['B3', 2],
      ['D3', 2],
      ['A3', 2],
      ['D3', 2],
      ['A3', 2],
      ['C3', 2],
      ['G3', 2],
      ['C3', 2],
      ['G3', 2],
      ['A3', 2],
      ['E3', 2],
      ['A3', 2],
      ['E3', 2],
    ],
    chords: [
      ['E3', 'G#3', 'B3', 'E4'],
      ['D3', 'F3', 'A3', 'D4'],
      ['C3', 'E3', 'G3', 'C4'],
      ['A3', 'C4', 'E4', 'A4'],
    ],
  },
  {
    melody: [
      ['D5', 3],
      ['C5', 1],
      ['B4', 2],
      ['A4', 2],
      ['B4', 2],
      ['C5', 2],
      ['D5', 2],
      ['F5', 2],
      ['E5', 2],
      ['D5', 2],
      ['C5', 2],
      ['B4', 2],
      ['A4', 2],
      ['C5', 2],
      ['E5', 2],
      ['D5', 2],
    ],
    bass: [
      ['D3', 2],
      ['A3', 2],
      ['D3', 2],
      ['A3', 2],
      ['C3', 2],
      ['G3', 2],
      ['C3', 2],
      ['G3', 2],
      ['B3', 2],
      ['F3', 2],
      ['B3', 2],
      ['F3', 2],
      ['A3', 2],
      ['E3', 2],
      ['A3', 2],
      ['E3', 2],
    ],
    chords: [
      ['D3', 'F3', 'A3', 'D4'],
      ['C3', 'E3', 'G3', 'C4'],
      ['B3', 'D4', 'F4', 'B4'],
      ['A3', 'C4', 'E4', 'A4'],
    ],
  },
  {
    melody: [
      ['F5', 2],
      ['E5', 2],
      ['D5', 2],
      ['C5', 2],
      ['B4', 2],
      ['A4', 2],
      ['B4', 2],
      ['C5', 2],
      ['D5', 2],
      ['E5', 2],
      ['F5', 2],
      ['A5', 2],
      ['G5', 2],
      ['F5', 2],
      ['E5', 2],
      ['D5', 2],
    ],
    bass: [
      ['F3', 2],
      ['C4', 2],
      ['F3', 2],
      ['C4', 2],
      ['E3', 2],
      ['B3', 2],
      ['E3', 2],
      ['B3', 2],
      ['D3', 2],
      ['A3', 2],
      ['D3', 2],
      ['A3', 2],
      ['C3', 2],
      ['G3', 2],
      ['C3', 2],
      ['G3', 2],
    ],
    chords: [
      ['F3', 'A3', 'C4', 'F4'],
      ['E3', 'G#3', 'B3', 'E4'],
      ['D3', 'F3', 'A3', 'D4'],
      ['C3', 'E3', 'G3', 'C4'],
    ],
  },
  {
    melody: [
      ['E5', 2],
      ['G5', 2],
      ['F5', 2],
      ['E5', 2],
      ['D5', 2],
      ['C5', 2],
      ['B4', 2],
      ['C5', 2],
      ['D5', 2],
      ['F5', 2],
      ['E5', 2],
      ['D5', 2],
      ['C5', 2],
      ['B4', 2],
      ['A4', 4],
    ],
    bass: [
      ['E3', 2],
      ['B3', 2],
      ['E3', 2],
      ['B3', 2],
      ['F3', 2],
      ['C4', 2],
      ['F3', 2],
      ['C4', 2],
      ['G3', 2],
      ['D3', 2],
      ['G3', 2],
      ['D3', 2],
      ['A3', 2],
      ['E3', 2],
      ['A3', 2],
      ['E3', 2],
    ],
    chords: [
      ['E3', 'G#3', 'B3', 'E4'],
      ['F3', 'A3', 'C4', 'F4'],
      ['G3', 'B3', 'D4', 'G4'],
      ['A3', 'C4', 'E4', 'A4'],
    ],
  },
  {
    melody: [
      ['C5', 4],
      ['E5', 2],
      ['D5', 2],
      ['C5', 2],
      ['B4', 2],
      ['A4', 2],
      ['B4', 2],
      ['C5', 2],
      ['E5', 2],
      ['G5', 2],
      ['F5', 2],
      ['E5', 2],
      ['D5', 2],
      ['C5', 2],
      ['B4', 2],
    ],
    bass: [
      ['C3', 2],
      ['G3', 2],
      ['C3', 2],
      ['G3', 2],
      ['D3', 2],
      ['A3', 2],
      ['D3', 2],
      ['A3', 2],
      ['E3', 2],
      ['B3', 2],
      ['E3', 2],
      ['B3', 2],
      ['A3', 2],
      ['E3', 2],
      ['A3', 2],
      ['E3', 2],
    ],
    chords: [
      ['C3', 'E3', 'G3', 'C4'],
      ['D3', 'F3', 'A3', 'D4'],
      ['E3', 'G#3', 'B3', 'E4'],
      ['A3', 'C4', 'E4', 'A4'],
    ],
  },
];

// Gentle intensity curve — stays low and peaceful throughout.
function sectionIntensity(index: number): number {
  if (index < 3) return 0.55;
  if (index < 6) return 0.68;
  if (index < 9) return 0.78;
  return 0.88;
}

export function ambientTrack(): TrackData {
  const bpm = TETRIS_THEME_BPM;
  const beat = 60 / bpm;
  const step = beat / 2;
  const allNotes: TrackNote[] = [];

  // Slow drifting LFO for melody pan — very gentle L↔R
  const melodyPan = (t: number) => Math.sin(t * 2 * Math.PI * 0.14) * 0.35;

  // ── Pass 1: lay down melody timing to determine section windows ──
  const sectionWindows: { start: number; end: number; index: number }[] = [];
  let melodyTime = 0;
  for (let i = 0; i < AMBIENT_SYMPHONY_SECTIONS.length; i++) {
    const section = AMBIENT_SYMPHONY_SECTIONS[i];
    const intensity = sectionIntensity(i);

    const start = melodyTime;
    for (const [note, steps] of section.melody) {
      const dur = steps * step;
      if (note) {
        const freq = n(note);
        const leadVol = 0.115 + intensity * 0.05;
        const mp = melodyPan(melodyTime);

        // Violin melody — gentle legato line
        // (freq 220–1400, dur >= 0.08, vol >= 0.11 → classifies as "melody" → violin)
        allNotes.push({
          time: melodyTime,
          freq,
          dur: dur * 0.96,
          wave: 'triangle',
          vol: leadVol,
          pan: mp,
        });

        // Warm octave-below shadow (classifies as "harmony" → cello)
        allNotes.push({
          time: melodyTime + 0.006,
          freq: freq * 0.5,
          dur: dur * 0.88,
          wave: 'sine',
          vol: leadVol * 0.22,
          pan: -mp * 0.6,
        });
      }
      melodyTime += dur;
    }
    sectionWindows.push({ start, end: melodyTime, index: i });
  }

  // ── Pass 2: string pads, bass, and pizzicato over each section ──
  for (let i = 0; i < sectionWindows.length; i++) {
    const win = sectionWindows[i];
    const section = AMBIENT_SYMPHONY_SECTIONS[i];
    const intensity = sectionIntensity(i);
    const lush = i >= 4;

    // ── String ensemble pad — long sustained chords ──
    // (low vol + mid freq → classifies as "harmony" → cello / string_ensemble_1)
    let t = win.start;
    let chordCursor = 0;
    while (t < win.end) {
      const chord = section.chords[chordCursor % section.chords.length];
      const hold = beat * 4.5;
      // Spread chord voices across stereo for envelopment
      const chordPans = [-0.4, -0.14, 0.14, 0.4];
      for (let c = 0; c < chord.length; c++) {
        const base = n(chord[c]);
        // Keep vol below 0.04 so low-freq chord tones classify as
        // "harmony" → cello, NOT "bass" → contrabass (avoids organ sound).
        const bedVol = 0.032 + intensity * 0.006;
        // Main pad voice — sine for smooth warmth
        allNotes.push({
          time: t,
          freq: base,
          dur: hold,
          wave: 'sine',
          vol: bedVol,
          pan: chordPans[c],
        });
        // Slight detune for warmth
        allNotes.push({
          time: t + 0.005,
          freq: base * 1.002,
          dur: hold * 0.88,
          wave: 'sine',
          vol: bedVol * 0.35,
          pan: chordPans[c] * 0.7,
        });
        // Upper doubling in later sections for lushness
        if (lush && c >= 2) {
          allNotes.push({
            time: t + beat * 0.5,
            freq: base * 2,
            dur: beat * 0.9,
            wave: 'sine',
            vol: 0.014 + intensity * 0.008,
            pan: -chordPans[c] * 0.5,
          });
        }
      }

      // ── Pizzicato ornaments — delicate plucked notes over chord tones ──
      // (dur <= 0.12, wave 'square' → classifies as "perc" → pizzicato_strings)
      for (let p = 0; p < 4; p++) {
        const pizzTime = t + p * beat + beat * 0.12;
        if (pizzTime >= win.end) break;
        const pizzNote = chord[p % chord.length];
        const pizzFreq = n(pizzNote);
        // Alternate pizzicato across stereo field
        const pizzPan = (p % 2 === 0 ? -1 : 1) * (0.3 + (p / 4) * 0.3);
        allNotes.push({
          time: pizzTime,
          freq: pizzFreq,
          dur: beat * 0.09,
          wave: 'square',
          vol: (0.035 + intensity * 0.025) * (lush ? 1.15 : 1),
          pan: pizzPan,
        });
      }

      // ── Sparse high pizzicato echo — second pluck on off-beats ──
      if (lush) {
        const echoTime = t + beat * 1.5 + beat * 0.12;
        if (echoTime < win.end) {
          const echoNote = chord[1] ?? chord[0];
          allNotes.push({
            time: echoTime,
            freq: n(echoNote) * 2,
            dur: beat * 0.08,
            wave: 'square',
            vol: 0.022 + intensity * 0.014,
            pan: Math.sin(echoTime * 1.7) * 0.55,
          });
        }
      }

      t += beat * 2;
      chordCursor++;
    }

    // ── Contrabass — warm, deep, centered ──
    // (freq <= 220, dur >= 0.08, vol >= 0.04 → classifies as "bass" → contrabass)
    let bassTime = win.start;
    for (const [note, steps] of section.bass) {
      const dur = steps * step;
      if (note) {
        const contraFreq = n(note) * 0.25;
        // Keep bass centered for warmth
        allNotes.push({
          time: bassTime,
          freq: contraFreq,
          dur: dur * 0.94,
          wave: 'sine',
          vol: 0.06 + intensity * 0.035,
          pan: 0,
        });
        // Cello doubling an octave above — keep vol below 0.04 so it
        // classifies as "harmony" → cello, not "bass" → contrabass.
        const celloFreq = n(note) * 0.5;
        allNotes.push({
          time: bassTime + 0.005,
          freq: celloFreq,
          dur: dur * 0.9,
          wave: 'sine',
          vol: 0.03 + intensity * 0.008,
          pan: Math.sin(bassTime * 0.9) * 0.18,
        });
      }
      bassTime += dur;
    }
  }

  const duration = melodyTime;

  // ── Gentle pizzicato heartbeat — sparse plucks at section boundaries ──
  // These give a sense of breath and phrasing between sections.
  for (let i = 1; i < sectionWindows.length; i++) {
    const boundary = sectionWindows[i].start;
    const chord = AMBIENT_SYMPHONY_SECTIONS[i].chords[0];
    const intensity = sectionIntensity(i);
    // Two soft plucks bridging sections — one left, one right
    for (let p = 0; p < 2; p++) {
      const pluckTime = Math.max(0, boundary - beat * (0.6 - p * 0.35));
      const pluckNote = chord[p % chord.length];
      allNotes.push({
        time: pluckTime,
        freq: n(pluckNote),
        dur: beat * 0.1,
        wave: 'square',
        vol: 0.03 + intensity * 0.015,
        pan: p === 0 ? -0.45 : 0.45,
      });
    }
  }

  return { duration, notes: allNotes };
}
