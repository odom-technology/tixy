/* The resting frames of the floor games, drawn on the server. The home page
   renders these into the page, so first paint carries 21 small SVGs and no
   game module ships to the browser. Client code that needs one later (the ?
   sheet, the no-WebGL picture) uses game-still.tsx, which loads a single
   game's screen on demand. */
import type { ReactNode } from 'react';

import S2048 from './2048';
import S21 from './21';
import S8_ball from './8-ball';
import Sbumper_cars from './bumper-cars';
import Schess from './chess';
import Scoin_pusher from './coin-pusher';
import Sconnect_four from './connect-four';
import Sflappy_bird from './flappy-bird';
import Shigh_striker from './high-striker';
import Slucky_cage from './lucky-cage';
import Smines from './mines';
import Smini_golf from './mini-golf';
import Splinko from './plinko';
import Sprize_claw from './prize-claw';
import Sricochet from './ricochet';
import Sring_toss from './ring-toss';
import Sderby from './derby';
import Sskee_ball from './skee-ball';
import Sslots from './slots';
import Ssnake from './snake';
import Sstack from './stack';
import Sticket_stop from './ticket-stop';
import Stin_duck from './tin-duck';
import Strick_shot from './trick-shot';
import Svideo_poker from './video-poker';
import Sword_grid from './word-grid';

export const FLOOR_STILLS: Record<string, ReactNode> = {
  '2048': <S2048 still />,
  '21': <S21 still />,
  '8-ball': <S8_ball still />,
  'bumper-cars': <Sbumper_cars still />,
  'chess': <Schess still />,
  'coin-pusher': <Scoin_pusher still />,
  'connect-four': <Sconnect_four still />,
  'flappy-bird': <Sflappy_bird still />,
  'high-striker': <Shigh_striker still />,
  'lucky-cage': <Slucky_cage still />,
  'mines': <Smines still />,
  'mini-golf': <Smini_golf still />,
  'plinko': <Splinko still />,
  'prize-claw': <Sprize_claw still />,
  'ricochet': <Sricochet still />,
  'ring-toss': <Sring_toss still />,
  derby: <Sderby still />,
  'skee-ball': <Sskee_ball still />,
  'slots': <Sslots still />,
  'snake': <Ssnake still />,
  'stack': <Sstack still />,
  'ticket-stop': <Sticket_stop still />,
  'tin-duck': <Stin_duck still />,
  'trick-shot': <Strick_shot still />,
  'video-poker': <Svideo_poker still />,
  'word-grid': <Sword_grid still />,
};
