'use client';

/* The social body, in the dock and on /social. Friends first: who is
   waiting for you, friend requests, who is on now, then everyone else, each
   with one button. Chats holds the lobby and direct messages. A request or
   an invite that arrives while it is open slides in and rings. */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Check, MessageCircle, Search, UsersRound, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { joinVerb, waitingLine } from '@/features/arcade/components/home/home-on-now';
import { GAME_NAME } from '@/features/arcade/components/home/home-on-now';
import type { HomeTurn, HomeWaiting } from '@/features/arcade/components/home/tixy-home-types';
import { useJoinMatch } from '@/features/arcade/components/home/use-join-match';
import { renamedPath } from '@/features/arcade/lib/game-renames';
import { SoundManager } from '@/features/arcade/lib/sound-manager';
import { Num } from '@/features/arcade/components/ui/num';
import { ProfileAvatar } from '@/features/users/components/profile-avatar';
import { useFriendPresence, useOnlineFriends } from '@/features/social/presence/presence-client';

import { ChallengeButton } from './challenge-button';
import { presenceLine, shortAgo } from './presence-line';
import { SocialThread } from './social-thread';
import { useSocial } from './social-provider';
import type {
  ConversationSummary,
  FriendSummary,
  SocialSearchPlayer,
  SocialThreadTarget,
} from './social-types';
import { useSocialLive } from './use-social-live';

import './tixy-people.css';

type Tab = 'chats' | 'friends';

const ICON = { size: 16, strokeWidth: 2, strokeLinecap: 'square' as const, 'aria-hidden': true };

function otherOf(conversation: ConversationSummary) {
  return conversation.otherMembers[0] ?? { userId: '', name: 'player', imageUrl: null };
}

function profileHref(userId: string) {
  return `/u/${encodeURIComponent(userId)}`;
}

