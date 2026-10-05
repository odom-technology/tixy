/* Pure parts of the feel kit: the pitch ladder, shake scaling, squash,
   hit-stop, rolling-number steps, sound levels and the reduced-motion paths.
   Run with `npx tsx scripts/verify-feel-kit.ts`. */

export {};

const check = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

// A fake window with a live reduced-motion query, installed before the kit
// loads so its one read of the OS setting sees it. requestIdleCallback is
// inert so SoundManager's idle warm-up never runs here.
let reducedMatches = false;
const mqlListeners = new Set<(event: { matches: boolean }) => void>();
const fakeWindow = {
  matchMedia: (query: string) => ({
    media: query,
    get matches() {
      return reducedMatches;
    },
    addEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => {
      mqlListeners.add(listener);
    },
    removeEventListener: () => undefined,
  }),
  addEventListener: () => undefined,
  requestIdleCallback: () => 0,
};
(globalThis as unknown as { window: unknown }).window = fakeWindow;

// A fake localStorage, so SoundManager's stored level can be seeded.
const storage = new Map<string, string>();
(globalThis as unknown as { localStorage: Pick<Storage, 'getItem' | 'setItem'> }).localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => {
    storage.set(key, String(value));
  },
};
/** A fresh SoundManager that reads `seed` from storage, as a new page load would. */
let soundCase = 0;
const freshSoundManager = async (seed: Record<string, string>) => {
  storage.clear();
  for (const [key, value] of Object.entries(seed)) storage.set(key, value);
  soundCase += 1;
  const loaded = (await import(
    `../src/features/arcade/lib/sound-manager.ts?case=${soundCase}`
  )) as typeof import('../src/features/arcade/lib/sound-manager');
  return loaded.SoundManager;
};
const setReduced = (value: boolean) => {
  reducedMatches = value;
  for (const listener of mqlListeners) listener({ matches: value });
};

const feel = await import('../src/features/arcade/lib/game-feel');
const feedback = await import('../src/features/arcade/lib/use-game-feedback');
const sound = await import('../src/features/arcade/lib/sound-manager');
const {
  FEEL,
  createHitStop,
  createNumberRoll,
  createPitchLadder,
  createShake,
  feelReducedMotion,
  hitStopDuration,
  rollDuration,
  rollingValueAt,
  semitonesToPitch,
  settleEase,
  shakeAmplitude,
  shakeOffsetAt,
  springEase,
  squashAt,
  squashPeak,
  subscribeReducedMotion,
} = feel;

/* Curves */
check(near(springEase(0), 0) && near(springEase(1), 1), 'spring does not start at 0 and end at 1');
let springPeak = 0;
for (let i = 0; i <= 100; i += 1) springPeak = Math.max(springPeak, springEase(i / 100));
check(springPeak > 1.02, `spring does not overshoot (peak ${springPeak})`);
let previousSettle = 0;
for (let i = 0; i <= 100; i += 1) {
  const value = settleEase(i / 100);
  check(value >= previousSettle - 1e-9 && value <= 1 + 1e-9, 'settle curve is not a monotone stop');
  previousSettle = value;
}

/* Pitch ladder */
check(near(semitonesToPitch(12), 2), 'twelve semitones is not an octave');
const ladder = createPitchLadder();
const rungs = Array.from({ length: 4 }, () => ladder.next());
check(rungs[0] === 1, 'the first success is not at base pitch');
for (let i = 1; i < rungs.length; i += 1) {
  check(near(rungs[i]! / rungs[i - 1]!, semitonesToPitch(1)), `rung ${i} is not one semitone up`);
}
check(ladder.step === 4, `ladder step is ${ladder.step} after four successes`);
ladder.reset();
check(ladder.step === 0 && ladder.next() === 1, 'reset did not return the ladder to the bottom');
const capped = createPitchLadder({ maxSteps: 3 });
const cappedRungs = Array.from({ length: 6 }, () => capped.next());
check(near(cappedRungs.at(-1)!, semitonesToPitch(3)), 'ladder climbed past maxSteps');
const octave = createPitchLadder();
let top = 0;
for (let i = 0; i < 40; i += 1) top = octave.next();
check(near(top, 2), 'default ladder does not stop at one octave');

