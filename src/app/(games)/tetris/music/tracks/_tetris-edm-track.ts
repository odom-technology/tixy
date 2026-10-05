import type { TrackData } from '../_tetris-music-score';
import {
  TETRIS_THEME_BASS_A,
  TETRIS_THEME_BASS_A_BRIDGE,
  TETRIS_THEME_BASS_B,
  TETRIS_THEME_BASS_B_BRIDGE,
  TETRIS_THEME_BASS_C,
  TETRIS_THEME_BASS_C_BRIDGE,
  TETRIS_THEME_BPM,
  TETRIS_THEME_PHRASE_A,
  TETRIS_THEME_PHRASE_A_BRIDGE,
  TETRIS_THEME_PHRASE_B,
  TETRIS_THEME_PHRASE_B_BRIDGE,
  TETRIS_THEME_PHRASE_C,
  TETRIS_THEME_PHRASE_C_BRIDGE,
  n,
  type StepNote,
  type TrackNote,
} from '../_tetris-music-score';

// ---------------------------------------------------------------------------
// Track 3: "EDM Bass Boost" — precision remix mapping
// Same exact melody tempo/octaves/phrasing as classic, with EDM layers.
// ---------------------------------------------------------------------------
export function edmBassTrack(): TrackData {
  const bpm = TETRIS_THEME_BPM;
  const beat = 60 / bpm;
  const step = beat / 2; // eighth-note grid (same as classic)
  const allNotes: TrackNote[] = [];

  // Slow autopan LFO for lead melody — sweeps L↔R at ~0.3 Hz
  const leadPan = (t: number) => Math.sin(t * 2 * Math.PI * 0.3) * 0.55;

  const addLead = (
    phrase: StepNote[],
    startTime: number,
    opts: {
      vol: number;
      gate: number;
      wave: OscillatorType;
      layered: boolean;
      octaveAccent: boolean;
    },
  ) => {
    let t = startTime;
    for (const [note, steps] of phrase) {
      const dur = steps * step;
      if (note) {
        const freq = n(note);
        const lp = leadPan(t);
        allNotes.push({
          time: t,
          freq,
          dur: dur * opts.gate,
          wave: opts.wave,
          vol: opts.vol,
          pan: lp,
        });
        if (opts.layered) {
          // Detuned layers hard-panned left/right for width
          allNotes.push({
            time: t + 0.002,
            freq: freq * 1.005,
            dur: dur * (opts.gate * 0.95),
            wave: 'sawtooth',
            vol: opts.vol * 0.55,
            pan: -0.6,
          });
          allNotes.push({
            time: t + 0.004,
            freq: freq * 0.995,
            dur: dur * (opts.gate * 0.95),
            wave: 'sawtooth',
            vol: opts.vol * 0.55,
            pan: 0.6,
          });
        }
        if (opts.octaveAccent) {
          // Octave accent on opposite side of lead for stereo contrast
          allNotes.push({
            time: t,
            freq: freq * 2,
            dur: Math.min(beat * 0.3, dur * 0.4),
            wave: 'square',
            vol: opts.vol * 0.22,
            pan: -lp * 0.7,
          });
        }
      }
      t += dur;
    }
    return t;
  };

  const renderPhrases = (
    phrases: StepNote[][],
    startTime: number,
    opts: {
      vol: number;
      gate: number;
      wave: OscillatorType;
      layered: boolean;
      octaveAccent: boolean;
    },
  ) => {
    let t = startTime;
    for (const phrase of phrases) {
      t = addLead(phrase, t, opts);
    }
    return t;
  };

  const sections: Array<{
    id: string;
    phase: 'intro' | 'break' | 'build' | 'drop';
    phrases: StepNote[][];
    bassPhrases: StepNote[][];
    lead: {
      vol: number;
      gate: number;
      wave: OscillatorType;
      layered: boolean;
      octaveAccent: boolean;
    };
    energy: number;
    buildStrength?: number;
    dropStrength?: number;
  }> = [
    {
      id: 'intro',
      phase: 'intro',
      phrases: [TETRIS_THEME_PHRASE_A],
      bassPhrases: [TETRIS_THEME_BASS_A],
      lead: {
        vol: 0.15,
        gate: 0.86,
        wave: 'square',
        layered: false,
        octaveAccent: false,
      },
      energy: 0.34,
    },
    {
      id: 'build-1',
      phase: 'build',
      phrases: [TETRIS_THEME_PHRASE_A_BRIDGE],
      bassPhrases: [TETRIS_THEME_BASS_A_BRIDGE],
      lead: {
        vol: 0.19,
        gate: 0.82,
        wave: 'triangle',
        layered: false,
        octaveAccent: true,
      },
      energy: 0.56,
      buildStrength: 0.78,
    },
    {
      id: 'drop-1',
      phase: 'drop',
      phrases: [TETRIS_THEME_PHRASE_A, TETRIS_THEME_PHRASE_B],
      bassPhrases: [TETRIS_THEME_BASS_A, TETRIS_THEME_BASS_B],
      lead: {
        vol: 0.32,
        gate: 0.72,
        wave: 'sawtooth',
        layered: true,
        octaveAccent: true,
      },
      energy: 1.12,
      dropStrength: 1.05,
    },
    {
      id: 'break-1',
      phase: 'break',
      phrases: [TETRIS_THEME_PHRASE_C],
      bassPhrases: [TETRIS_THEME_BASS_C],
      lead: {
        vol: 0.13,
        gate: 0.86,
        wave: 'triangle',
        layered: false,
        octaveAccent: false,
      },
      energy: 0.28,
    },
    {
      id: 'drop-2',
      phase: 'drop',
      phrases: [TETRIS_THEME_PHRASE_A_BRIDGE, TETRIS_THEME_PHRASE_B],
      bassPhrases: [TETRIS_THEME_BASS_A_BRIDGE, TETRIS_THEME_BASS_B],
      lead: {
        vol: 0.35,
        gate: 0.7,
        wave: 'sawtooth',
        layered: true,
        octaveAccent: true,
      },
      energy: 1.24,
      dropStrength: 1.12,
    },
    {
      id: 'build-2',
      phase: 'build',
      phrases: [TETRIS_THEME_PHRASE_C_BRIDGE],
      bassPhrases: [TETRIS_THEME_BASS_C_BRIDGE],
      lead: {
        vol: 0.17,
        gate: 0.82,
        wave: 'triangle',
        layered: false,
        octaveAccent: true,
      },
      energy: 0.62,
      buildStrength: 1.05,
    },
    {
      id: 'mega-build',
      phase: 'build',
      phrases: [TETRIS_THEME_PHRASE_B_BRIDGE, TETRIS_THEME_PHRASE_C_BRIDGE],
      bassPhrases: [TETRIS_THEME_BASS_B_BRIDGE, TETRIS_THEME_BASS_C_BRIDGE],
      lead: {
        vol: 0.22,
        gate: 0.78,
        wave: 'triangle',
        layered: true,
        octaveAccent: true,
      },
      energy: 0.76,
      buildStrength: 1.45,
    },
    {
      id: 'mega-drop',
      phase: 'drop',
      phrases: [TETRIS_THEME_PHRASE_A_BRIDGE, TETRIS_THEME_PHRASE_B_BRIDGE],
      bassPhrases: [TETRIS_THEME_BASS_A_BRIDGE, TETRIS_THEME_BASS_B_BRIDGE],
      lead: {
        vol: 0.42,
        gate: 0.68,
        wave: 'sawtooth',
        layered: true,
        octaveAccent: true,
      },
      energy: 1.58,
      dropStrength: 1.45,
    },
    {
      id: 'break-2',
      phase: 'break',
      phrases: [TETRIS_THEME_PHRASE_C],
      bassPhrases: [TETRIS_THEME_BASS_C],
      lead: {
        vol: 0.15,
        gate: 0.84,
        wave: 'triangle',
        layered: false,
        octaveAccent: false,
      },
      energy: 0.34,
    },
    {
      id: 'final-drop',
      phase: 'drop',
      phrases: [TETRIS_THEME_PHRASE_B, TETRIS_THEME_PHRASE_A_BRIDGE],
      bassPhrases: [TETRIS_THEME_BASS_B, TETRIS_THEME_BASS_A_BRIDGE],
      lead: {
        vol: 0.38,
        gate: 0.7,
        wave: 'sawtooth',
        layered: true,
        octaveAccent: true,
      },
      energy: 1.34,
      dropStrength: 1.2,
    },
  ];

  const EDM_CHORDS: string[][] = [
    ['A4', 'C5', 'E5'],
    ['F4', 'A4', 'C5'],
    ['C4', 'E4', 'G4'],
    ['G4', 'B4', 'D5'],
  ];
  const getEdmChordAtTime = (time: number): string[] => {
    const chordIdx =
      Math.floor(Math.max(0, time) / (beat * 2)) % EDM_CHORDS.length;
    return EDM_CHORDS[chordIdx];
  };
  const edgeBlend = (time: number, start: number, end: number): number => {
    const edge = beat * 0.75;
    if (end - start <= edge * 1.5) return 1;
    const inGain = Math.min(1, Math.max(0, (time - start) / edge));
    const outGain = Math.min(1, Math.max(0, (end - time) / edge));
    return Math.max(0.56, Math.min(inGain, outGain));
  };

  const sectionWindows: Array<{
    id: string;
    phase: 'intro' | 'break' | 'build' | 'drop';
    start: number;
    end: number;
    energy: number;
    bassPattern: StepNote[];
    buildStrength: number;
    dropStrength: number;
  }> = [];
  let songEnd = 0;
  for (const section of sections) {
    const start = songEnd;
    songEnd = renderPhrases(section.phrases, songEnd, section.lead);
    const bassPattern = section.bassPhrases.flatMap((phrase) => phrase);
    sectionWindows.push({
      id: section.id,
      phase: section.phase,
      start,
      end: songEnd,
      energy: section.energy,
      bassPattern,
      buildStrength: section.buildStrength ?? 0.7,
      dropStrength: section.dropStrength ?? 1,
    });
  }

  const addBassRegion = (
    start: number,
    end: number,
    pattern: StepNote[],
    opts: {
      midVol: number;
      subVol: number;
      wave: OscillatorType;
      gate: number;
      subGate: number;
      drop: boolean;
    },
  ) => {
    if (pattern.length === 0) return;
    let t = start;
    let i = 0;
    while (t < end) {
      const [note, steps] = pattern[i % pattern.length];
      const dur = steps * step;
      if (note) {
        const blend = edgeBlend(t, start, end);
        const midFreq = n(note) * 0.25;
        allNotes.push({
          time: t,
          freq: midFreq,
          dur: dur * opts.gate,
          wave: opts.wave,
          vol: opts.midVol * blend,
          pan: 0,
        });
        allNotes.push({
          time: t,
          freq: midFreq * 0.5,
          freqEnd: midFreq * 0.46,
          dur: dur * opts.subGate,
          wave: 'sine',
          vol: opts.subVol * blend,
          pan: 0,
        });
        if (opts.drop && i % 4 === 0) {
          allNotes.push({
            time: t,
            freq: midFreq * 0.5,
            freqEnd: midFreq * 0.42,
            dur: Math.min(beat * 0.95, dur * 1.35),
            wave: 'triangle',
            vol: opts.subVol * 0.5 * blend,
            pan: 0,
          });
        }
      }
      t += dur;
      i++;
    }
  };

  const addDrumsRegion = (
    start: number,
    end: number,
    opts: {
      kickVol: number;
      hatVol: number;
      snareVol: number;
      phase: 'intro' | 'break' | 'build' | 'drop';
    },
  ) => {
    let t = start;
    let beatIndex = 0;
    while (t < end) {
      const blend = edgeBlend(t, start, end);
      const isDrop = opts.phase === 'drop';
      const isBreak = opts.phase === 'break';
      // Ping-pong hat pan: alternates L/R each beat
      const hatPan = beatIndex % 2 === 0 ? -0.72 : 0.72;
      // Snare slight alternating offset
      const snarePan = beatIndex % 4 === 1 ? 0.15 : -0.15;
      const playMainKick = !isBreak || beatIndex % 2 === 0;
      if (playMainKick) {
        allNotes.push({
          time: t,
          freq: 112,
          freqEnd: 31,
          dur: beat * 0.36,
          wave: 'sine',
          vol: opts.kickVol * blend,
          pan: 0,
        });
        allNotes.push({
          time: t,
          freq: 1650,
          freqEnd: 760,
          dur: beat * 0.038,
          wave: 'square',
          vol: opts.kickVol * 0.34 * blend,
          pan: 0,
        });
      }
      allNotes.push({
        time: t + beat * 0.5,
        freq: 3000,
        freqEnd: 1650,
        dur: beat * 0.075,
        wave: 'square',
        vol: (isBreak ? opts.hatVol * 0.72 : opts.hatVol) * blend,
        pan: hatPan,
      });
      if (isDrop) {
        allNotes.push({
          time: t + beat * 0.5,
          freq: 110,
          freqEnd: 36,
          dur: beat * 0.2,
          wave: 'sine',
          vol: opts.kickVol * 0.46 * blend,
          pan: 0,
        });
        // Off-beat hat on opposite side
        allNotes.push({
          time: t + beat * 0.75,
          freq: 3900,
          freqEnd: 2300,
          dur: beat * 0.05,
          wave: 'square',
          vol: opts.hatVol * 0.9 * blend,
          pan: -hatPan,
        });
      }
      const playSnare = isBreak
        ? beatIndex % 4 === 3
        : beatIndex % 4 === 1 || beatIndex % 4 === 3;
      if (playSnare) {
        allNotes.push({
          time: t,
          freq: 220,
          freqEnd: 90,
          dur: beat * 0.16,
          wave: 'square',
          vol: (isBreak ? opts.snareVol * 0.8 : opts.snareVol) * blend,
          pan: snarePan,
        });
        allNotes.push({
          time: t + beat * 0.01,
          freq: 1950,
          freqEnd: 820,
          dur: beat * 0.06,
          wave: 'sawtooth',
          vol: opts.snareVol * 0.5 * blend,
          pan: snarePan * 1.4,
        });
      }
      if (isDrop && beatIndex % 4 === 2) {
        allNotes.push({
          time: t + beat * 0.75,
          freq: 96,
          freqEnd: 34,
          dur: beat * 0.24,
          wave: 'sine',
          vol: opts.kickVol * 0.52 * blend,
          pan: 0.08,
        });
      }
      t += beat;
      beatIndex++;
    }
  };

  const addSupersawDropLayer = (
    start: number,
    end: number,
    intensity: number,
  ) => {
    let t = start;
    while (t < end) {
      const chord = getEdmChordAtTime(t);
      const blend = edgeBlend(t, start, end);
      for (const note of chord) {
        const f = n(note);
        // 3 detuned voices spread wide across the stereo field
        allNotes.push({
          time: t + beat * 0.5,
          freq: f * 0.995,
          dur: beat * 0.9,
          wave: 'sawtooth',
          vol: 0.09 * intensity * blend,
          pan: -0.7,
        });
        allNotes.push({
          time: t + beat * 0.5 + 0.002,
          freq: f,
          dur: beat * 0.9,
          wave: 'sawtooth',
          vol: 0.1 * intensity * blend,
          pan: 0,
        });
        allNotes.push({
          time: t + beat * 0.5 + 0.004,
          freq: f * 1.005,
          dur: beat * 0.9,
          wave: 'sawtooth',
          vol: 0.09 * intensity * blend,
          pan: 0.7,
        });
      }
      t += beat * 2;
    }
  };

  const addChordStabs = (start: number, end: number, vol: number) => {
    let t = start;
    while (t < end) {
      const chord = getEdmChordAtTime(t);
      const stabTime = t + beat * 0.5;
      const blend = edgeBlend(stabTime, start, end);
      // Fan chord notes across the stereo field
      const panSpread = [-0.55, 0, 0.55];
      for (let ci = 0; ci < chord.length; ci++) {
        allNotes.push({
          time: stabTime,
          freq: n(chord[ci]),
          dur: beat * 0.34,
          wave: 'sawtooth',
          vol: vol * blend,
          pan: panSpread[ci % panSpread.length],
        });
      }
      t += beat * 2;
    }
  };

  const addBoundaryGlue = (
    transitionTime: number,
    fromPhase: 'intro' | 'break' | 'build' | 'drop',
    toPhase: 'intro' | 'break' | 'build' | 'drop',
  ) => {
    if (toPhase === 'break') {
      allNotes.push({
        time: Math.max(0, transitionTime - beat * 0.6),
        freq: 2500,
        freqEnd: 480,
        dur: beat * 0.7,
        wave: 'sawtooth',
        vol: 0.06,
        pan: 0.5,
      });
      return;
    }
    if (toPhase === 'build' && fromPhase !== 'break') {
      allNotes.push({
        time: Math.max(0, transitionTime - beat * 0.5),
        freq: 380,
        freqEnd: 690,
        dur: beat * 0.55,
        wave: 'triangle',
        vol: 0.055,
        pan: -0.4,
      });
      return;
    }
    if (fromPhase === 'break' && toPhase === 'drop') {
      allNotes.push({
        time: Math.max(0, transitionTime - beat * 0.25),
        freq: 1800,
        freqEnd: 720,
        dur: beat * 0.28,
        wave: 'square',
        vol: 0.065,
        pan: -0.6,
      });
    }
  };

  const addDropFill = (dropStart: number, hasBeatDropImpact: boolean) => {
    const fillStart = Math.max(0, dropStart - beat * 2);
    const sixteenth = beat * 0.25;
    for (let i = 0; i < 8; i++) {
      const p = i / 7;
      // Rapid L/R alternation that narrows toward the drop
      const fillPan = (i % 2 === 0 ? -1 : 1) * (0.7 - p * 0.35);
      allNotes.push({
        time: fillStart + i * sixteenth,
        freq: 200 + p * 260,
        freqEnd: 120 + p * 190,
        dur: sixteenth * 0.62,
        wave: 'square',
        vol: 0.06 + p * 0.08,
        pan: fillPan,
      });
      if (i % 2 === 1) {
        allNotes.push({
          time: fillStart + i * sixteenth,
          freq: 2600 + p * 1000,
          freqEnd: 1700 + p * 600,
          dur: sixteenth * 0.42,
          wave: 'sawtooth',
          vol: 0.04 + p * 0.04,
          pan: -fillPan,
        });
      }
    }
    // Sub impact — skip if addBeatDropImpact will fire its own bigger sub
    if (!hasBeatDropImpact) {
      allNotes.push({
        time: dropStart,
        freq: 62,
        freqEnd: 28,
        dur: beat * 1.15,
        wave: 'sine',
        vol: 0.78,
        pan: 0,
      });
    }
    // Crash cymbal for every drop — wider on mega-drops
    allNotes.push({
      time: dropStart,
      freq: hasBeatDropImpact ? 4200 : 3400,
      freqEnd: hasBeatDropImpact ? 800 : 620,
      dur: beat * (hasBeatDropImpact ? 0.5 : 0.38),
      wave: 'sawtooth',
      vol: hasBeatDropImpact ? 0.14 : 0.1,
      pan: 0.55,
    });
  };

  const addRiser = (dropStart: number, strength: number) => {
    const riserStart = Math.max(0, dropStart - beat * 4);
    for (let i = 0; i < 8; i++) {
      const p = i / 7;
      // Sweep from left to right as the riser builds
      const riserPan = -0.8 + p * 1.6;
      allNotes.push({
        time: riserStart + i * (beat * 0.5),
        freq: 260 + p * (920 + strength * 80),
        freqEnd: 480 + p * (1320 + strength * 120),
        dur: beat * 0.5,
        wave: 'sawtooth',
        vol: 0.05 + p * (0.05 + strength * 0.01),
        pan: riserPan,
      });
    }
  };

  const addBuildRoll = (start: number, end: number, baseVol: number) => {
    const sixteenth = beat * 0.25;
    if (end <= start + sixteenth) return;
    let t = start;
    let i = 0;
    while (t < end) {
      const p = (t - start) / (end - start);
      if (i % 2 === 0 || p > 0.6) {
        // Alternate L/R, widening as energy builds
        const rollPan = (i % 2 === 0 ? -1 : 1) * (0.25 + p * 0.55);
        allNotes.push({
          time: t,
          freq: 240 + p * 240,
          freqEnd: 130 + p * 120,
          dur: sixteenth * 0.52,
          wave: 'square',
          vol: baseVol + p * 0.06,
          pan: rollPan,
        });
      }
      t += sixteenth;
      i++;
    }
  };

  const addBuildUpLayer = (start: number, end: number, strength: number) => {
    const sixteenth = beat * 0.25;
    if (end <= start + sixteenth * 4) return;

    let t = start;
    while (t < end) {
      const p = (t - start) / Math.max(sixteenth, end - start);
      const interval =
        p < 0.45 ? beat * 0.5 : p < 0.78 ? sixteenth : sixteenth * 0.5;
      const dur = Math.max(sixteenth * 0.2, interval * 0.45);
      // Spiraling autopan that speeds up with intensity
      const buildPan =
        Math.sin(t * 2 * Math.PI * (1 + p * 3)) * (0.35 + p * 0.5);
      allNotes.push({
        time: t,
        freq: 260 + p * (680 + strength * 180),
        freqEnd: 130 + p * (250 + strength * 90),
        dur,
        wave: 'square',
        vol: 0.032 + p * (0.07 + strength * 0.014),
        pan: buildPan,
      });
      if (p > 0.55) {
        allNotes.push({
          time: t,
          freq: 2400 + p * 1300,
          freqEnd: 1300 + p * 700,
          dur: dur * 0.65,
          wave: 'sawtooth',
          vol: 0.03 + p * 0.05,
          pan: -buildPan,
        });
      }
      t += interval;
    }

    // Final snare roll before the drop.
    const rollStart = Math.max(start, end - beat * (2.5 + strength * 0.8));
    let rollTime = rollStart;
    let hit = 0;
    while (rollTime < end) {
      const p = (rollTime - rollStart) / Math.max(sixteenth, end - rollStart);
      // Snare roll alternates L/R, widening as it accelerates
      const rollPan = (hit % 2 === 0 ? -1 : 1) * (0.3 + p * 0.55);
      allNotes.push({
        time: rollTime,
        freq: 220 + p * 320,
        freqEnd: 90 + p * 180,
        dur: sixteenth * 0.44,
        wave: 'square',
        vol: 0.05 + p * (0.09 + strength * 0.01),
        pan: rollPan,
      });
      allNotes.push({
        time: rollTime + 0.004,
        freq: 2100 + p * 1100,
        freqEnd: 980 + p * 650,
        dur: sixteenth * 0.26,
        wave: 'sawtooth',
        vol: 0.03 + p * 0.045,
        pan: rollPan * 0.8,
      });
      rollTime += hit > 8 ? sixteenth * 0.5 : sixteenth;
      hit++;
    }
  };

  const addBeatDropImpact = (dropStart: number, strength: number) => {
    // Sub impact — dead center
    allNotes.push({
      time: dropStart,
      freq: 58,
      freqEnd: 24,
      dur: beat * 1.6,
      wave: 'sine',
      vol: Math.min(0.96, 0.8 + strength * 0.08),
      pan: 0,
    });
    // Mid layer — slight left
    allNotes.push({
      time: dropStart + 0.01,
      freq: 150,
      freqEnd: 44,
      dur: beat * 0.54,
      wave: 'triangle',
      vol: 0.24 + strength * 0.05,
      pan: -0.25,
    });
    // Crash splash — wide right
    allNotes.push({
      time: dropStart + 0.016,
      freq: 3800,
      freqEnd: 720,
      dur: beat * 0.46,
      wave: 'sawtooth',
      vol: 0.17 + strength * 0.03,
      pan: 0.6,
    });
    // Secondary sub hit
    allNotes.push({
      time: dropStart + beat * 0.5,
      freq: 94,
      freqEnd: 30,
      dur: beat * 0.36,
      wave: 'sine',
      vol: 0.38 + strength * 0.05,
      pan: 0,
    });
  };

  const addBreakAtmosphere = (start: number, end: number) => {
    let t = start;
    while (t < end) {
      const chord = getEdmChordAtTime(t);
      const blend = edgeBlend(t, start, end);
      // Soft filtered pad — long sustain, gentle stereo spread
      const padPans = [-0.35, 0, 0.35];
      for (let ci = 0; ci < chord.length; ci++) {
        const f = n(chord[ci]);
        allNotes.push({
          time: t,
          freq: f * 0.5,
          dur: beat * 3.6,
          wave: 'sine',
          vol: 0.03 * blend,
          pan: padPans[ci % padPans.length],
        });
        allNotes.push({
          time: t + 0.005,
          freq: f * 0.5 * 1.002,
          dur: beat * 3.2,
          wave: 'triangle',
          vol: 0.018 * blend,
          pan: padPans[ci % padPans.length] * 0.6,
        });
      }
      t += beat * 4;
    }
  };

  const addDropPumpLayer = (start: number, end: number, intensity: number) => {
    let t = start;
    let pumpIdx = 0;
    while (t < end) {
      // Slow side-to-side sway for sub pump
      const pumpPan = Math.sin(t * 2 * Math.PI * 0.4) * 0.18;
      allNotes.push({
        time: t + beat * 0.5,
        freq: 78,
        freqEnd: 32,
        dur: beat * 0.34,
        wave: 'sine',
        vol: 0.2 + intensity * 0.04,
        pan: pumpPan,
      });
      // Click transient — alternating sides
      allNotes.push({
        time: t + beat * 0.5,
        freq: 2600,
        freqEnd: 1300,
        dur: beat * 0.05,
        wave: 'square',
        vol: 0.05 + intensity * 0.01,
        pan: pumpIdx % 2 === 0 ? -0.55 : 0.55,
      });
      if (((t - start) / beat) % 2 >= 1) {
        allNotes.push({
          time: t + beat * 0.75,
          freq: 128,
          freqEnd: 48,
          dur: beat * 0.16,
          wave: 'triangle',
          vol: 0.08 + intensity * 0.02,
          pan: -pumpPan * 1.5,
        });
      }
      t += beat;
      pumpIdx++;
    }
  };

  for (let i = 0; i < sectionWindows.length; i++) {
    const section = sectionWindows[i];
    const drop = section.phase === 'drop';
    const build = section.phase === 'build';
    const bassWave: OscillatorType = drop
      ? 'sawtooth'
      : section.energy < 0.55
        ? 'triangle'
        : 'sawtooth';
    addBassRegion(section.start, section.end, section.bassPattern, {
      midVol:
        0.16 + section.energy * 0.5 + (drop ? section.dropStrength * 0.04 : 0),
      subVol:
        0.24 + section.energy * 0.55 + (drop ? section.dropStrength * 0.03 : 0),
      wave: bassWave,
      gate: drop ? 0.6 : build ? 0.52 : 0.54,
      subGate: drop ? 0.9 : build ? 0.7 : 0.76,
      drop,
    });
    addDrumsRegion(section.start, section.end, {
      kickVol:
        0.18 + section.energy * 0.58 + (drop ? section.dropStrength * 0.05 : 0),
      hatVol:
        0.035 +
        section.energy * 0.095 +
        (build ? section.buildStrength * 0.01 : 0),
      snareVol:
        0.03 +
        section.energy * 0.13 +
        (build ? section.buildStrength * 0.014 : 0),
      phase: section.phase,
    });
    if (drop) {
      addChordStabs(
        section.start,
        section.end,
        0.12 + section.energy * 0.04 + section.dropStrength * 0.02,
      );
      addSupersawDropLayer(
        section.start,
        section.end,
        0.76 + section.energy * 0.24 + section.dropStrength * 0.1,
      );
      if (section.dropStrength >= 1.3) {
        addDropPumpLayer(section.start, section.end, section.dropStrength);
      }
    } else if (build) {
      addChordStabs(
        section.start,
        section.end,
        0.08 + section.buildStrength * 0.015,
      );
      addBuildRoll(
        section.start,
        section.end,
        0.05 + section.buildStrength * 0.016,
      );
      addBuildUpLayer(section.start, section.end, section.buildStrength);
    } else if (section.phase === 'break') {
      addBreakAtmosphere(section.start, section.end);
    } else if (section.energy >= 0.45) {
      addChordStabs(section.start, section.end, 0.08);
    }

    if (i > 0) {
      const prev = sectionWindows[i - 1];
      addBoundaryGlue(section.start, prev.phase, section.phase);
      if (drop && prev.phase !== 'drop') {
        const hasMegaImpact = section.dropStrength >= 1.3;
        addDropFill(section.start, hasMegaImpact);
        addRiser(section.start, section.energy + section.dropStrength * 0.24);
        if (section.dropStrength >= 1.3) {
          addBeatDropImpact(section.start, section.dropStrength);
        }
      }
    }
  }

  return { duration: songEnd, notes: allNotes };
}