export function SocialExperience({
  variant,
  initialThread = null,
  initialTab = 'friends',
}: {
  variant: 'dock' | 'page';
  initialThread?: SocialThreadTarget | null;
  initialTab?: Tab;
}) {
  const social = useSocial();
  const pathname = usePathname();
  const { setActiveThread } = social;
  const [tab, setTab] = useState<Tab>(initialTab);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SocialSearchPlayer[]>([]);
  const [searching, setSearching] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const online = useOnlineFriends();
  const userId = social.snapshot?.currentUser.userId ?? null;
  const live = useSocialLive(userId, !social.activeThread);

  /* Requests that arrive while the panel is open slide in and ring once. */
  const knownRequests = useRef<Set<string> | null>(null);
  const [arrivedRequests, setArrivedRequests] = useState<ReadonlySet<string>>(() => new Set());
  const incoming = useMemo(() => social.snapshot?.incoming ?? [], [social.snapshot?.incoming]);
  useEffect(() => {
    if (!social.snapshot) return;
    const ids = incoming.map((friend) => friend.friendshipId);
    if (knownRequests.current) {
      const fresh = ids.filter((id) => !knownRequests.current!.has(id));
      if (fresh.length > 0) setArrivedRequests((previous) => new Set([...previous, ...fresh]));
    }
    knownRequests.current = new Set([...(knownRequests.current ?? []), ...ids]);
  }, [incoming, social.snapshot]);

  /* One soft chime per arrival. The home plays its own for invites. */
  const chimed = useRef(0);
  const arrivals = arrivedRequests.size + (pathname === '/' ? 0 : live.arrived.size);
  useEffect(() => {
    if (arrivals > chimed.current && !document.hidden) SoundManager.play('coinCorrect', { volume: 0.4 });
    chimed.current = arrivals;
  }, [arrivals]);

  useEffect(() => {
    if (initialThread) setActiveThread(initialThread);
  }, [initialThread, setActiveThread]);

  useEffect(() => {
    const value = query.trim();
    if (value.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearching(true);
      void fetch(`/api/social/search?q=${encodeURIComponent(value)}`, {
        cache: 'no-store',
        signal: controller.signal,
      })
        .then(async (response) => {
          const payload = (await response.json().catch(() => ({}))) as {
            players?: SocialSearchPlayer[];
          };
          if (response.ok) setResults(payload.players ?? []);
        })
        .catch(() => {})
        .finally(() => setSearching(false));
    }, 220);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const onlineIds = useMemo(() => new Set(online.map((presence) => presence.userId)), [online]);
  const friends = useMemo(() => social.snapshot?.friends ?? [], [social.snapshot?.friends]);
  const onNow = useMemo(
    () => friends.filter((friend) => onlineIds.has(friend.userId)).sort((a, b) => a.name.localeCompare(b.name)),
    [friends, onlineIds],
  );
  const offline = useMemo(
    () => friends.filter((friend) => !onlineIds.has(friend.userId)).sort((a, b) => a.name.localeCompare(b.name)),
    [friends, onlineIds],
  );
  const imageById = useMemo(() => new Map(friends.map((friend) => [friend.userId, friend.imageUrl])), [friends]);

  const waiting = live.onNow?.waiting ?? [];
  const turns = live.onNow?.turns ?? [];
  const friendsBadge = incoming.length + waiting.filter((entry) => entry.kind === 'invite').length;
  const chatsBadge =
    (social.snapshot?.conversations.filter((conversation) => conversation.unreadCount > 0).length ?? 0) +
    (social.snapshot?.lobbyUnreadCount ? 1 : 0);

  const run = async (id: string, task: () => Promise<unknown>) => {
    setActionId(id);
    setError(null);
    try {
      await task();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setActionId(null);
    }
  };

  const updateFriend = (friendshipId: string, action: 'accept' | 'decline' | 'remove') =>
    run(friendshipId, async () => {
      if (action === 'accept') SoundManager.play('boardSelect', { volume: 0.5 });
      await social.updateFriendship(friendshipId, action);
      setResults((current) =>
        current.map((player) =>
          'friendshipId' in player.relationship && player.relationship.friendshipId === friendshipId
            ? {
                ...player,
                relationship:
                  action === 'accept' ? { status: 'friends' as const, friendshipId } : { status: 'none' as const },
              }
            : player,
        ),
      );
    });

  const addFriend = (player: SocialSearchPlayer) =>
    run(player.userId, async () => {
      await social.sendFriendRequest(player.userId);
      setResults((current) =>
        current.map((item) =>
          item.userId === player.userId
            ? { ...item, relationship: { status: 'outgoing' as const, friendshipId: `pending:${player.userId}` } }
            : item,
        ),
      );
      await social.refresh();
    });

  const messageFriend = (id: string) =>
    run(`message:${id}`, async () => {
      await social.openConversation(id);
    });

  if (social.activeThread) {
    return <SocialThread target={social.activeThread} onBack={() => social.setActiveThread(null)} />;
  }

  const searchActive = query.trim().length >= 2;

  return (
    <div className='tp tp-social'>
      <div className='tp-social-top'>
        <div className='tp-tabs' role='tablist' aria-label='social'>
          <TabButton active={tab === 'friends' && !searchActive} onClick={() => { setTab('friends'); setQuery(''); }} label='friends' badge={friendsBadge} />
          <TabButton active={tab === 'chats' && !searchActive} onClick={() => { setTab('chats'); setQuery(''); }} label='chats' badge={chatsBadge} />
        </div>
        <label className='tp-search'>
          <Search {...ICON} />
          <span className='tp-sr'>find a player</span>
          <input
            type='search'
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder='find a player'
            autoComplete='off'
          />
        </label>
      </div>

      {error ? (
        <p role='alert' className='tp-error' style={{ margin: '0 16px 8px' }}>
          {error}
        </p>
      ) : null}

      <div className='tp-social-body'>
        {social.loading ? (
          <p className='tp-note'>Loading your friends.</p>
        ) : searchActive ? (
          <SearchResults
            results={results}
            searching={searching}
            actionId={actionId}
            onAdd={addFriend}
            onUpdate={updateFriend}
            onMessage={messageFriend}
          />
        ) : tab === 'chats' ? (
          <ChatsList onLobby={social.openLobby} onThread={(id) => social.setActiveThread({ kind: 'dm', id })} />
        ) : (
          <>
            {waiting.length > 0 || turns.length > 0 ? (
              <section aria-labelledby='tp-waiting'>
                <h3 id='tp-waiting' className='tp-section-head'>
                  waiting for you <small><Num value={waiting.length + turns.length} /></small>
                </h3>
                <div aria-live='polite'>
                  {waiting.map((entry) => (
                    <WaitingRow
                      key={entry.matchId}
                      entry={entry}
                      imageUrl={imageById.get(entry.userId) ?? null}
                      arrived={live.arrived.has(entry.matchId)}
                      onGone={() => void live.refresh()}
                    />
                  ))}
                </div>
                {turns.map((turn) => (
                  <TurnRow key={turn.matchId} turn={turn} />
                ))}
              </section>
            ) : null}

            {incoming.length > 0 ? (
              <section aria-labelledby='tp-requests'>
                <h3 id='tp-requests' className='tp-section-head'>
                  requests <small><Num value={incoming.length} /></small>
                </h3>
                <div aria-live='polite'>
                  {incoming.map((friend) => (
                    <PersonRow
                      key={friend.friendshipId}
                      person={friend}
                      line='wants to be friends'
                      arrived={arrivedRequests.has(friend.friendshipId)}
                      actions={
                        <>
                          <button
                            type='button'
                            className='tp-btn'
                            data-size='sm'
                            data-busy={actionId === friend.friendshipId || undefined}
                            disabled={actionId === friend.friendshipId}
                            onClick={() => void updateFriend(friend.friendshipId, 'accept')}
                            aria-label={`accept ${friend.name}`}
                          >
                            <span>accept</span>
                          </button>
                          <button
                            type='button'
                            className='tp-btn'
                            data-tone='bare'
                            data-size='icon'
                            disabled={actionId === friend.friendshipId}
                            onClick={() => void updateFriend(friend.friendshipId, 'decline')}
                            aria-label={`decline ${friend.name}`}
                          >
                            <X {...ICON} />
                          </button>
                        </>
                      }
                    />
                  ))}
                </div>
              </section>
            ) : null}

            <section aria-labelledby='tp-on-now'>
              <h3 id='tp-on-now' className='tp-section-head'>
                on now
                {friends.length > 0 ? (
                  <small>
                    <Num value={onNow.length} /> of <Num value={friends.length} />
                  </small>
                ) : null}
              </h3>
              {friends.length === 0 ? (
                <div className='tp-empty'>
                  <strong>No friends yet.</strong>
                  Find a player above, or browse <Link href='/players'>players</Link>.
                </div>
              ) : onNow.length === 0 ? (
                <p className='tp-note'>
                  {friends.length === 1 ? 'Your friend is not on right now.' : (
                    <>None of your <Num value={friends.length} /> friends are on right now.</>
                  )}
                </p>
              ) : (
                onNow.map((friend, index) => (
                  <FriendRow
                    key={friend.friendshipId}
                    friend={friend}
                    actionId={actionId}
                    onMessage={messageFriend}
                    menuUp={variant === 'dock' && index > 2}
                  />
                ))
              )}
            </section>

            {offline.length > 0 ? (
              <section aria-labelledby='tp-friends'>
                <h3 id='tp-friends' className='tp-section-head'>
                  friends <small><Num value={offline.length} /></small>
                </h3>
                {offline.map((friend, index) => (
                  <FriendRow
                    key={friend.friendshipId}
                    friend={friend}
                    actionId={actionId}
                    onMessage={messageFriend}
                    menuUp={variant === 'dock' && index > 1}
                  />
                ))}
              </section>
            ) : null}

            {(social.snapshot?.outgoing.length ?? 0) > 0 ? (
              <section aria-labelledby='tp-sent'>
                <h3 id='tp-sent' className='tp-section-head'>
                  sent <small><Num value={social.snapshot!.outgoing.length} /></small>
                </h3>
                {social.snapshot!.outgoing.map((friend) => (
                  <PersonRow
                    key={friend.friendshipId}
                    person={friend}
                    line={`sent ${shortAgo(friend.requestedAt)} ago`}
                    actions={
                      <button
                        type='button'
                        className='tp-btn'
                        data-tone='quiet'
                        data-size='sm'
                        disabled={actionId === friend.friendshipId}
                        onClick={() => void updateFriend(friend.friendshipId, 'remove')}
                        aria-label={`cancel request to ${friend.name}`}
                      >
                        <span>cancel</span>
                      </button>
                    }
                  />
                ))}
              </section>
            ) : null}
          </>
        )}
      </div>

      {variant === 'dock' ? (
        <div className='tp-social-foot'>
          <Link href='/players'>players</Link>
          <span style={{ display: 'flex', gap: 14 }}>
            <Link href='/social?view=alerts'>alerts</Link>
            <Link href='/social?view=safety'>safety</Link>
          </span>
        </div>
      ) : null}
    </div>
  );
}

function TabButton({ active, onClick, label, badge }: { active: boolean; onClick: () => void; label: string; badge?: number }) {
  return (
    <button type='button' role='tab' aria-selected={active} onClick={onClick}>
      {label}
      {badge ? <span className='tp-count'>{badge > 99 ? '99+' : badge}</span> : null}
    </button>
  );
}

function PersonRow({
  person,
  line,
  actions,
  arrived = false,
  waiting = false,
}: {
  person: { userId: string; name: string; imageUrl: string | null };
  line: ReactNode;
  actions: ReactNode;
  arrived?: boolean;
  waiting?: boolean;
}) {
  return (
    <div className='tp-row' data-arrived={arrived || undefined}>
      <Link href={profileHref(person.userId)} tabIndex={-1} aria-hidden className='inline-flex rounded-full'>
        <ProfileAvatar name={person.name} imageUrl={person.imageUrl} size='md' />
      </Link>
      <Link href={profileHref(person.userId)} className='tp-row-main'>
        <strong>
          {person.name}
          {waiting ? <i className='tp-dot' aria-hidden /> : null}
        </strong>
        <small>{line}</small>
      </Link>
      <div className='tp-row-actions'>{actions}</div>
    </div>
  );
}

function FriendRow({
  friend,
  actionId,
  onMessage,
  menuUp,
}: {
  friend: FriendSummary;
  actionId: string | null;
  onMessage: (userId: string) => Promise<void>;
  menuUp: boolean;
}) {
  const presence = useFriendPresence(friend.userId);
  return (
    <PersonRow
      person={friend}
      line={presenceLine(presence)}
      actions={
        <>
          <ChallengeButton userId={friend.userId} name={friend.name} menuUp={menuUp} />
          <button
            type='button'
            className='tp-btn'
            data-tone='bare'
            data-size='icon'
            disabled={actionId === `message:${friend.userId}`}
            onClick={() => void onMessage(friend.userId)}
            aria-label={`message ${friend.name}`}
          >
            <MessageCircle {...ICON} />
          </button>
        </>
      }
    />
  );
}

function WaitingRow({
  entry,
  imageUrl,
  arrived,
  onGone,
}: {
  entry: HomeWaiting;
  imageUrl: string | null;
  arrived: boolean;
  onGone: () => void;
}) {
  const { busy, confirming, error, start, confirm, cancel } = useJoinMatch(entry, onGone);
  const invite = entry.kind === 'invite';
  const verb = joinVerb(entry);
  return (
    <>
      <PersonRow
        person={{ userId: entry.userId, name: entry.name, imageUrl }}
        line={waitingLine(entry)}
        arrived={arrived}
        waiting={invite}
        actions={
          confirming ? null : (
            <button
              type='button'
              className='tp-btn'
              data-size='sm'
              data-tone={invite ? undefined : 'quiet'}
              data-busy={busy || undefined}
              disabled={busy}
              onClick={start}
              aria-label={`${verb} ${entry.name}, ${GAME_NAME[entry.game]}${entry.wager ? `, stakes ${entry.wager} tickets` : ''}`}
            >
              <span>{busy ? 'joining' : verb}</span>
            </button>
          )
        }
      />
      {confirming ? (
        <div className='tp-confirm' role='group' aria-label={`${verb} a ${entry.wager} ticket match`}>
          <p>
            This holds <Num className='tp-num' value={entry.wager ?? 0} /> of your tickets until the match ends.
          </p>
          <div>
            <button type='button' className='tp-btn' data-size='sm' data-busy={busy || undefined} disabled={busy} onClick={() => void confirm()}>
              <span>{busy ? 'joining' : 'stake it'}</span>
            </button>
            <button type='button' className='tp-btn' data-size='sm' data-tone='quiet' disabled={busy} onClick={cancel}>
              <span>cancel</span>
            </button>
          </div>
        </div>
      ) : null}
      {error ? (
        <p role='alert' className='tp-error' style={{ marginLeft: 56 }}>
          {error}
        </p>
      ) : null}
    </>
  );
}

function TurnRow({ turn }: { turn: HomeTurn }) {
  return (
    <div className='tp-row'>
      <ProfileAvatar name={turn.opponent} size='md' />
      <div className='tp-row-main'>
        <strong>{turn.opponent}</strong>
        <small>your move in {GAME_NAME[turn.game]}</small>
      </div>
      <div className='tp-row-actions'>
        <Link
          href={renamedPath(`/${turn.game}/${turn.matchId}`)}
          className='tp-btn'
          data-size='sm'
          aria-label={`play your move against ${turn.opponent}, ${GAME_NAME[turn.game]}`}
        >
          <span>play</span>
        </Link>
      </div>
    </div>
  );
}

function ChatsList({ onLobby, onThread }: { onLobby: () => void; onThread: (id: string) => void }) {
  const { snapshot } = useSocial();
  const conversations = snapshot?.conversations ?? [];
  return (
    <>
      <section>
        <button type='button' onClick={onLobby} className='tp-row' style={{ width: '100%', border: 0, background: 'none', textAlign: 'left', cursor: 'pointer', color: 'inherit', font: 'inherit' }}>
          <span className='arc-avatar inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full' style={{ background: 'var(--tixy-ink)', color: 'var(--tixy-paper)' }}>
            <UsersRound {...ICON} size={20} />
          </span>
          <span className='tp-row-main'>
            <strong>the lobby</strong>
            <small>Everyone signed in can read it.</small>
          </span>
          {snapshot?.lobbyUnreadCount ? <span className='tp-count'>{snapshot.lobbyUnreadCount > 99 ? '99+' : snapshot.lobbyUnreadCount}</span> : null}
        </button>
      </section>
      <section aria-labelledby='tp-dms'>
        <h3 id='tp-dms' className='tp-section-head'>
          messages {conversations.length ? <small><Num value={conversations.length} /></small> : null}
        </h3>
        {conversations.length === 0 ? (
          <p className='tp-note'>Message a friend from the friends tab.</p>
        ) : (
          conversations.map((conversation) => {
            const other = otherOf(conversation);
            return (
              <button
                key={conversation.id}
                type='button'
                onClick={() => onThread(conversation.id)}
                className='tp-row'
                style={{ width: '100%', border: 0, background: 'none', textAlign: 'left', cursor: 'pointer', color: 'inherit', font: 'inherit' }}
              >
                <ProfileAvatar name={other.name} imageUrl={other.imageUrl} size='md' />
                <span className='tp-row-main'>
                  <strong>
                    {other.name}
                    {conversation.unreadCount ? <i className='tp-dot' aria-hidden /> : null}
                  </strong>
                  <small>{conversation.lastMessage?.content || 'No messages yet.'}</small>
                </span>
                <span className='tp-result-when'>{shortAgo(conversation.updatedAt)}</span>
              </button>
            );
          })
        )}
      </section>
    </>
  );
}

function SearchResults({
  results,
  searching,
  actionId,
  onAdd,
  onUpdate,
  onMessage,
}: {
  results: SocialSearchPlayer[];
  searching: boolean;
  actionId: string | null;
  onAdd: (player: SocialSearchPlayer) => Promise<void>;
  onUpdate: (id: string, action: 'accept' | 'decline' | 'remove') => Promise<void>;
  onMessage: (userId: string) => Promise<void>;
}) {
  if (searching && results.length === 0) return <p className='tp-note'>Looking.</p>;
  if (!results.length) return <p className='tp-note'>No player by that name.</p>;
  return (
    <section>
      {results.map((player) => {
        const relationship = player.relationship;
        const friendshipId = 'friendshipId' in relationship ? relationship.friendshipId : null;
        let actions: ReactNode = null;
        if (relationship.status === 'none') {
          actions = (
            <button type='button' className='tp-btn' data-size='sm' data-busy={actionId === player.userId || undefined} disabled={actionId === player.userId} onClick={() => void onAdd(player)} aria-label={`add ${player.name}`}>
              <span>add</span>
            </button>
          );
        } else if (relationship.status === 'friends') {
          actions = (
            <>
              <ChallengeButton userId={player.userId} name={player.name} />
              <button type='button' className='tp-btn' data-tone='bare' data-size='icon' onClick={() => void onMessage(player.userId)} aria-label={`message ${player.name}`}>
                <MessageCircle {...ICON} />
              </button>
            </>
          );
        } else if (relationship.status === 'incoming' && friendshipId) {
          actions = (
            <button type='button' className='tp-btn' data-size='sm' disabled={actionId === friendshipId} onClick={() => void onUpdate(friendshipId, 'accept')} aria-label={`accept ${player.name}`}>
              <Check {...ICON} />
              <span>accept</span>
            </button>
          );
        } else if (relationship.status === 'outgoing') {
          actions = <small style={{ color: 'var(--tixy-ink-3)', fontSize: 14 }}>sent</small>;
        }
        return (
          <div key={player.userId} className='tp-row'>
            <Link href={player.profileHref} tabIndex={-1} aria-hidden className='inline-flex rounded-full'>
              <ProfileAvatar name={player.name} imageUrl={player.imageUrl} size='md' />
            </Link>
            <Link href={player.profileHref} className='tp-row-main'>
              <strong>{player.name}</strong>
              <small>{relationship.status === 'friends' ? 'friend' : relationship.status === 'self' ? 'you' : relationship.status === 'incoming' ? 'wants to be friends' : 'player'}</small>
            </Link>
            <div className='tp-row-actions'>{actions}</div>
          </div>
        );
      })}
    </section>
  );
}