/* Shake scaling */
check(shakeAmplitude(0) === 2 && shakeAmplitude(1) === 4, 'shake is not 2 to 4 px');
check(near(shakeAmplitude(0.5), 3), 'shake does not scale linearly with force');
check(shakeAmplitude(-3) === 2 && shakeAmplitude(9) === 4, 'shake force is not clamped');
let maxOffset = 0;
for (let t = 0; t < FEEL.shakeMs; t += 4) {
  const { x, y } = shakeOffsetAt(4, t);
  maxOffset = Math.max(maxOffset, Math.abs(x), Math.abs(y));
}
check(maxOffset <= 4 && maxOffset >= 3.5, `peak shake offset ${maxOffset} is outside 3.5 to 4 px`);
const after = shakeOffsetAt(4, FEEL.shakeMs);
check(after.x === 0 && after.y === 0, 'shake did not end at rest');
const shake = createShake({ reducedMotion: () => false });
shake.kick(1, 1000);
check(shake.active(1010) && Math.abs(shake.offset(1000).x) > 3.9, 'a full kick did not shake 4 px');
shake.kick(0, 1020);
check(Math.abs(shake.offset(1020).x) > 0 && shake.active(1100), 'a weak kick cut a strong shake short');
check(!shake.active(1000 + FEEL.shakeMs), 'shake outlived its duration');

/* Squash */
const peak = squashPeak(1);
const first = squashAt(0, { reduced: false });
check(near(first.scaleX, peak.scaleX) && near(first.scaleY, peak.scaleY), 'squash does not start at its peak');
check(first.scaleX > 1 && first.scaleY < 1, 'landing is not flat and wide');
const end = squashAt(FEEL.squashMs, { reduced: false });
check(end.scaleX === 1 && end.scaleY === 1, 'squash did not end at rest');
let stretched = false;
for (let t = 0; t < FEEL.squashMs; t += 5) {
  if (squashAt(t, { reduced: false }).scaleY > 1.001) stretched = true;
}
check(stretched, 'squash does not overshoot on the spring');
const half = squashAt(0, { reduced: false, force: 0.5 });
check(half.scaleX < peak.scaleX && half.scaleX > 1, 'squash does not scale with force');

/* Hit-stop */
check(hitStopDuration(undefined, false) === 50, 'default hit-stop is not 50 ms');
check(hitStopDuration(5, false) === 40 && hitStopDuration(500, false) === 60, 'hit-stop is not clamped to 40 to 60 ms');
const stop = createHitStop({ reducedMotion: () => false });
stop.freeze(undefined, 100);
check(stop.isFrozen(120) && !stop.isFrozen(150), 'hit-stop frozen window is wrong');
check(stop.frozenWithin(90, 130) === 30, 'frozen overlap is wrong');
check(stop.frozenWithin(160, 200) === 0, 'time after the freeze counted as frozen');
stop.freeze(60, 140);
check(stop.frozenUntil === 160, `a second freeze stacked past 60 ms (until ${stop.frozenUntil})`);

/* Rolling number steps */
const steps: number[] = [];
for (let t = 0; t <= FEEL.rollMs; t += 16) steps.push(rollingValueAt(0, 100, t));
steps.push(rollingValueAt(0, 100, FEEL.rollMs));
check(steps[0] === 0, 'roll does not start from the old value');
check(steps.at(-1) === 100, 'roll does not end on the new value');
check(steps.every((v, i) => i === 0 || v >= steps[i - 1]!), 'roll up is not monotone');
check(steps.every((v) => Number.isInteger(v)), 'roll shows fractions with 0 decimals');
check(rollingValueAt(0, 100, FEEL.rollMs / 2) > 50, 'roll does not slow to a stop');
const down = [0, 200, 400, 700].map((t) => rollingValueAt(500, 120, t));
check(down[0] === 500 && down.at(-1) === 120 && down[1]! < 500 && down[2]! >= 120, 'roll down is wrong');
check(rollingValueAt(0, 100, 10, 0) === 100, 'duration 0 does not jump');
check(rollDuration(700, false) === 700, 'roll length changed without reduced motion');
check(rollingValueAt(0, 1, 100, 700, 2) % 1 !== 0, 'decimals are not kept');

