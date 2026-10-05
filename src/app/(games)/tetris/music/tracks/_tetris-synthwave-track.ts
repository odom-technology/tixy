import type { TrackData } from '../_tetris-music-score';
import {
  TETRIS_THEME_BPM,
  TETRIS_THEME_SYNTHWAVE_FORM,
  n,
  type TrackNote,
} from '../_tetris-music-score';

// ---------------------------------------------------------------------------
// Track 2: "Synthwave" — Extended retrowave (~77s loop)
// Am-F-C-G progression with arpeggios, bass, kicks, and a lead melody
// ---------------------------------------------------------------------------
export function synthwaveTrack(): TrackData {
  const bpm = TETRIS_THEME_BPM;
  const beat = 60 / bpm;
  const step = beat / 2;
  const allNotes: TrackNote[] = [];

  const sectionWindows: { start: number; end: number; index: number }[] = [];
  let melodyTime = 0;
  for (let i = 0; i < TETRIS_THEME_SYNTHWAVE_FORM.length; i++) {
    const section = TETRIS_THEME_SYNTHWAVE_FORM[i];
    const start = melodyTime;
    const breakdown = i === 4;
    const finale = i >= 6;
    for (const [note, steps] of section.melody) {
      const dur = steps * step;
      if (note) {
        const freq = n(note);
        const leadWave: OscillatorType = breakdown ? 'triangle' : 'square';
        const leadVol = finale ? 0.22 : breakdown ? 0.14 : 0.19;
        allNotes.push({
          time: melodyTime,
          freq,
          dur: dur * 0.74,
          wave: leadWave,
          vol: leadVol,
        });
        allNotes.push({
          time: melodyTime + 0.0018,
          freq: freq * 0.998,
          dur: dur * 0.76,
          wave: 'triangle',
          vol: leadVol * 0.34,
        });
        if (i >= 2) {
          allNotes.push({
            time: melodyTime + step * 0.5,
            freq: freq * 0.5,
            dur: Math.max(step * 0.24, dur * 0.28),
            wave: 'square',
            vol: 0.045,
          });
        }
        if (finale && steps >= 2) {
          allNotes.push({
            time: melodyTime,
            freq: freq * 2,
            dur: Math.min(step * 1.05, dur * 0.32),
            wave: 'triangle',
            vol: 0.055,
          });
        }
      }
      melodyTime += dur;
    }
    sectionWindows.push({ start, end: melodyTime, index: i });
  }

  for (let i = 0; i < TETRIS_THEME_SYNTHWAVE_FORM.length; i++) {
    const section = TETRIS_THEME_SYNTHWAVE_FORM[i];
    let t = sectionWindows[i].start;
    for (const [note, steps] of section.bass) {
      const dur = steps * step;
      if (note) {
        const mid = n(note) * 0.5;
        const bassVol = i >= 6 ? 0.28 : i >= 3 ? 0.25 : 0.22;
        allNotes.push({
          time: t,
          freq: mid,
          dur: dur * 0.62,
          wave: i === 4 ? 'triangle' : 'square',
          vol: bassVol,
        });
        allNotes.push({
          time: t + step * 0.25,
          freq: mid * 2,
          dur: dur * 0.32,
          wave: 'triangle',
          vol: bassVol * 0.2,
        });
      }
      t += dur;
    }
  }

  const synthChords: string[][] = [
    ['A4', 'C5', 'E5'],
    ['F4', 'A4', 'C5'],
    ['C4', 'E4', 'G4'],
    ['G4', 'B4', 'D5'],
  ];
  for (let i = 0; i < sectionWindows.length; i++) {
    const win = sectionWindows[i];
    const chord = synthChords[i % synthChords.length];
    let t = win.start;
    while (t < win.end) {
      const staccato = i === 4 || i === 5;
      const chordDur = staccato ? beat * 0.68 : beat * 1.15;
      for (const note of chord) {
        allNotes.push({
          time: t + beat * 0.5,
          freq: n(note),
          dur: chordDur,
          wave: 'triangle',
          vol: staccato ? 0.045 : 0.07,
        });
      }
      const arp = [chord[0], chord[1], chord[2], chord[1]];
      for (let a = 0; a < arp.length; a++) {
        allNotes.push({
          time: t + a * step * 0.5,
          freq: n(arp[a]) * (i >= 6 ? 2 : 1),
          dur: step * 0.4,
          wave: 'square',
          vol: i === 4 ? 0.045 : 0.07,
        });
      }
      t += beat * 2;
    }
  }

  const duration = melodyTime;
  let sectionPtr = 0;
  for (let b = 0; b < duration / beat; b++) {
    const t = b * beat;
    while (
      sectionPtr < sectionWindows.length - 1 &&
      t >= sectionWindows[sectionPtr].end
    )
      sectionPtr++;
    const secIdx = sectionWindows[sectionPtr].index;
    const energy = secIdx >= 6 ? 1 : secIdx >= 3 ? 0.84 : 0.66;
    const breakdown = secIdx === 4;

    allNotes.push({
      time: t,
      freq: 96,
      freqEnd: 45,
      dur: beat * 0.24,
      wave: 'triangle',
      vol: breakdown ? 0.12 : 0.16 * energy,
    });
    allNotes.push({
      time: t + beat * 0.5,
      freq: 2500,
      freqEnd: 1700,
      dur: beat * 0.05,
      wave: 'square',
      vol: breakdown ? 0.03 : 0.05,
    });
    if (b % 4 === 1 || b % 4 === 3) {
      allNotes.push({
        time: t,
        freq: 180,
        freqEnd: 110,
        dur: beat * 0.1,
        wave: 'square',
        vol: breakdown ? 0.03 : 0.065,
      });
    }
    if (!breakdown && secIdx >= 2) {
      allNotes.push({
        time: t + beat * 0.5,
        freq: 1900,
        freqEnd: 1200,
        dur: beat * 0.045,
        wave: 'square',
        vol: 0.03 + secIdx * 0.002,
      });
    }
  }

  return { duration, notes: allNotes };
}

