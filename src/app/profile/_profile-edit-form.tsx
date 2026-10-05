'use client';

/* The profile editor (docs/design/tixy-rebrand/PROFILES.md): who you are,
   a few words, and the showcase. Every choice is a TixySelect or a set of
   tiles, never a native select. Frames and namecards are owned prizes, so
   picking one equips it at once; everything else saves with one button. */

import { useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, X } from 'lucide-react';

import { AchievementIcon } from '@/features/arcade/components/achievements/achievement-icon';
import {
  ARCADE_GAMES,
  isGameListed,
} from '@/features/arcade/components/arcade-game-registry';
import { StoreItemPreview } from '@/features/arcade/components/store-item-preview';
import { Num } from '@/features/arcade/components/ui/num';
import { TixySelect, type TixySelectOption } from '@/features/arcade/components/ui/tixy-select';
import { getGameDisplayName } from '@/features/arcade/lib/game-renames';
import {
  ACCOUNT_PROFILE_DETAILS_KEY,
  MAX_FAVORITE_GAMES,
  MAX_FEATURED_ACHIEVEMENTS,
  type AccountProfileDetails,
} from '@/features/users/account-profile-details';
import type { FrameId } from '@/features/brand/avatars/frames';
import { displayAvatarUrl, type DefaultAvatar, type StoreAvatar } from '@/features/users/avatars';
import { FramedAvatar } from '@/features/users/components/framed-avatar';
import type { CosmeticOptions } from '@/features/users/profile-cosmetic-options';
import {
  MAX_SHOWCASE_BESTS,
  MAX_SHOWCASE_ITEMS,
  SHOWCASE_LADDER,
  SHOWCASE_TYPES,
  showcaseKey,
  type ProfileShowcase,
  type ShowcaseType,
} from '@/features/users/profile-showcase';

import './profile-editor.css';

export type EditorGame = { slug: string; name: string; value: number | null; label: string | null; playtimeMs: number };
export type EditorAchievement = { id: string; name: string; icon: string; globalRate: number };
export type EditorItem = {
  id: string;
  name: string;
  gameType: string;
  rarity: string;
  slots: string[];
  assetRef: Record<string, unknown> | null;
};

export type ProfileEditFormProps = {
  account: {
    email: string;
    username: string | null;
    imageUrl: string | null;
  };
  initialProfileDetails: AccountProfileDetails;
  /** What the profile shows now: the player's own list or the auto layout. */
  initialShowcases: ProfileShowcase[];
  autoShowcase: boolean;
  avatarOptions: { admin: DefaultAvatar[]; defaults: DefaultAvatar[]; owned: StoreAvatar[] };
  cosmeticOptions: CosmeticOptions;
  showcaseSlots: number;
  accountLevel: number;
  /** Games with a number (featured score, bests), most played first. */
  numberGames: EditorGame[];
  /** Games with time on them, most played first. */
  playedGames: EditorGame[];
  achievements: EditorAchievement[];
  ownedItems: EditorItem[];
  profilePath: string;
};

async function readJsonResponse<T>(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || 'That did not save. Try again.');
  return payload;
}

const fmt = (value: number) => new Intl.NumberFormat('en-US').format(value);

