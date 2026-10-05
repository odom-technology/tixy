'use client';

/* Under the cabinet (beside it on a wide screen): play now, practice and
   invite, then the lobby itself (the lanes, the code, start and leave).
   The gate's line sits under the stage. Labels lowercase, sentences end
   with a full stop, numbers as numbers. */

import { SignInLine } from '@/features/arcade/components/shell/sign-in-prompt';
import { ArcadeButton, Num } from '@/features/arcade/components/ui/arcade-ui';
import { DERBY_LANE_COLORS, DERBY_LANES } from '@/features/arcade/lib/derby';

import type { DerbyInvite, DerbySnapshotView } from './_race-net';

type Props = {
  signedIn: boolean;
  accountId: string | null;
  online: { raceId: string; snap: DerbySnapshotView; invite: DerbyInvite | null } | null;
  racing: boolean;
  pending: string | null;
  error: string | null;
  onPlayNow: () => void;
  onPractice: () => void;
  onInvite: () => void;
  onStart: () => void;
  onLeave: () => void;
};

export function DerbyLobby({
  signedIn,
  accountId,
  online,
  racing,
  pending,
  error,
  onPlayNow,
  onPractice,
  onInvite,
  onStart,
  onLeave,
}: Props) {
  const snap = online?.snap ?? null;
  const lobby = snap?.status === 'lobby' ? snap : null;

  if (racing && snap && snap.status === 'running') {
    return (
      <div className='dr-lobby' data-surface='paper'>
        <div className='dr-lobby-row'>
          <p className='dr-lobby-line'>Leaving forfeits this race.</p>
          <ArcadeButton onClick={onLeave} disabled={pending !== null}>
            leave
          </ArcadeButton>
        </div>
      </div>
    );
  }

  if (lobby) {
    const isHost = lobby.hostUserId === accountId;
    const people = lobby.lanes.filter((l) => l.kind === 'human').length;
    const invite = online?.invite ?? null;
    return (
      <div className='dr-lobby' data-surface='paper'>
        <h2 className='dr-lobby-title'>
          <Num value={people} /> of <Num value={DERBY_LANES} /> lanes taken
        </h2>
        <ol className='dr-lanes' aria-label='lanes'>
          {Array.from({ length: DERBY_LANES }, (_, lane) => {
            const row = lobby.lanes.find((l) => l.lane === lane);
            return (
              <li key={lane} className='dr-lane' data-open={!row || undefined}>
                <span
                  className='dr-lane-pip'
                  style={{ background: DERBY_LANE_COLORS[lane]!.silk, color: DERBY_LANE_COLORS[lane]!.ink }}
                >
                  {lane + 1}
                </span>
                <span className='dr-lane-name'>
                  {row ? (row.userId === accountId ? `${row.name} (you)` : row.name) : 'open'}
                </span>
              </li>
            );
          })}
        </ol>
        {invite && isHost ? (
          <div className='dr-lobby-row'>
            <p className='dr-lobby-line'>
              <span className='dr-code' aria-label={`code ${invite.code.split('').join(' ')}`}>{invite.code}</span>
            </p>
            <ArcadeButton
              onClick={() => {
                void navigator.clipboard?.writeText(invite.url).catch(() => undefined);
              }}
            >
              copy link
            </ArcadeButton>
          </div>
        ) : null}
        <p className='dr-lobby-line'>Open lanes race as bots.</p>
        <div className='dr-lobby-row'>
          <div className='dr-lobby-actions'>
            {isHost && lobby.kind === 'invite' ? (
              <ArcadeButton tone='primary' onClick={onStart} disabled={pending !== null}>
                start
              </ArcadeButton>
            ) : null}
            <ArcadeButton onClick={onLeave} disabled={pending !== null}>
              leave
            </ArcadeButton>
          </div>
        </div>
        {error ? <p className='dr-lobby-error'>{error}</p> : null}
      </div>
    );
  }

  return (
    <div className='dr-lobby' data-surface='paper'>
      <div className='dr-lobby-actions dr-lobby-main'>
        <ArcadeButton tone='primary' size='lg' onClick={onPlayNow} disabled={pending !== null}>
          play now
        </ArcadeButton>
        <ArcadeButton size='lg' onClick={onPractice} disabled={pending !== null}>
          practice
        </ArcadeButton>
        <ArcadeButton size='lg' onClick={onInvite} disabled={pending !== null}>
          invite
        </ArcadeButton>
      </div>
      {signedIn ? null : <SignInLine className='dr-lobby-signin' action='race people for tickets' />}
      {error ? <p className='dr-lobby-error'>{error}</p> : null}
    </div>
  );
}
