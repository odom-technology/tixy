'use client';

/* Friends beside the table, with what they are playing. Anyone waiting for
   you gets a button: accept a challenge, join a friend's open table, or play
   your move. A wagered match shows its stake on the line and the button, and
   asks before it joins, because joining holds the stake. */

import Link from 'next/link';

import { getArcadeGameBySlug } from '@/features/arcade/components/arcade-game-registry';
import { displayAvatarUrl } from '@/features/users/avatars';
import { Num } from '@/features/arcade/components/ui/arcade-ui';

import type { HomeFriend, HomeMatchGame, HomeOnNow, HomeWaiting } from './tixy-home-types';
import { useJoinMatch } from './use-join-match';
import { renamedPath } from '@/features/arcade/lib/game-renames';

export const GAME_NAME: Record<HomeMatchGame, string> = {
  '8-ball': '8-ball',
  chess: 'chess',
  'connect-four': 'connect four',
};

export function gameName(slug: string | null) {
  if (!slug) return null;
  if (slug in GAME_NAME) return GAME_NAME[slug as HomeMatchGame];
  const game = getArcadeGameBySlug(slug);
  return game ? game.title.toLowerCase() : null;
}

function Avatar({ name, imageUrl, waiting }: { name: string; imageUrl?: string | null; waiting?: boolean }) {
  return (
    <span className='tx-av' data-waiting={waiting || undefined} aria-hidden='true'>
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- user avatars come from any host
        <img src={displayAvatarUrl(imageUrl)} alt='' loading='lazy' />
      ) : (
        name.slice(0, 1).toLowerCase()
      )}
    </span>
  );
}

/* "50 ticket 8-ball table open, hardcore", "wants a rematch at chess". */
export function waitingLine(entry: HomeWaiting) {
  const game = GAME_NAME[entry.game];
  const hardcore = entry.hardcore ? ', hardcore' : '';
  if (entry.wager) {
    return (
      <>
        <Num className='tx-num' value={entry.wager} /> ticket {game} {entry.kind === 'table' ? 'table open' : 'wager'}
        {hardcore}
      </>
    );
  }
  if (entry.kind === 'table') return `${game} table open${hardcore}`;
  if (entry.rematch) return `wants a rematch at ${game}${hardcore}`;
  return `challenged you to ${game}${hardcore}`;
}

export function joinVerb(entry: HomeWaiting) {
  return entry.kind === 'invite' ? 'accept' : 'join';
}

function friendLine(friend: HomeFriend) {
  if (friend.status === 'in_game') {
    const game = gameName(friend.gameSlug);
    return game ? `playing ${game}` : 'playing';
  }
  if (friend.status === 'away') return 'away';
  return 'on the floor';
}

function WaitingRow({ entry, arrived, onGone }: { entry: HomeWaiting; arrived: boolean; onGone: () => void }) {
  const { busy, confirming, error, start, confirm, cancel } = useJoinMatch(entry, onGone);
  const invite = entry.kind === 'invite';
  const verb = joinVerb(entry);
  const game = GAME_NAME[entry.game];
  return (
    <>
      <div className='tx-who' data-arrived={arrived || undefined}>
        <Avatar name={entry.name} waiting={invite} />
        <div>
          <strong>
            {entry.name}
            {invite ? <i className='tx-dot' aria-hidden='true' /> : null}
          </strong>
          <small>{waitingLine(entry)}</small>
        </div>
        {confirming ? null : (
          <button
            type='button'
            className='tx-btn tx-accept'
            data-size='sm'
            data-tone={invite ? undefined : 'quiet'}
            data-busy={busy || undefined}
            disabled={busy}
            onClick={start}
            aria-label={`${verb} ${entry.name}, ${game}${entry.wager ? `, stakes ${entry.wager} tickets` : ''}`}
          >
            <span>
              {busy ? 'joining' : verb}
              {entry.wager && !busy ? (
                <>
                  {' '}
                  <Num className='tx-num' value={entry.wager} />
                </>
              ) : null}
            </span>
          </button>
        )}
      </div>
      {confirming ? (
        <div className='tx-confirm' role='group' aria-label={`${verb} a ${entry.wager} ticket match`}>
          <p>
            This holds <Num className='tx-num' value={entry.wager ?? 0} /> of your tickets until the match ends.
          </p>
          <div>
            <button type='button' className='tx-btn tx-accept' data-size='sm' data-busy={busy || undefined} disabled={busy} onClick={() => void confirm()}>
              <span>{busy ? 'joining' : 'stake it'}</span>
            </button>
            <button type='button' className='tx-btn' data-size='sm' data-tone='quiet' disabled={busy} onClick={cancel}>
              cancel
            </button>
          </div>
        </div>
      ) : null}
      {error ? (
        <p role='alert' className='tx-who-error'>
          {error}
        </p>
      ) : null}
    </>
  );
}