function hoursText(ms: number) {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${Math.max(minutes, ms > 0 ? 1 : 0)} min on record`;
  return `${(Math.round(ms / 360_000) / 10).toFixed(1)} h on record`;
}

const NAME_COLORS: { value: string; label: string }[] = [
  { value: '', label: 'ink' },
  { value: '#b83627', label: 'red' },
  { value: '#2e7566', label: 'felt' },
  { value: '#c47b1e', label: 'brass' },
  { value: '#54483d', label: 'ink 2' },
];

const BAND_COLORS: { value: string; label: string }[] = [
  { value: '', label: 'paper' },
  { value: '#f2a33c', label: 'ticket' },
  { value: '#2e7566', label: 'felt' },
  { value: '#b83627', label: 'red' },
  { value: '#1f1a16', label: 'ink' },
];

export function ProfileEditForm(props: ProfileEditFormProps) {
  const {
    account,
    initialProfileDetails,
    initialShowcases,
    autoShowcase,
    avatarOptions,
    cosmeticOptions,
    showcaseSlots,
    accountLevel,
    numberGames,
    playedGames,
    achievements,
    ownedItems,
    profilePath,
  } = props;
  const router = useRouter();
  const [username, setUsername] = useState(account.username ?? '');
  const [imageUrl, setImageUrl] = useState(account.imageUrl ?? '');
  const [details, setDetails] = useState(initialProfileDetails);
  const [slots, setSlots] = useState<Array<ProfileShowcase | null>>(() => {
    const padded: Array<ProfileShowcase | null> = initialShowcases.slice(0, showcaseSlots);
    while (padded.length < showcaseSlots) padded.push(null);
    return padded;
  });
  const [showcaseTouched, setShowcaseTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const set = <K extends keyof AccountProfileDetails>(key: K, value: AccountProfileDetails[K]) =>
    setDetails((current) => ({ ...current, [key]: value }));

  const updateSlots = (next: Array<ProfileShowcase | null>) => {
    setSlots(next);
    setShowcaseTouched(true);
  };

  const save = async () => {
    setBusy(true);
    setStatus(null);
    let identitySaved = false;
    try {
      const avatarChanged = imageUrl !== (account.imageUrl ?? '');
      await readJsonResponse(
        await fetch('/api/account/me', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(avatarChanged ? { username, imageUrl } : { username }),
        }),
      );
      identitySaved = true;
      const showcases =
        autoShowcase && !showcaseTouched ? null : slots.filter((slot): slot is ProfileShowcase => slot !== null);
      await readJsonResponse(
        await fetch('/api/account/data', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: ACCOUNT_PROFILE_DETAILS_KEY, value: { ...details, showcases } }),
        }),
      );
      setStatus({ tone: 'ok', text: 'Saved.' });
      router.refresh();
    } catch (caught) {
      setStatus({
        tone: 'error',
        text: identitySaved
          ? 'Your name and avatar saved, the rest did not. Save again.'
          : (caught as Error).message,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className='tp pe'>
      <section className='pe-section' aria-labelledby='pe-you'>
        <h2 id='pe-you'>you</h2>
        <div className='pe-field'>
          <label htmlFor='pe-username'>name</label>
          <input
            id='pe-username'
            className='pe-input'
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete='username'
            maxLength={24}
            required
          />
          <small>3 to 24 letters, numbers, dashes or underscores. Your email ({account.email}) never shows.</small>
        </div>
        {avatarOptions.admin.length > 0 ? (
          <section className='pe-field' aria-labelledby='pe-admin-avatars'>
            <h3 className='pe-label' id='pe-admin-avatars'>Admin avatars</h3>
            <div className='pe-avatars'>
              {avatarOptions.admin.map((avatar) => (
                <AvatarThumb
                  key={avatar.id}
                  src={avatar.src}
                  name={avatar.name}
                  selected={imageUrl === avatar.src}
                  onSelect={() => setImageUrl(avatar.src)}
                />
              ))}
            </div>
          </section>
        ) : null}
        <div className='pe-field'>
          <span className='pe-label' id='pe-avatar'>avatar</span>
          <div className='pe-avatars' role='group' aria-labelledby='pe-avatar'>
            <AvatarThumb src='' name='no avatar' selected={!imageUrl} onSelect={() => setImageUrl('')} />
            {avatarOptions.defaults.map((avatar) => (
              <AvatarThumb
                key={avatar.id}
                src={avatar.src}
                name={avatar.name}
                selected={displayAvatarUrl(imageUrl) === avatar.src}
                onSelect={() => setImageUrl(avatar.src)}
              />
            ))}
            {avatarOptions.owned.map((avatar) => (
              <AvatarThumb
                key={avatar.id}
                src={avatar.src}
                name={avatar.name}
                selected={imageUrl === avatar.src}
                onSelect={() => setImageUrl(avatar.src)}
              />
            ))}
          </div>
        </div>
        <CosmeticPickers imageUrl={imageUrl} options={cosmeticOptions} />
      </section>

      <section className='pe-section' aria-labelledby='pe-about'>
        <h2 id='pe-about'>about</h2>
        <div className='pe-grid'>
          <div className='pe-field'>
            <label htmlFor='pe-status'>status</label>
            <input
              id='pe-status'
              className='pe-input'
              value={details.statusText}
              onChange={(event) => set('statusText', event.target.value)}
              maxLength={80}
              placeholder='chasing a skee-ball best'
            />
          </div>
          <div className='pe-field'>
            <label htmlFor='pe-pronouns'>pronouns</label>
            <input
              id='pe-pronouns'
              className='pe-input'
              value={details.pronouns}
              onChange={(event) => set('pronouns', event.target.value)}
              maxLength={32}
              placeholder='they/them'
            />
          </div>
        </div>
        <div className='pe-field'>
          <label htmlFor='pe-bio'>bio</label>
          <textarea
            id='pe-bio'
            className='pe-input pe-textarea'
            value={details.bio}
            onChange={(event) => set('bio', event.target.value)}
            maxLength={280}
            rows={3}
          />
          <small>
            <Num value={details.bio.length} /> of <Num value={280} />
          </small>
        </div>
        <div className='pe-grid'>
          <Swatches
            label='name color'
            value={details.accentColor}
            options={NAME_COLORS}
            onChange={(value) => set('accentColor', value)}
          />
          <Swatches
            label='band color'
            note={cosmeticOptions.equippedNamecardId ? 'Your namecard covers it.' : undefined}
            value={details.bannerColor}
            options={BAND_COLORS}
            onChange={(value) => set('bannerColor', value)}
          />
        </div>
      </section>

      <ShowcaseEditor
        slots={slots}
        onChange={updateSlots}
        details={details}
        setDetails={setDetails}
        showcaseSlots={showcaseSlots}
        accountLevel={accountLevel}
        auto={autoShowcase && !showcaseTouched}
        numberGames={numberGames}
        playedGames={playedGames}
        achievements={achievements}
        ownedItems={ownedItems}
      />

      <section className='pe-section' aria-labelledby='pe-pins'>
        <h2 id='pe-pins'>pinned games</h2>
        <p className='pe-note'>The first games on your floor, in this order.</p>
        <div className='pe-grid'>
          {Array.from({ length: MAX_FAVORITE_GAMES }, (_, index) => {
            const selected = details.favoriteGameSlugs[index] ?? '';
            const options: TixySelectOption[] = [
              { value: '', label: 'none' },
              ...pickableGames(details.favoriteGameSlugs).map((game) => ({
                value: game.slug,
                label: game.name,
                disabled: game.slug !== selected && details.favoriteGameSlugs.includes(game.slug),
              })),
            ];
            return (
              <div key={index} className='pe-field'>
                <span className='pe-label' id={`pe-pin-${index}`}>
                  pin <Num value={index + 1} />
                </span>
                <TixySelect
                  labelledBy={`pe-pin-${index}`}
                  value={selected}
                  placeholder='none'
                  options={options}
                  onChange={(slug) =>
                    setDetails((current) => {
                      const next = [...current.favoriteGameSlugs];
                      if (!slug) next.splice(index, 1);
                      else next[index] = slug;
                      const favoriteGameSlugs = next.filter(Boolean).slice(0, MAX_FAVORITE_GAMES);
                      return { ...current, favoriteGameSlugs, favoriteGameSlug: favoriteGameSlugs[0] ?? '' };
                    })
                  }
                />
              </div>
            );
          })}
        </div>
      </section>

      <div className='pe-save'>
        <button type='button' className='tp-btn' onClick={() => void save()} disabled={busy} data-busy={busy || undefined}>
          <span>{busy ? 'saving' : 'save'}</span>
        </button>
        <Link href={profilePath} className='tp-btn' data-tone='quiet'>
          <span>view profile</span>
        </Link>
        <p className='pe-status' role='status' data-tone={status?.tone}>
          {status?.text}
        </p>
      </div>
    </div>
  );
}

/* Listed games, plus any hidden game already chosen so it can be changed. */
function pickableGames(selected: readonly string[]) {
  return ARCADE_GAMES.filter((game) => isGameListed(game.slug) || selected.includes(game.slug))
    .map((game) => ({ slug: game.slug, name: getGameDisplayName(game.slug, game.title).toLowerCase() }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/* ── the showcase ──────────────────────────────────────────────────────── */

function ShowcaseEditor({
  slots,
  onChange,
  details,
  setDetails,
  showcaseSlots,
  accountLevel,
  auto,
  numberGames,
  playedGames,
  achievements,
  ownedItems,
}: {
  slots: Array<ProfileShowcase | null>;
  onChange: (next: Array<ProfileShowcase | null>) => void;
  details: AccountProfileDetails;
  setDetails: (update: (current: AccountProfileDetails) => AccountProfileDetails) => void;
  showcaseSlots: number;
  accountLevel: number;
  auto: boolean;
  numberGames: EditorGame[];
  playedGames: EditorGame[];
  achievements: EditorAchievement[];
  ownedItems: EditorItem[];
}) {
  const locked = SHOWCASE_LADDER.filter((step) => step.slots > showcaseSlots);
  const usedKeys = slots.map((slot) => (slot ? showcaseKey(slot) : null));

  const replace = (index: number, next: ProfileShowcase | null) =>
    onChange(slots.map((slot, i) => (i === index ? next : slot)));
  const move = (index: number, by: -1 | 1) => {
    const target = index + by;
    if (target < 0 || target >= slots.length) return;
    const next = [...slots];
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  };

  return (
    <section className='pe-section' aria-labelledby='pe-showcase'>
      <h2 id='pe-showcase'>
        showcase
        <small>
          <Num value={showcaseSlots} /> of <Num value={SHOWCASE_LADDER[SHOWCASE_LADDER.length - 1]!.slots} /> slots
        </small>
      </h2>
      <p className='pe-note'>
        {auto
          ? 'Filled from your own numbers until you change a slot.'
          : 'Top to bottom, the order your profile shows them.'}
      </p>
      <ol className='pe-slots'>
        {slots.map((slot, index) => {
          const typeOptions: TixySelectOption<ShowcaseType | 'empty'>[] = [
            { value: 'empty', label: 'empty', hint: 'Nothing in this slot.' },
            ...SHOWCASE_TYPES.map((info) => ({
              value: info.type,
              label: info.label,
              hint: info.note,
              disabled:
                !info.repeatable && slot?.type !== info.type && usedKeys.some((key) => key === info.type),
            })),
          ];
          return (
            <li key={index} className='pe-slot'>
              <div className='pe-slot-head'>
                <span className='pe-slot-n' aria-hidden>
                  <Num value={index + 1} />
                </span>
                <TixySelect<ShowcaseType | 'empty'>
                  label={`showcase slot ${index + 1}`}
                  value={slot?.type ?? 'empty'}
                  options={typeOptions}
                  tone='quiet'
                  onChange={(type) => {
                    if (type === 'empty') return replace(index, null);
                    const ref =
                      type === 'featured-score'
                        ? (numberGames.find((game) => !usedKeys.includes(`featured-score:${game.slug}`))?.slug ?? '')
                        : type === 'favorite-game'
                          ? (playedGames.find((game) => !usedKeys.includes(`favorite-game:${game.slug}`))?.slug ?? '')
                          : '';
                    replace(index, { type, ref, refs: [] });
                  }}
                  className='pe-slot-type'
                />
                <div className='pe-slot-tools'>
                  <button type='button' className='tp-btn' data-tone='bare' data-size='icon' aria-label='move up' disabled={index === 0} onClick={() => move(index, -1)}>
                    <ArrowUp size={16} strokeWidth={2} strokeLinecap='square' aria-hidden />
                  </button>
                  <button
                    type='button'
                    className='tp-btn'
                    data-tone='bare'
                    data-size='icon'
                    aria-label='move down'
                    disabled={index === slots.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown size={16} strokeWidth={2} strokeLinecap='square' aria-hidden />
                  </button>
                  <button type='button' className='tp-btn' data-tone='bare' data-size='icon' aria-label='empty this slot' disabled={!slot} onClick={() => replace(index, null)}>
                    <X size={16} strokeWidth={2} strokeLinecap='square' aria-hidden />
                  </button>
                </div>
              </div>
              {slot ? (
                <SlotBody
                  slot={slot}
                  usedKeys={usedKeys}
                  onChange={(next) => replace(index, next)}
                  details={details}
                  setDetails={setDetails}
                  numberGames={numberGames}
                  playedGames={playedGames}
                  achievements={achievements}
                  ownedItems={ownedItems}
                />
              ) : null}
            </li>
          );
        })}
        {locked.map((step) => (
          <li key={step.level} className='pe-slot' data-locked='true'>
            <div className='pe-slot-head'>
              <span className='pe-slot-n' aria-hidden>
                <Num value={step.slots} />
              </span>
              <span className='pe-locked'>
                opens at level <Num value={step.level} />
                {step === locked[0] ? (
                  <>
                    {' '}
                    (you are <Num value={accountLevel} />)
                  </>
                ) : null}
              </span>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function SlotBody({
  slot,
  usedKeys,
  onChange,
  details,
  setDetails,
  numberGames,
  playedGames,
  achievements,
  ownedItems,
}: {
  slot: ProfileShowcase;
  usedKeys: Array<string | null>;
  onChange: (next: ProfileShowcase) => void;
  details: AccountProfileDetails;
  setDetails: (update: (current: AccountProfileDetails) => AccountProfileDetails) => void;
  numberGames: EditorGame[];
  playedGames: EditorGame[];
  achievements: EditorAchievement[];
  ownedItems: EditorItem[];
}) {
  const gameOptions = (games: EditorGame[], type: ShowcaseType, hint: (game: EditorGame) => string) =>
    games.map((game) => ({
      value: game.slug,
      label: game.name,
      hint: hint(game),
      disabled: game.slug !== slot.ref && usedKeys.includes(`${type}:${game.slug}`),
    }));

  switch (slot.type) {
    case 'featured-score':
      return numberGames.length === 0 ? (
        <p className='pe-note'>Set a best on the <Link href='/'>floor</Link> and it can go here.</p>
      ) : (
        <TixySelect
          label='featured score game'
          value={slot.ref}
          placeholder='pick a best'
          options={gameOptions(numberGames, 'featured-score', (game) => `${fmt(game.value ?? 0)} ${game.label}`)}
          onChange={(ref) => onChange({ ...slot, ref })}
        />
      );
    case 'favorite-game':
      return playedGames.length === 0 ? (
        <p className='pe-note'>Play a game and it can go here.</p>
      ) : (
        <TixySelect
          label='favorite game'
          value={slot.ref}
          placeholder='pick a game'
          options={gameOptions(playedGames, 'favorite-game', (game) => hoursText(game.playtimeMs))}
          onChange={(ref) => onChange({ ...slot, ref })}
        />
      );
    case 'achievements': {
      if (achievements.length === 0) return <p className='pe-note'>Your achievements show here once you earn one.</p>;
      const picked = details.featuredAchievementIds;
      const toggle = (id: string) =>
        setDetails((current) => {
          const ids = current.featuredAchievementIds;
          if (ids.includes(id)) return { ...current, featuredAchievementIds: ids.filter((entry) => entry !== id) };
          if (ids.length >= MAX_FEATURED_ACHIEVEMENTS) return current;
          return { ...current, featuredAchievementIds: [...ids, id] };
        });
      return (
        <Picker
          note={
            <>
              Pick up to <Num value={MAX_FEATURED_ACHIEVEMENTS} />. With none picked, your rarest show.
            </>
          }
        >
          {achievements.map((achievement) => (
            <Tile
              key={achievement.id}
              label={achievement.name}
              selected={picked.includes(achievement.id)}
              order={picked.indexOf(achievement.id)}
              disabled={!picked.includes(achievement.id) && picked.length >= MAX_FEATURED_ACHIEVEMENTS}
              onToggle={() => toggle(achievement.id)}
            >
              <AchievementIcon src={achievement.icon} alt='' size={44} />
            </Tile>
          ))}
        </Picker>
      );
    }
    case 'items': {
      if (ownedItems.length === 0) {
        return (
          <p className='pe-note'>
            Prizes from the <Link href='/store'>counter</Link> and the season show here.
          </p>
        );
      }
      const toggle = (id: string) => {
        if (slot.refs.includes(id)) return onChange({ ...slot, refs: slot.refs.filter((entry) => entry !== id) });
        if (slot.refs.length >= MAX_SHOWCASE_ITEMS) return;
        onChange({ ...slot, refs: [...slot.refs, id] });
      };
      return (
        <Picker
          note={
            <>
              Pick up to <Num value={MAX_SHOWCASE_ITEMS} />. With none picked, your rarest show.
            </>
          }
        >
          {ownedItems.map((item) => (
            <Tile
              key={item.id}
              label={item.name.toLowerCase()}
              selected={slot.refs.includes(item.id)}
              order={slot.refs.indexOf(item.id)}
              disabled={!slot.refs.includes(item.id) && slot.refs.length >= MAX_SHOWCASE_ITEMS}
              onToggle={() => toggle(item.id)}
            >
              <span className='pe-item-art'>
                <StoreItemPreview
                  item={{ id: item.id, name: item.name, gameType: item.gameType as never, slots: item.slots as never, assetRef: item.assetRef }}
                  forceSquare
                />
              </span>
            </Tile>
          ))}
        </Picker>
      );
    }
    case 'bests': {
      if (numberGames.length === 0) return <p className='pe-note'>Your bests show here once you set one.</p>;
      const toggle = (slug: string) => {
        if (slot.refs.includes(slug)) return onChange({ ...slot, refs: slot.refs.filter((entry) => entry !== slug) });
        if (slot.refs.length >= MAX_SHOWCASE_BESTS) return;
        onChange({ ...slot, refs: [...slot.refs, slug] });
      };
      return (
        <Picker
          note={
            <>
              Pick up to <Num value={MAX_SHOWCASE_BESTS} />. With none picked, every best shows.
            </>
          }
        >
          {numberGames.map((game) => (
            <Tile
              key={game.slug}
              label={game.name}
              selected={slot.refs.includes(game.slug)}
              order={slot.refs.indexOf(game.slug)}
              disabled={!slot.refs.includes(game.slug) && slot.refs.length >= MAX_SHOWCASE_BESTS}
              onToggle={() => toggle(game.slug)}
            >
              <span className='pe-tile-num'>
                <Num value={game.value ?? 0} />
              </span>
            </Tile>
          ))}
        </Picker>
      );
    }
    case 'season':
      return <p className='pe-note'>Your tier, and the medal once you reach it.</p>;
    default:
      return null;
  }
}

function Picker({ note, children }: { note: ReactNode; children: ReactNode }) {
  return (
    <div className='pe-picker'>
      <p className='pe-note'>{note}</p>
      <div className='pe-tiles'>{children}</div>
    </div>
  );
}

function Tile({
  label,
  selected,
  order,
  disabled,
  onToggle,
  children,
}: {
  label: string;
  selected: boolean;
  order: number;
  disabled: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <button type='button' className='pe-tile' aria-pressed={selected} disabled={disabled} onClick={onToggle} title={label}>
      {selected ? (
        <span className='pe-tile-order' aria-hidden>
          <Num value={order + 1} />
        </span>
      ) : null}
      {children}
      <span className='pe-tile-label'>{label}</span>
    </button>
  );
}

function Swatches({
  label,
  note,
  value,
  options,
  onChange,
}: {
  label: string;
  note?: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const id = `pe-sw-${label.replace(/\s+/g, '-')}`;
  return (
    <div className='pe-field'>
      <span className='pe-label' id={id}>
        {label}
      </span>
      <div className='pe-swatches' role='radiogroup' aria-labelledby={id}>
        {options.map((option) => (
          <button
            key={option.value || 'none'}
            type='button'
            role='radio'
            aria-checked={value === option.value}
            aria-label={option.label}
            title={option.label}
            className='pe-swatch'
            style={{ background: option.value || 'var(--tixy-paper)' }}
            data-plain={option.value ? undefined : 'true'}
            onClick={() => onChange(option.value)}
          />
        ))}
      </div>
      {note ? <small>{note}</small> : null}
    </div>
  );
}

function AvatarThumb({ src, name, selected, onSelect }: { src: string; name: string; selected: boolean; onSelect: () => void }) {
  return (
    <button type='button' title={name} aria-label={name} aria-pressed={selected} onClick={onSelect} className='pe-avatar'>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt='' />
      ) : (
        <span>none</span>
      )}
    </button>
  );
}

/* Frames and namecards are prizes a player owns, so choosing one equips it
   straight away. */
function CosmeticPickers({ imageUrl, options }: { imageUrl: string; options: CosmeticOptions }) {
  const router = useRouter();
  const [frameId, setFrameId] = useState(options.equippedFrameId);
  const [namecardId, setNamecardId] = useState(options.equippedNamecardId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = async (slot: 'frame' | 'background', id: string | null) => {
    setBusy(true);
    setError(null);
    try {
      await readJsonResponse(
        await fetch(id ? '/api/store/equip' : '/api/store/unequip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(id ? { itemId: id, gameType: 'profile' } : { gameType: 'profile', slot }),
        }),
      );
      if (slot === 'frame') setFrameId(id);
      else setNamecardId(id);
      router.refresh();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const frames = useMemo(() => options.frames, [options.frames]);
  const namecards = useMemo(() => options.namecards, [options.namecards]);

  if (frames.length === 0 && namecards.length === 0) {
    return (
      <p className='pe-note'>
        Frames and namecards are prizes at the <Link href='/store'>counter</Link>.
      </p>
    );
  }
  return (
    <>
      {frames.length ? (
        <div className='pe-field'>
          <span className='pe-label' id='pe-frame'>frame</span>
          <div className='pe-choices' role='group' aria-labelledby='pe-frame'>
            <button type='button' className='pe-choice' aria-pressed={!frameId} disabled={busy} onClick={() => void choose('frame', null)}>
              <span className='pe-choice-none'>none</span>
            </button>
            {frames.map((choice) => (
              <button
                key={choice.id}
                type='button'
                className='pe-choice'
                aria-pressed={frameId === choice.id}
                aria-label={choice.name}
                title={choice.name}
                disabled={busy}
                onClick={() => void choose('frame', choice.id)}
              >
                <span className='pe-choice-frame' style={choice.legacy ? { boxShadow: `0 0 0 3px ${choice.legacy}` } : undefined}>
                  <FramedAvatar name='preview' imageUrl={imageUrl || null} frame={choice.art as FrameId | null} size='lg' />
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {namecards.length ? (
        <div className='pe-field'>
          <span className='pe-label' id='pe-namecard'>namecard</span>
          <div className='pe-choices' role='group' aria-labelledby='pe-namecard'>
            <button type='button' className='pe-choice pe-choice-wide' aria-pressed={!namecardId} disabled={busy} onClick={() => void choose('background', null)}>
              <span className='pe-choice-none'>none</span>
            </button>
            {namecards.map((choice) => (
              <button
                key={choice.id}
                type='button'
                className='pe-choice pe-choice-wide'
                aria-pressed={namecardId === choice.id}
                aria-label={choice.name}
                title={choice.name}
                disabled={busy}
                onClick={() => void choose('background', choice.id)}
              >
                {choice.art ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/art/namecards/namecard-${choice.art}.svg`} alt='' />
                ) : (
                  <span style={{ background: choice.legacy ?? undefined }} />
                )}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {error ? <p className='tp-error' role='alert'>{error}</p> : null}
    </>
  );
}
