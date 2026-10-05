/* The floor games whose art is a kit screen (kit.tsx): each has a still (the
   resting frame) and one move that plays once on a pointer or focus. */
export const STILL_SLUGS: readonly string[] = [
  '2048',
  '21',
  '8-ball',
  'bumper-cars',
  'chess',
  'coin-pusher',
  'connect-four',
  'flappy-bird',
  'high-striker',
  'lucky-cage',
  'mines',
  'mini-golf',
  'plinko',
  'prize-claw',
  'ricochet',
  'ring-toss',
  'derby',
  'skee-ball',
  'slots',
  'snake',
  'stack',
  'ticket-stop',
  'tin-duck',
  'trick-shot',
  'video-poker',
  'word-grid',
];

export function hasGameStill(slug: string): boolean {
  return STILL_SLUGS.includes(slug);
}
