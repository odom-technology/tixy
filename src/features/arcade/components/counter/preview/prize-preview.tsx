'use client';

/* A prize up close (the counter's preview sheet): the prize where it goes.
   A skin on its game's stage, a profile prize on your own header and row.
   "now" shows what you have on, "with it" the prize, so you can see the
   difference before you spend. A sheet on phones, a modal from 640 px. */

import { type ReactNode, useEffect, useState } from 'react';

import { StoreItemPreview } from '@/features/arcade/components/store-item-preview';
import { ArcadeDialog } from '@/features/arcade/components/ui/arcade-sheet';
import { ArcadeStub } from '@/features/arcade/components/ui/arcade-ui';
import { Num } from '@/features/arcade/components/ui/num';
import { SKIN_GAMES, isSkinGame, readSkinSet, type SkinGame, type SkinSet } from '@/features/arcade/lib/skins/skin-set';

import { IdentityPreview, isIdentityItem, profileLookFrom, profilePatch, type Me, type ProfileLook } from './identity-preview';
import { InGameStage, stageAspect } from './in-game-stage';

import './prize-preview.css';

export type PreviewItem = {
  id: string;
  name: string;
  gameType: string;
  price: number;
  slots: string[];
  assetRef: Record<string, unknown> | null;
};

export type PreviewEntry = { item: PreviewItem; owned: boolean; kind: string };
export type EquippedEntry = { slot: string; item: PreviewItem };

const capitalise = (text: string) => (text ? `${text[0]!.toUpperCase()}${text.slice(1)}` : text);