// A retarget mid-roll continues from the number on screen.
const roll = createNumberRoll(0);
roll.retarget(100, 0, FEEL.rollMs);
const midway = roll.sample(200);
check(midway > 0 && midway < 100, `roll was not midway at 200 ms (${midway})`);
roll.retarget(40, 200, FEEL.rollMs);
check(roll.sample(200) === midway, 'retarget jumped instead of continuing from the shown number');
check(roll.sample(216) <= midway, 'retarget did not head for the new value');
check(roll.sample(200 + FEEL.rollMs) === 40 && roll.done(200 + FEEL.rollMs), 'retarget did not end on the new value');
const jumpRoll = createNumberRoll(5);
jumpRoll.retarget(9, 0, 0);
check(jumpRoll.sample(0) === 9 && jumpRoll.done(0), 'duration 0 retarget did not jump');

/* Press and move never shake or freeze */
for (const event of ['press', 'move'] as const) {
  const plan = feedback.planFeedback(event, { shake: 1, hitStop: true, haptic: true });
  check(plan.shake === 0 && plan.hitStop === null && plan.juice === null, `${event} shook, froze or moved the stage`);
  check(plan.sound !== null && plan.haptic === 'tap', `${event} lost its click or tap`);
}
const impactPlan = feedback.planFeedback('impact', { shake: 0.5, hitStop: true });
check(impactPlan.shake === 0.5 && impactPlan.hitStop === undefined, 'impact did not plan shake and a default hit-stop');
check(feedback.planFeedback('jackpot', { hitStop: 55 }).hitStop === 55, 'hit-stop length was not passed on');
check(feedback.planFeedback('impact', { sound: false }).sound === null, 'sound: false still played');

/* Haptics */
check(feedback.GAME_FEEDBACK_HAPTICS.collect === 'tick', 'scoring is not a tick');
check(feedback.GAME_FEEDBACK_HAPTICS['round-win'] === 'win', 'a win is not the heavy cue');

/* Sound level */
const fresh = sound.resolveStoredSoundLevel(null, null);
check(!fresh.muted && fresh.level === 'low', 'a player who never chose is not on and low');
check(sound.resolveStoredSoundLevel('true', null).muted, 'a stored mute was not kept');
check(sound.resolveStoredSoundLevel('true', 'high').muted, 'a stored mute with a level was not kept');
const legacy = sound.resolveStoredSoundLevel('false', null);
check(!legacy.muted && legacy.level === 'high', 'a stored unmute did not keep full volume');
check(sound.resolveStoredSoundLevel('false', 'low').level === 'low', 'a stored level was ignored');

// Stored-setting migration and the off, low, high cycle, through real
// SoundManager instances reading a seeded localStorage.
const newPlayer = await freshSoundManager({});
check(newPlayer.getLevel() === 'low' && near(newPlayer.getGain(), 0.4), 'a new player is not on and low');
const cycle = [newPlayer.cycleLevel(), newPlayer.cycleLevel(), newPlayer.cycleLevel()];
check(cycle.join(' ') === 'high off low', `cycle went ${cycle.join(' ')}`);
check(storage.get('holocron_sfx_muted') === 'false' && storage.get('holocron_sfx_level') === 'low', 'cycle did not store mute and level');
newPlayer.cycleLevel();
check(newPlayer.getGain() === 1, 'high is not full gain');
newPlayer.cycleLevel();
check(newPlayer.getGain() === 0 && newPlayer.isMuted(), 'off is not silent');
const reloaded = await freshSoundManager(Object.fromEntries(storage));
check(reloaded.getLevel() === 'off', 'off did not survive a reload');
check(reloaded.cycleLevel() === 'low', 'off did not step to low');
const mutedBefore = await freshSoundManager({ holocron_sfx_muted: 'true' });
check(mutedBefore.getLevel() === 'off', 'a stored mute from before levels was not kept');
const unmutedBefore = await freshSoundManager({ holocron_sfx_muted: 'false' });
check(unmutedBefore.getLevel() === 'high', 'a stored unmute from before levels did not keep full volume');
check(unmutedBefore.cycleLevel() === 'off', 'high did not step to off');

