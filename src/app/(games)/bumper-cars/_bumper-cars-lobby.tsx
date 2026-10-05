'use client';

/* The waiting room, drawn over the bottom of the rink while the cars sit
   parked: who's in, how long until the power comes on, and for a friends
   room the code, the link and the start button. */

import { useEffect, useState } from 'react';
import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';
import { ArcadeDialog } from '@/features/arcade/components/ui/arcade-sheet';
import { CAR_COLORS } from '@/features/arcade/lib/bumper-cars/constants';
import type { WireRoom } from '@/features/arcade/lib/bumper-cars/protocol';

export type InviteFriend = { userId: string; name: string };

export function LobbyPanel({
  room,
  seat,
  onStart,
  onLeave,
  onInvite,
}: {
  room: WireRoom;
  seat: number;
  onStart: () => void;
  onLeave: () => void;
  onInvite: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, []);
  // The server's countdown, run on this clock from when it arrived.
  const [mark, setMark] = useState(() => ({ at: Date.now(), left: room.in }));
  useEffect(() => setMark({ at: Date.now(), left: room.in }), [room.in]);
  const seconds = mark.left === null ? null : Math.max(0, Math.ceil((mark.left - (now - mark.at)) / 1000));
  const host = room.seats[seat]?.h === 1;
  const players = room.seats.filter((s) => s.k === 'p').length;
  const invite = room.v === 'invite';
  const hostName = room.seats.find((s) => s.h)?.n ?? '';

  // One line, only when it says something the seats and buttons don't: the
  // countdown, what the host does next, who starts the round.
  let line: string | null = null;
  if (!invite) line = seconds !== null ? `Starts in ${seconds}.` : null;
  else if (room.round && seconds !== null) line = `Next round in ${seconds}.`;
  else if (host) line = players > 1 ? null : 'Send friends the code.';
  else line = `${hostName} starts the round.`;

  return (
    <div className='bc-lobby' data-surface='ink' role='region' aria-label='Waiting room'>
      {invite ? (
        <div className='bc-lobby-code'>
          <span className='bc-lobby-code-value' aria-label={`Code ${room.code.split('').join(' ')}`}>
            {room.code}
          </span>
          <span className='bc-lobby-code-label'>code</span>
        </div>
      ) : null}
      {line ? (
        <p className='bc-lobby-line' aria-live='polite'>
          {line}
        </p>
      ) : null}
      <ol className='bc-lobby-seats'>
        {room.seats.map((s, i) => (
          <li key={i} data-empty={s.k === 'e' || undefined} data-you={i === seat || undefined}>
            <span className='bc-dot' style={{ background: s.k === 'e' ? 'transparent' : CAR_COLORS[i] }} aria-hidden='true' />
            <span>{s.k === 'e' ? 'open' : s.n}</span>
          </li>
        ))}
      </ol>
      <div className='bc-lobby-actions'>
        {invite && host && !room.round ? (
          <ArcadeButton tone='primary' onClick={onStart}>
            start
          </ArcadeButton>
        ) : null}
        {invite ? <ArcadeButton onClick={onInvite}>invite</ArcadeButton> : null}
        <ArcadeButton tone='ghost' onClick={onLeave}>
          leave
        </ArcadeButton>
      </div>
    </div>
  );
}

export function InviteSheet({
  open,
  onClose,
  room,
  friends,
  onInviteFriend,
}: {
  open: boolean;
  onClose: () => void;
  room: WireRoom | null;
  friends: InviteFriend[];
  onInviteFriend: (friendId: string) => Promise<void>;
}) {
  const [sent, setSent] = useState<Record<string, 'sending' | 'sent' | 'failed'>>({});
  const [copied, setCopied] = useState(false);
  if (!room) return null;
  const link = typeof window === 'undefined' ? '' : `${window.location.origin}/bumper-cars?join=${encodeURIComponent(room.id)}`;
  const copy = async () => {
    try {
      if (navigator.share && window.matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ title: 'Bumper cars', text: `Get in a car. Code ${room.code}.`, url: link });
      } else {
        await navigator.clipboard.writeText(link);
        setCopied(true);
      }
    } catch {
      /* the player closed the share sheet */
    }
  };
  return (
    <ArcadeDialog open={open} onClose={onClose} title='invite friends'>
      <div className='bc-invite'>
        <p className='bc-invite-code-line'>
          <span className='bc-invite-code'>{room.code}</span>
          Anyone with the code or the link gets a car.
        </p>
        <ArcadeButton tone='primary' onClick={() => void copy()}>
          {copied ? 'copied' : 'copy link'}
        </ArcadeButton>
        {friends.length > 0 ? (
          <ul className='bc-invite-friends'>
            {friends.map((f) => (
              <li key={f.userId}>
                <span>{f.name}</span>
                <ArcadeButton
                  size='sm'
                  disabled={Boolean(sent[f.userId])}
                  onClick={() => {
                    setSent((m) => ({ ...m, [f.userId]: 'sending' }));
                    onInviteFriend(f.userId)
                      .then(() => setSent((m) => ({ ...m, [f.userId]: 'sent' })))
                      .catch(() => setSent((m) => ({ ...m, [f.userId]: 'failed' })));
                  }}
                >
                  {sent[f.userId] === 'sent' ? 'sent' : sent[f.userId] === 'failed' ? 'failed' : 'invite'}
                </ArcadeButton>
              </li>
            ))}
          </ul>
        ) : (
          <p className='bc-invite-none'>Friends you add show here.</p>
        )}
      </div>
    </ArcadeDialog>
  );
}

export function FriendsSheet({
  open,
  onClose,
  onCreate,
  onJoinCode,
  busy,
  error,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: () => void;
  onJoinCode: (code: string) => void;
  busy: boolean;
  error: string | null;
}) {
  const [code, setCode] = useState('');
  const valid = /^[A-Za-z0-9]{6}$/.test(code.trim());
  return (
    <ArcadeDialog open={open} onClose={onClose} title='play with friends'>
      <div className='bc-invite'>
        <ArcadeButton tone='primary' disabled={busy} onClick={onCreate}>
          make a room
        </ArcadeButton>
        <form
          className='bc-code-form'
          onSubmit={(e) => {
            e.preventDefault();
            if (valid && !busy) onJoinCode(code.trim().toUpperCase());
          }}
        >
          <label className='sr-only' htmlFor='bc-code'>
            code
          </label>
          <input
            id='bc-code'
            className='bc-code-input'
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))}
            placeholder='code'
            autoComplete='off'
            autoCapitalize='characters'
            spellCheck={false}
            inputMode='text'
          />
          <ArcadeButton type='submit' disabled={!valid || busy}>
            join
          </ArcadeButton>
        </form>
        {error ? <p className='bc-error'>{error}</p> : null}
      </div>
    </ArcadeDialog>
  );
}