export function HomeOnNowPanel({
  onNow,
  signedIn,
  arrivedIds,
  onStale,
}: {
  onNow: HomeOnNow | null;
  signedIn: boolean;
  arrivedIds: ReadonlySet<string>;
  onStale: () => void;
}) {
  if (!signedIn) {
    return (
      <section className='tx-panel' aria-labelledby='tx-on-now'>
        <h2 id='tx-on-now'>on now</h2>
        <p className='tx-panel-note'>Sign in to see your friends here, and who is waiting for you.</p>
        <Link href='/signin?next=%2F' className='tx-btn' data-size='sm'>
          sign in
        </Link>
      </section>
    );
  }
  if (!onNow) {
    return (
      <section className='tx-panel' aria-labelledby='tx-on-now'>
        <h2 id='tx-on-now'>on now</h2>
        <p className='tx-panel-note'>Friends are not loading right now.</p>
      </section>
    );
  }

  const waitingIds = new Set(onNow.waiting.map((entry) => entry.userId));
  const turnNames = new Set(onNow.turns.map((entry) => entry.opponent));
  const others = onNow.friends.filter((friend) => !waitingIds.has(friend.userId) && !turnNames.has(friend.name));
  const empty = onNow.waiting.length === 0 && onNow.turns.length === 0 && others.length === 0;

  return (
    <section className='tx-panel' aria-labelledby='tx-on-now'>
      <h2 id='tx-on-now'>
        on now
        {onNow.friendCount > 0 ? (
          <small>
            <Num value={onNow.onlineCount} /> of <Num value={onNow.friendCount} />{' '}
            {onNow.friendCount === 1 ? 'friend' : 'friends'}
          </small>
        ) : null}
      </h2>
      <div aria-live='polite'>
        {onNow.waiting.map((entry) => (
          <WaitingRow key={entry.matchId} entry={entry} arrived={arrivedIds.has(entry.matchId)} onGone={onStale} />
        ))}
      </div>
      {onNow.turns.map((turn) => (
        <div key={turn.matchId} className='tx-who'>
          <Avatar name={turn.opponent} />
          <div>
            <strong>{turn.opponent}</strong>
            <small>your move in {GAME_NAME[turn.game]}</small>
          </div>
          <Link
            href={renamedPath(`/${turn.game}/${turn.matchId}`)}
            className='tx-btn'
            data-size='sm'
            aria-label={`play your move against ${turn.opponent}, ${GAME_NAME[turn.game]}`}
          >
            play
          </Link>
        </div>
      ))}
      {others.map((friend) => (
        <div key={friend.userId} className='tx-who'>
          <Avatar name={friend.name} imageUrl={friend.imageUrl} />
          <div>
            <strong>{friend.name}</strong>
            <small>{friendLine(friend)}</small>
          </div>
        </div>
      ))}
      {empty ? (
        onNow.friendCount === 0 ? (
          <>
            <p className='tx-panel-note'>Add friends to see what they are playing.</p>
            <Link href='/friends' className='tx-btn' data-size='sm' data-tone='quiet'>
              find friends
            </Link>
          </>
        ) : (
          <p className='tx-panel-note'>
            {onNow.friendCount === 1 ? (
              'Your friend is not on right now.'
            ) : (
              <>
                None of your <Num value={onNow.friendCount} /> friends are on right now.
              </>
            )}
          </p>
        )
      ) : null}
    </section>
  );
}