/* Reduced motion: read once, kept live */
check(feelReducedMotion() === false, 'reduced motion read wrong');
let notified = 0;
const unsubscribe = subscribeReducedMotion(() => {
  notified += 1;
});
setReduced(true);
check(feelReducedMotion() === true && notified === 1, 'reduced motion did not follow the OS change');
const reducedShake = createShake();
reducedShake.kick(1, 0);
check(!reducedShake.active(10) && reducedShake.offset(10).x === 0, 'shake ran under reduced motion');
const reducedSquash = squashAt(0);
check(reducedSquash.scaleX === 1 && reducedSquash.scaleY === 1, 'squash ran under reduced motion');
check(rollDuration(700) === 0, 'roll did not jump to the end under reduced motion');
check(hitStopDuration(50, true) === 0, 'hit-stop was not 0 under reduced motion');
const reducedStop = createHitStop();
reducedStop.freeze(50, 0);
check(!reducedStop.isFrozen(10), 'hit-stop froze under reduced motion');
setReduced(false);
check(feelReducedMotion() === false && notified === 2, 'reduced motion did not follow the OS back');
unsubscribe();

// The canvas callout follows the CSS one. calloutFrameAt is the `tx-callout`
// keyframe stop for stop: read the stops out of the stylesheet and compare.
{
  const { readFileSync } = await import('node:fs');
  const motion = await import('../src/features/arcade/components/gameplay/callout-motion');
  const css = readFileSync('src/features/arcade/components/gameplay/gameplay-feedback.css', 'utf8');
  const keyframes = css.match(/@keyframes tx-callout \{([\s\S]*?)\n\}/)?.[1] ?? '';
  const stops = [...keyframes.matchAll(/(\d+)%\s*\{([^}]*)\}/g)].map((m) => ({
    at: Number(m[1]) / 100,
    opacity: Number(/opacity:\s*([\d.]+)/.exec(m[2]!)?.[1] ?? Number.NaN),
    ty: Number(/translate\(-50%,\s*(-?[\d.]+)%\)/.exec(m[2]!)?.[1] ?? Number.NaN),
    scale: Number(/scale\(([\d.]+)\)/.exec(m[2]!)?.[1] ?? 1),
  }));
  check(stops.length === 4, 'tx-callout lost a keyframe stop');
  check(stops[1]!.at === motion.CALLOUT_STOPS.in && stops[2]!.at === motion.CALLOUT_STOPS.hold, 'callout stops moved in the CSS');
  for (const stop of stops) {
    const frame = motion.calloutFrameAt(stop.at);
    // translateY is -50% at rest; lift is the offset from there, in plate heights.
    check(near(frame.lift, stop.ty / 100 + 0.5, 1e-9), `callout lift at ${stop.at} is ${frame.lift}, css has ${stop.ty / 100 + 0.5}`);
    if (!Number.isNaN(stop.opacity)) check(near(frame.opacity, stop.opacity, 1e-9), `callout opacity at ${stop.at}`);
    if (stop.at < 0.5) check(near(frame.scale, stop.at === 0 ? stop.scale : 1, 1e-9), `callout scale at ${stop.at}`);
  }
  const mid = motion.calloutFrameAt(0.4);
  check(mid.opacity === 1 && mid.scale === 1 && mid.lift < 0 && mid.lift > -0.06, 'the hold should drift up a little');
  const reduced = motion.calloutFrameAt(0.5, true);
  check(reduced.lift === 0 && reduced.scale === 1, 'a reduced-motion callout moved');
  check(near(motion.calloutFrameAt(0, true).opacity, 0) && near(motion.calloutFrameAt(0.2, true).opacity, 1) && near(motion.calloutFrameAt(1, true).opacity, 0), 'reduced fade is not 0, 1, 0');
  check(motion.calloutLifeMs(true) === motion.CALLOUT_REDUCED_MS && motion.calloutLifeMs(false) === motion.CALLOUT_MS, 'callout life under reduced motion');
  check(motion.isNumericLabel('+10') && motion.isNumericLabel(40) && !motion.isNumericLabel('fast rows'), 'numeric label test');
  check(motion.calloutFontPx(true, 390) === 20 && motion.calloutFontPx(true, 1280) === 26 && motion.calloutFontPx(false, 390) === 16, 'callout type size');
}

{
  const { isNewBest } = await import('../src/features/arcade/lib/new-best');
  check(!isNewBest(0, 0) && isNewBest(10, 0) && !isNewBest(10, 10) && isNewBest(11, 10), 'isNewBest rule');
  check(!isNewBest(Number.NaN, 0), 'isNewBest took NaN');
}

console.log('feel kit invariants passed');