function listOf(words: string[]) {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/* What each skin slot is called on screen. */
const SLOT_WORD: Record<string, string> = {
  body: 'snake',
  food: 'apple',
  board: 'board',
  tiles: 'tiles',
  grid: 'grid',
  background: 'background',
  table: 'table',
  balls: 'balls',
  cue: 'cue',
  pieces: 'pieces',
  discs: 'discs',
  lane: 'lane',
  rings: 'rings',
  tower: 'tower',
  puck: 'puck',
  duck: 'targets',
  sight: 'sight',
  booth: 'booth',
  bird: 'flyer',
  obstacle: 'walls',
  trail: 'trail',
  blocks: 'blocks',
  effects: 'lights',
  keyboard: 'keyboard',
  accent: 'accent',
  pipe: 'posts',
  crate: 'crate',
  course: 'course',
  ball: 'ball',
  flag: 'flag',
  car: 'cars',
  rink: 'rink',
  rail: 'rail',
  track: 'track',
  horses: 'horses',
};

/* One line on what a prize changes and where it shows. */
function whatItDoes(entry: PreviewEntry, skin: SkinSet | null): string {
  if (skin) {
    const parts = listOf(entry.item.slots.map((slot) => SLOT_WORD[slot] ?? slot));
    const sound = skin.sound !== 'house' ? ', and tints the sounds' : '';
    return `Changes the ${parts}${sound}. The rules stay the same.`;
  }
  const slot = entry.item.slots[0];
  if (slot === 'frame') return 'Goes round your avatar on your profile and in every list.';
  if (slot === 'background') return 'Runs across the top of your profile.';
  if (slot === 'title') return 'Shows under your name on your profile and in every list.';
  if (slot === 'avatar') return 'Your picture on your profile, in every list and at the top of the page.';
  if (slot === 'badge') return 'Shows beside your name.';
  if (slot === 'nameColor') return 'Colours your name.';
  return '';
}

function Status({ entry, equipped, balance, signedIn }: { entry: PreviewEntry; equipped: boolean; balance: number; signedIn: boolean }) {
  if (equipped) return <>It&apos;s on.</>;
  if (entry.owned) return <>It&apos;s yours.</>;
  if (!signedIn) return <>Sign in to save for it.</>;
  const short = entry.item.price - balance;
  if (short <= 0) return <>You can afford it.</>;
  return (
    <>
      <Num className='pc-num' value={short} /> more tickets to go.
    </>
  );
}

type View = 'now' | 'with';

/* Two layers in one place; the one not shown fades out. Both stay mounted
   so the toggle is instant and the box never changes size. */
function Layers({ view, now, withIt, labels }: { view: View; now: ReactNode; withIt: ReactNode; labels: Record<View, string> }) {
  return (
    <div className='pp-layers'>
      <div className='pp-layer' data-shown={view === 'now' || undefined} role='img' aria-label={labels.now} aria-hidden={view !== 'now'}>
        <div className='pp-layer-in' inert>
          {now}
        </div>
      </div>
      <div className='pp-layer' data-shown={view === 'with' || undefined} role='img' aria-label={labels.with} aria-hidden={view !== 'with'}>
        <div className='pp-layer-in' inert>
          {withIt}
        </div>
      </div>
    </div>
  );
}

function SkinStage({ game, now, nowId, skin, itemId, view, labels }: {
  game: SkinGame;
  now: SkinSet | null;
  nowId: string | null;
  skin: SkinSet;
  itemId: string;
  view: View;
  labels: Record<View, string>;
}) {
  const sizes = '(max-width: 639px) 100vw, 560px';
  return (
    <div className='pp-stage' style={{ ['--pp-aspect' as string]: stageAspect(game) }}>
      <div className='pp-cabinet'>
        <div className='pp-screen'>
          <Layers
            view={view}
            labels={labels}
            now={<InGameStage game={game} skin={now} itemId={nowId} sizes={sizes} />}
            withIt={<InGameStage game={game} skin={skin} itemId={itemId} sizes={sizes} />}
          />
        </div>
      </div>
    </div>
  );
}

export function PrizePreview({
  entry,
  equipped,
  me,
  balance,
  signedIn,
  pinned,
  busy,
  onClose,
  onBuy,
  onEquip,
  onPin,
}: {
  entry: PreviewEntry;
  equipped: EquippedEntry[];
  me: Me | null;
  balance: number;
  signedIn: boolean;
  pinned: boolean;
  busy: boolean;
  onClose: () => void;
  onBuy: () => void;
  onEquip: () => void;
  onPin: () => void;
}) {
  const { item } = entry;
  const isOn = equipped.some((e) => e.item.id === item.id);
  const [view, setView] = useState<View>('with');
  // A new prize opens on itself.
  useEffect(() => setView('with'), [item.id]);

  const skin = readSkinSet(item.assetRef);
  const game = skin && isSkinGame(skin.game) ? (skin.game as SkinGame) : null;
  const gameLabel = game ? SKIN_GAMES[game].label : null;

  let body: ReactNode;
  let canCompare = !isOn;
  if (skin && game) {
    const nowEntry = equipped.find((e) => e.item.gameType === game && readSkinSet(e.item.assetRef, game));
    const nowSkin = nowEntry ? readSkinSet(nowEntry.item.assetRef, game) : null;
    body = (
      <SkinStage
        game={game}
        now={nowSkin}
        nowId={nowEntry?.item.id ?? null}
        skin={skin}
        itemId={item.id}
        view={isOn ? 'with' : view}
        labels={{
          now: nowEntry ? `${gameLabel} with ${nowEntry.item.name}, the skin you have on` : `${gameLabel} as it comes`,
          with: `${gameLabel} with ${item.name}`,
        }}
      />
    );
  } else if (item.gameType === 'profile' && isIdentityItem(item)) {
    const who: Me = me ?? { name: 'you', avatarUrl: null, level: null };
    const now: ProfileLook = profileLookFrom(equipped, who.avatarUrl);
    const withIt: ProfileLook = { ...now, ...profilePatch(item) };
    body = (
      <div className='pp-idstage'>
        <Layers
          view={isOn ? 'with' : view}
          labels={{ now: 'your profile as it is', with: `your profile with ${item.name}` }}
          now={<IdentityPreview me={who} look={now} />}
          withIt={<IdentityPreview me={who} look={withIt} />}
        />
      </div>
    );
  } else {
    canCompare = false;
    body = (
      <div className='pp-flatstage'>
        <StoreItemPreview item={{ id: item.id, name: item.name, gameType: item.gameType as never, slots: item.slots, assetRef: item.assetRef }} />
      </div>
    );
  }

  const does = whatItDoes(entry, skin);

  return (
    <ArcadeDialog open onClose={onClose} title={item.name} tone='cream' maxWidth={600}>
      <div className='pp'>
        {body}
        {canCompare ? (
          <div className='pp-toggle' role='group' aria-label='compare'>
            <button type='button' aria-pressed={view === 'now'} onClick={() => setView('now')}>
              now
            </button>
            <button type='button' aria-pressed={view === 'with'} onClick={() => setView('with')}>
              with it
            </button>
          </div>
        ) : null}
        <div className='pp-facts'>
          <p className='pp-kind'>
            {capitalise(entry.kind)}. <Status entry={entry} equipped={isOn} balance={balance} signedIn={signedIn} />
          </p>
          {does ? <p className='pp-does'>{does}</p> : null}
        </div>
        <div className='pp-foot'>
          <ArcadeStub size='lg' muted={entry.owned}>
            <Num value={item.price} labelSuffix='tickets' />
          </ArcadeStub>
          {signedIn ? (
            <div className='pc-prize-actions'>
              {!entry.owned ? (
                <button type='button' className='pc-btn' data-tone='quiet' onClick={onPin} disabled={busy} aria-pressed={pinned}>
                  {pinned ? 'unpin' : 'pin'}
                </button>
              ) : null}
              {entry.owned ? (
                isOn ? null : (
                  <button type='button' className='pc-btn' onClick={onEquip} disabled={busy}>
                    equip
                  </button>
                )
              ) : (
                <button type='button' className='pc-btn' onClick={onBuy} disabled={busy || item.price > balance}>
                  buy
                </button>
              )}
            </div>
          ) : (
            <a className='pc-btn' href='/signin?next=%2Fstore'>
              sign in
            </a>
          )}
        </div>
      </div>
    </ArcadeDialog>
  );
}
