/** Shared, deterministic rules. Keep this module free of browser and server APIs. */
export const RULES_VERSION = 1;
export const ROUNDS = 8;
export const SYMBOLS = ['Circle', 'Square', 'Triangle', 'Star'] as const;

export function createPattern(seed: number): number[] {
  if (!Number.isInteger(seed) || seed < 0 || seed >= 2 ** 31) {
    throw new Error('Invalid pattern seed.');
  }
  let state = seed;
  return Array.from({ length: ROUNDS }, () => {
    // Fixed integer operations produce the same pattern in Node and the browser.
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state >>> 30;
  });
}

export function readChoices(value: unknown): number[] {
  if (!Array.isArray(value) || value.length !== ROUNDS) {
    throw new Error(`Submit exactly ${ROUNDS} choices.`);
  }
  // Array.from visits holes as undefined, unlike Array.every on sparse arrays.
  const choices = Array.from(value);
  if (!choices.every((choice) => Number.isInteger(choice) && choice >= 0 && choice < SYMBOLS.length)) {
    throw new Error('Each choice must be a symbol index from 0 to 3.');
  }
  return choices;
}

export function replayPattern(seed: number, value: unknown): { score: number } {
  const choices = readChoices(value);
  const pattern = createPattern(seed);
  return { score: choices.reduce((score, choice, round) => score + (choice === pattern[round] ? 100 : 0), 0) };
}
