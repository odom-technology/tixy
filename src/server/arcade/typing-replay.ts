/**
 * Server-side typing test replay engine.
 *
 * Given a seeded word list and the raw keystroke sequence recorded during
 * gameplay, replays the typing session to compute correct/incorrect chars,
 * WPM, raw WPM, and accuracy — independently of any client-claimed values.
 */

import { generateSeededWords } from '@/features/arcade/lib/typing-words';

const MAX_EXTRA_CHARS = 24;
export const TYPING_PREV_WORD_TOKEN = '__typing_prev_word__';

export interface TypingReplayResult {
  correctChars: number;
  incorrectChars: number;
  totalChars: number;
  wordsCompleted: number;
  wpm: number;
  rawWpm: number;
  accuracy: number;
}

/**
 * Replays a typing session from raw keystrokes against the seeded word list.
 *
 * Keystroke encoding:
 *  - Regular character: the character itself (e.g. 'a', 'b', ' ')
 *  - Backspace: '\b'
 *  - Space (word submit): ' '
 *
 * The replay mirrors the client-side scoring logic exactly:
 *  - When space is pressed, the current input is compared to the current word
 *  - Each matching character position = correct, each mismatch = incorrect
 *  - Untyped characters in the word = incorrect
 *  - Extra characters beyond the word = incorrect
 *  - If the typed word matches perfectly, the space counts as correct; otherwise incorrect
 */
export function replayTypingSession(
  seed: number,
  keystrokes: string[],
  modeDurationSec: number,
): TypingReplayResult {
  const words = generateSeededWords(seed, 200);
  const wordInputHistory = new Map<number, string>();

  let currentWordIndex = 0;
  let currentInput = '';
  let correctChars = 0;
  let incorrectChars = 0;
  let wordsCompleted = 0;

  for (const key of keystrokes) {
    if (currentWordIndex >= words.length) break;

    const currentWord = words[currentWordIndex];

    if (key === TYPING_PREV_WORD_TOKEN) {
      // Mirrors client behavior when backspacing at the start of a word:
      // jump to the previous word and restore previously submitted input.
      if (currentWordIndex > 0) {
        currentWordIndex -= 1;
        currentInput = wordInputHistory.get(currentWordIndex) ?? '';
      }
      continue;
    }

    if (key === '\b') {
      // Backspace: remove last character from current input
      if (currentInput.length > 0) {
        currentInput = currentInput.slice(0, -1);
      }
      continue;
    }

    if (key === ' ') {
      // Space: submit current word
      const typedWord = currentInput;

      let wordCorrect = 0;
      let wordIncorrect = 0;

      for (
        let i = 0;
        i < Math.max(typedWord.length, currentWord.length);
        i++
      ) {
        if (i < typedWord.length && i < currentWord.length) {
          if (typedWord[i] === currentWord[i]) {
            wordCorrect++;
          } else {
            wordIncorrect++;
          }
        } else if (i < typedWord.length) {
          wordIncorrect++;
        } else {
          wordIncorrect++;
        }
      }

      // Count space as correct if word was perfect
      if (typedWord === currentWord) {
        wordCorrect++;
      } else {
        wordIncorrect++;
      }

      correctChars += wordCorrect;
      incorrectChars += wordIncorrect;
      wordsCompleted++;
      wordInputHistory.set(currentWordIndex, typedWord);
      currentWordIndex++;
      currentInput = '';
      continue;
    }

    // Regular character: append to current input (capped at word length + MAX_EXTRA_CHARS)
    const maxLength = (words[currentWordIndex]?.length ?? 0) + MAX_EXTRA_CHARS;
    if (currentInput.length < maxLength) {
      currentInput += key;
    }
  }

  const totalChars = correctChars + incorrectChars;
  const minutesDuration = modeDurationSec / 60;
  const wpm =
    minutesDuration > 0 ? Math.round(correctChars / 5 / minutesDuration) : 0;
  const rawWpm =
    minutesDuration > 0 ? Math.round(totalChars / 5 / minutesDuration) : 0;
  const accuracy = totalChars > 0 ? (correctChars / totalChars) * 100 : 0;

  return {
    correctChars,
    incorrectChars,
    totalChars,
    wordsCompleted,
    wpm,
    rawWpm,
    accuracy,
  };
}
