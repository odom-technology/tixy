import type { TrackData } from '../_tetris-music-score';
import {
  TETRIS_THEME_BPM,
  TETRIS_THEME_ORIGINAL_FORM,
  n,
  type TrackNote,
} from '../_tetris-music-score';

// ---------------------------------------------------------------------------
// Track 1: "Classic" — original A-Type soundtrack loop
// Canonical section order/phrasing only (no bridge extensions).
// ---------------------------------------------------------------------------
export function classicTrack(): TrackData {
  const bpm = TETRIS_THEME_BPM;
  const beat = 60 / bpm;
  const step = beat / 2; // eighth-note grid
  const allNotes: TrackNote[] = [];

  let melodyTime = 0;
  let counterTime = 0;
  let bassTime = 0;

  for (const section of TETRIS_THEME_ORIGINAL_FORM) {
    for (const [note, steps] of section.melody) {
      const dur = steps * step;
      if (note) {
        const freq = n(note);
        allNotes.push({
          time: melodyTime,
          freq,
          dur: dur * 0.92,
          wave: 'square',
          vol: 0.41,
        });
        // Subtle second pulse layer to preserve classic 8-bit texture.
        allNotes.push({
          time: counterTime,
          freq: freq * 0.5,
          dur: dur * 0.85,
          wave: 'square',
          vol: 0.12,
        });
      }
      melodyTime += dur;
      counterTime += dur;
    }

    for (const [note, steps] of section.bass) {
      const dur = steps * step;
      if (note) {
        allNotes.push({
          time: bassTime,
          freq: n(note) * 0.5,
          dur: dur * 0.9,
          wave: 'triangle',
          vol: 0.34,
        });
      }
      bassTime += dur;
    }
  }

  const duration = Math.max(melodyTime, counterTime, bassTime);
  return { duration, notes: allNotes };
}
