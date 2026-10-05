import type { TrackData } from '../_tetris-music-score';
import {
  TETRIS_THEME_BPM,
  TETRIS_THEME_CHIPTUNE_FORM,
  n,
  type TrackNote,
} from '../_tetris-music-score';

// ---------------------------------------------------------------------------
// Track 4: "Chiptune" — Extended NES-style (~77s loop)
// Multi-section arcade arrangement with evolving intensity.
// ---------------------------------------------------------------------------
export function chiptuneTrack(): TrackData {
  const bpm = TETRIS_THEME_BPM;
  const beat = 60 / bpm;
  const step = beat / 2;
  const allNotes: TrackNote[] = [];
  const semitoneMul = (semitones: number) => Math.pow(2, semitones / 12);
  // Modulate up for a focused middle section, then resolve back home.
  const chiptuneKeyShift = (sectionIdx: number): number => {
    if (sectionIdx === 5 || sectionIdx === 9) return 1; // pivot sections
    if (sectionIdx >= 6 && sectionIdx <= 8) return 2; // temporary key change
    return 0; // original key
  };
  const addKeyTransitionPickup = (
    time: number,
    fromShift: number,
    toShift: number,
  ) => {
    const fromMul = semitoneMul(fromShift);
    const toMul = semitoneMul(toShift);
    if (toShift > fromShift) {
      allNotes.push({
        time: Math.max(0, time - step * 0.5),
        freq: n('E5') * fromMul,
        dur: step * 0.34,
        wave: 'square',
        vol: 0.09,
      });
      allNotes.push({
        time: Math.max(0, time - step * 0.25),
        freq: n('G5') * toMul,
        dur: step * 0.34,
        wave: 'square',
        vol: 0.105,
      });
      allNotes.push({
        time,
        freq: n('A5') * toMul,
        dur: step * 0.4,
        wave: 'square',
        vol: 0.11,
      });
      return;
    }
    allNotes.push({
      time: Math.max(0, time - step * 0.5),
      freq: n('G5') * fromMul,
      dur: step * 0.34,
      wave: 'square',
      vol: 0.09,
    });
    allNotes.push({
      time: Math.max(0, time - step * 0.25),
      freq: n('F5') * fromMul,
      dur: step * 0.34,
      wave: 'square',
      vol: 0.095,
    });
    allNotes.push({
      time,
      freq: n('E5') * toMul,
      dur: step * 0.4,
      wave: 'square',
      vol: 0.1,
    });
  };

  const sectionWindows: {
    start: number;
    end: number;
    index: number;
    keyShift: number;
  }[] = [];
  let melodyTime = 0;
  for (let i = 0; i < TETRIS_THEME_CHIPTUNE_FORM.length; i++) {
    const section = TETRIS_THEME_CHIPTUNE_FORM[i];
    const start = melodyTime;
    const introArcade = i < 2;
    const higherPulse = i >= 4;
    const keyShift = chiptuneKeyShift(i);
    const keyMul = semitoneMul(keyShift);
    for (const [note, steps] of section.melody) {
      const dur = steps * step;
      if (note) {
        const freq = n(note) * keyMul;
        const leadFreq = freq;
        const leadGate = introArcade ? 0.66 : higherPulse ? 0.82 : 0.86;
        const leadVol = introArcade ? 0.32 : higherPulse ? 0.35 : 0.31;
        allNotes.push({
          time: melodyTime,
          freq: leadFreq,
          dur: dur * leadGate,
          wave: 'square',
          vol: leadVol,
        });
        allNotes.push({
          time: melodyTime + 0.0015,
          freq: leadFreq * 2,
          dur: Math.max(step * 0.2, dur * 0.38),
          wave: 'square',
          vol: introArcade ? 0.11 : 0.085,
        });
        if (introArcade) {
          allNotes.push({
            time: melodyTime + Math.min(step * 0.24, dur * 0.28),
            freq: leadFreq,
            dur: Math.max(step * 0.22, dur * 0.22),
            wave: 'square',
            vol: 0.11,
          });
          if (steps >= 2) {
            allNotes.push({
              time: melodyTime + dur * 0.54,
              freq: leadFreq * 2,
              dur: step * 0.3,
              wave: 'square',
              vol: 0.075,
            });
            allNotes.push({
              time: melodyTime + dur * 0.72,
              freq: leadFreq,
              dur: step * 0.24,
              wave: 'square',
              vol: 0.065,
            });
          }
        } else {
          allNotes.push({
            time: melodyTime,
            freq: freq * 0.5,
            dur: dur * 0.72,
            wave: 'square',
            vol: 0.1,
          });
        }
        if (i >= 2) {
          allNotes.push({
            time: melodyTime + dur * 0.5,
            freq: freq * 2,
            dur: dur * 0.28,
            wave: 'square',
            vol: higherPulse ? 0.095 : 0.075,
          });
        }
      }
      melodyTime += dur;
    }
    sectionWindows.push({ start, end: melodyTime, index: i, keyShift });
  }

  for (let i = 1; i < sectionWindows.length; i++) {
    const prev = sectionWindows[i - 1];
    const current = sectionWindows[i];
    if (current.keyShift !== prev.keyShift) {
      addKeyTransitionPickup(current.start, prev.keyShift, current.keyShift);
    }
  }

  for (let i = 0; i < TETRIS_THEME_CHIPTUNE_FORM.length; i++) {
    const section = TETRIS_THEME_CHIPTUNE_FORM[i];
    const introArcade = i < 2;
    const keyMul = semitoneMul(sectionWindows[i].keyShift);
    let t = sectionWindows[i].start;
    for (const [note, steps] of section.bass) {
      const dur = steps * step;
      if (note) {
        if (introArcade) {
          const root = n(note) * 0.25 * keyMul;
          for (let s = 0; s < steps; s++) {
            const tt = t + s * step;
            allNotes.push({
              time: tt,
              freq: s % 2 === 0 ? root : root * 2,
              dur: step * 0.46,
              wave: 'square',
              vol: 0.2,
            });
          }
        } else {
          allNotes.push({
            time: t,
            freq: n(note) * 0.5 * keyMul,
            dur: dur * 0.84,
            wave: i % 2 === 0 ? 'triangle' : 'square',
            vol: i >= 5 ? 0.29 : 0.24,
          });
        }
      }
      t += dur;
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
    const introChip = secIdx < 2;
    if (introChip) {
      allNotes.push({
        time: t,
        freq: 122,
        freqEnd: 56,
        dur: beat * 0.12,
        wave: 'square',
        vol: 0.1,
      });
      for (let h = 0; h < 4; h++) {
        allNotes.push({
          time: t + h * beat * 0.25,
          freq: 4200,
          freqEnd: 2600,
          dur: beat * 0.03,
          wave: 'square',
          vol: 0.032,
        });
      }
    } else if (b % 2 === 0) {
      allNotes.push({
        time: t,
        freq: 95,
        freqEnd: 46,
        dur: beat * 0.16,
        wave: 'square',
        vol: secIdx >= 4 ? 0.14 : 0.12,
      });
    }
    if (b % 4 === 1 || b % 4 === 3) {
      allNotes.push({
        time: t,
        freq: introChip ? 280 : 240,
        freqEnd: introChip ? 150 : 120,
        dur: beat * 0.08,
        wave: 'square',
        vol: introChip ? 0.1 : secIdx >= 4 ? 0.1 : 0.08,
      });
    }
    allNotes.push({
      time: t + beat * 0.5,
      freq: introChip ? 4100 : secIdx >= 5 ? 3600 : 3200,
      freqEnd: introChip ? 2400 : 1900,
      dur: beat * 0.05,
      wave: 'square',
      vol: introChip ? 0.06 : 0.05,
    });
    if (secIdx >= 3 && b % 8 === 7) {
      allNotes.push({
        time: t + beat * 0.75,
        freq: 560,
        freqEnd: 340,
        dur: beat * 0.1,
        wave: 'square',
        vol: 0.08,
      });
    }
  }

  return { duration, notes: allNotes };
}

