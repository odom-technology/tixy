'use client';

/* The players page: one list, friends first. Requests waiting for you, then
   friends who are on now (live), then the rest of your friends, then
   everyone else. Search narrows the list as you type and asks the server
   for more after a pause. */

import Link from 'next/link';
import { Search } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { Num } from '@/features/arcade/components/ui/num';
import { FriendActionBar, type FriendRelationship } from '@/features/social/friend-action-bar';
import { useFriendPresence, useOnlineFriends } from '@/features/social/presence/presence-client';
import { presenceLine } from '@/features/social/presence-line';
import { ProfileAvatar } from '@/features/users/components/profile-avatar';

import '@/features/social/tixy-people.css';

export type DirectoryPlayer = {
  id: string;
  name: string;
  imageUrl: string | null;
  href: string;
  level: number;
  /** Their favourite game, or the one they play most. */
  game: string | null;
  relationship: Exclude<FriendRelationship, { status: 'self' }>;
};

const SEARCH_DELAY_MS = 350;

export function PlayerDirectory({
  players,
  query,
  currentUserId,
  viewerKind,
}: {
  players: DirectoryPlayer[];
  query: string;
  currentUserId: string | null;
  viewerKind: 'account' | 'guest' | 'visitor';
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [text, setText] = useState(query);
  const typed = useRef(false);
  const online = useOnlineFriends();

  useEffect(() => {
    if (!typed.current) return;
    const value = text.trim();
    const timer = window.setTimeout(() => {
      router.replace(value ? `${pathname}?q=${encodeURIComponent(value)}` : pathname, { scroll: false });
    }, SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [pathname, router, text]);

  const needle = text.trim().toLowerCase();
  const shown = useMemo(
    () => players.filter((player) => !needle || player.name.toLowerCase().includes(needle)),
    [needle, players],
  );
  const onlineIds = useMemo(() => new Set(online.map((presence) => presence.userId)), [online]);
  const byName = (a: DirectoryPlayer, b: DirectoryPlayer) => a.name.localeCompare(b.name);
  const requests = shown.filter((player) => player.relationship.status === 'incoming').sort(byName);
  const friends = shown.filter((player) => player.relationship.status === 'friends');
  const onNow = friends.filter((player) => onlineIds.has(player.id)).sort(byName);
  const offline = friends.filter((player) => !onlineIds.has(player.id)).sort(byName);
  const everyone = shown.filter((player) => player.relationship.status === 'none' || player.relationship.status === 'outgoing');
  const friendCount = players.filter((player) => player.relationship.status === 'friends').length;

  const row = (player: DirectoryPlayer, line: ReactNode) => (
    <div key={player.id} className='tp-row'>
      <Link href={player.href} tabIndex={-1} aria-hidden className='inline-flex rounded-full'>
        <ProfileAvatar name={player.name} imageUrl={player.imageUrl} size='lg' />
      </Link>
      <Link href={player.href} className='tp-row-main'>
        <strong>{player.name}</strong>
        <small>{line}</small>
      </Link>
      <FriendActionBar
        compact
        currentUserId={currentUserId}
        targetUserId={player.id}
        targetName={player.name}
        viewerKind={viewerKind}
        initialRelationship={player.relationship}
        profileHref={player.href}
        onChange={() => router.refresh()}
      />
    </div>
  );

  const levelLine = (player: DirectoryPlayer) => (
    <>
      level <Num className='tp-num' value={player.level} />
      {player.game ? ` · ${player.game}` : ''}
    </>
  );

  return (
    <div className='tp tp-page'>
      <h1 className='tp-title'>
        players
        {friendCount ? (
          <small>
            <Num value={onNow.length} /> of <Num value={friendCount} /> friends on
          </small>
        ) : null}
      </h1>

      <label className='tp-search' style={{ maxWidth: '36rem' }}>
        <Search size={18} strokeWidth={2} strokeLinecap='square' aria-hidden />
        <span className='tp-sr'>find a player</span>
        <input
          type='search'
          value={text}
          onChange={(event) => {
            typed.current = true;
            setText(event.target.value);
          }}
          placeholder='find a player'
          autoComplete='off'
          enterKeyHint='search'
        />
      </label>

      <div className='tp-players-cols'>
        <div className='tp-players'>
          {requests.length ? (
            <section className='tp-panel' aria-labelledby='tp-p-requests'>
              <h2 id='tp-p-requests'>
                requests <small><Num value={requests.length} /></small>
              </h2>
              {requests.map((player) => row(player, 'wants to be friends'))}
            </section>
          ) : null}

          {viewerKind === 'account' ? (
            <section className='tp-panel' aria-labelledby='tp-p-on'>
              <h2 id='tp-p-on'>
                on now
                {friendCount ? <small><Num value={onNow.length} /></small> : null}
              </h2>
              {onNow.length ? (
                onNow.map((player) => <OnlineRow key={player.id} player={player} render={row} />)
              ) : (
                <p className='tp-note'>
                  {friendCount === 0
                    ? 'Add a friend below to see when they are on.'
                    : needle
                      ? 'No friend on now by that name.'
                      : 'None of your friends are on right now.'}
                </p>
              )}
            </section>
          ) : null}

          {offline.length ? (
            <section className='tp-panel' aria-labelledby='tp-p-friends'>
              <h2 id='tp-p-friends'>
                friends <small><Num value={offline.length} /></small>
              </h2>
              {offline.map((player) => <OfflineRow key={player.id} player={player} render={row} level={levelLine(player)} />)}
            </section>
          ) : null}
        </div>

        <section className='tp-panel' aria-labelledby='tp-p-everyone'>
          <h2 id='tp-p-everyone'>
            {needle ? 'matches' : 'newest'}
            <small><Num value={everyone.length} /></small>
          </h2>
          {viewerKind !== 'account' ? (
            <p className='tp-note'>
              <Link href='/signin?next=%2Fplayers'>Sign in</Link> to add friends and see who is on.
            </p>
          ) : null}
          {everyone.length ? (
            everyone.map((player) => row(player, levelLine(player)))
          ) : (
            <p className='tp-note'>{needle ? 'No player by that name.' : 'No one else here yet.'}</p>
          )}
        </section>
      </div>
    </div>
  );
}

function OnlineRow({
  player,
  render,
}: {
  player: DirectoryPlayer;
  render: (player: DirectoryPlayer, line: ReactNode) => ReactNode;
}) {
  const presence = useFriendPresence(player.id);
  return <>{render(player, presenceLine(presence))}</>;
}

function OfflineRow({
  player,
  render,
  level,
}: {
  player: DirectoryPlayer;
  render: (player: DirectoryPlayer, line: ReactNode) => ReactNode;
  level: ReactNode;
}) {
  const presence = useFriendPresence(player.id);
  return (
    <>
      {render(
        player,
        <>
          {level}
          {presence?.lastSeenAt ? ` · ${presenceLine(presence)}` : ''}
        </>,
      )}
    </>
  );
}
