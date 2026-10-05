/* A player's profile, the same for you and for anyone looking
   (docs/design/tixy-rebrand/PROFILES.md). Steam's shape in tixy's look: the
   header carries the player (namecard, framed avatar, name, title, level),
   the showcase is theirs to arrange, and recent activity says what they
   played lately. A new player gets a showcase built from their own numbers,
   so the page looks finished before they touch anything. */

import Link from 'next/link';
import type { ReactNode } from 'react';

import { AchievementIcon } from '@/features/arcade/components/achievements/achievement-icon';
import { getArcadeGameBySlug } from '@/features/arcade/components/arcade-game-registry';
import { getGameDisplayName, getGameDisplayRoute } from '@/features/arcade/lib/game-renames';
import { GameStill } from '@/features/arcade/components/game-previews/game-still';
import { StoreItemPreview } from '@/features/arcade/components/store-item-preview';
import { Num } from '@/features/arcade/components/ui/num';
import { LevelBadge } from '@/features/brand/avatars/level-badge';
import { nextShowcaseUnlock, type ProfileShowcase } from '@/features/users/profile-showcase';
import { FramedAvatar } from '@/features/users/components/framed-avatar';
import { ProfileAvatar } from '@/features/users/components/profile-avatar';
import { Username } from '@/features/users/components/username';
import { getBoardRank, type ProfileGameNumber } from '@/server/arcade/player-profile';
import { rarestFirst, type ProfileView } from '@/server/arcade/player-profile-view';
import type { StoreItem } from '@/server/arcade/rewards/types';

import '@/features/social/tixy-people.css';
import './player-profile.css';

const monthYear = (timestamp: number | null) =>
  timestamp
    ? new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric' }).format(new Date(timestamp)).toLowerCase()
    : null;

function ago(timestamp: number, now = Date.now()) {
  const diff = Math.max(0, now - timestamp);
  if (diff < 60_000) return 'now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

function pct(into: number, need: number) {
  return need > 0 ? Math.max(0, Math.min(100, (into / need) * 100)) : 100;
}

/** Hours with one decimal from an hour up, whole minutes below it. */
function Duration({ ms }: { ms: number }) {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) {
    return (
      <>
        <Num className='tp-num' value={Math.max(minutes, ms > 0 ? 1 : 0)} /> min
      </>
    );
  }
  return (
    <>
      <Num className='tp-num' value={Math.round(ms / 360_000) / 10} decimals={1} /> h
    </>
  );
}

function ordinalSuffix(n: number) {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return 'th';
  return ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
}

const labelFor = (label: string) => (label === 'solved' ? 'solved' : label);

export async function PlayerProfile({
  view,
  self,
  actions,
}: {
  view: ProfileView;
  self: boolean;
  actions: ReactNode;
}) {
  const { account, details, flair, level, achievements, data } = view;
  const name = view.name;
  const joined = monthYear(account.createdAt);
  const meta = [details.pronouns, details.statusText, joined ? `joined ${joined}` : null].filter(Boolean);
  /* An art kit namecard wins over an older background. Without either the
     band is paper 3, so the header has the same shape for everyone. */
  const namecard = flair.namecardArt;
  const background = namecard ? null : (flair.background ?? (details.bannerColor || null));
  const tiles = await Promise.all(
    view.showcases.map(async (showcase, index) => {
      try {
        return await showcaseTile(view, showcase, index, self);
      } catch (error) {
        console.error('[profile] showcase slot failed:', error);
        return null;
      }
    }),
  );
  const shown = tiles.filter(Boolean);
  const next = nextShowcaseUnlock(level.level);
  const nameFlair = { ...flair, title: null, nameColor: flair.nameColor ?? (details.accentColor || null) };

  return (
    <div className='tp pf-page'>
      <section className='pf-hero' aria-label={name}>
        <div className='pf-band' data-plain={namecard || background ? undefined : 'true'} aria-hidden>
          {namecard ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/art/namecards/namecard-${namecard}.svg`} alt='' />
          ) : background ? (
            <span style={{ background }} />
          ) : null}
        </div>
        <div className='pf-id'>
          <span className='pf-avatar'>
            {flair.frameArt ? (
              <FramedAvatar name={name} imageUrl={account.imageUrl} frame={flair.frameArt} size='xl' />
            ) : (
              <ProfileAvatar name={name} imageUrl={account.imageUrl} size='xl' ring={flair.frameColor ?? undefined} />
            )}
          </span>
          <div className='pf-who'>
            <h1>
              <Username name={name} flair={nameFlair} />
            </h1>
            {flair.title ? <p className='pf-title'>{flair.title}</p> : null}
            {meta.length ? <p className='pf-meta'>{meta.join(' · ')}</p> : null}
          </div>
          <div className='pf-level'>
            <LevelBadge level={level.level} size={64} />
            <div>
              <strong>
                Level <Num className='tp-num' value={level.level} />
              </strong>
              <span className='tp-bar' aria-hidden>
                <i style={{ width: `${pct(level.into, level.need)}%` }} />
              </span>
              <small>
                <Num className='tp-num' value={Math.max(0, level.need - level.into)} /> xp to{' '}
                <Num className='tp-num' value={level.level + 1} />
              </small>
            </div>
          </div>
        </div>
        {details.bio ? <p className='pf-bio'>{details.bio}</p> : null}
        <div className='pf-actions'>{actions}</div>
      </section>

      <div className='pf-cols'>
        <div className='pf-main'>
          {shown.length ? (
            <div className='pf-showcase' id='showcase'>
              {shown}
            </div>
          ) : null}
          {self && next ? (
            <p className='pf-unlock'>
              Level <Num className='tp-num' value={next.level} /> opens showcase slot{' '}
              <Num className='tp-num' value={next.slots} />.
            </p>
          ) : null}

          <section className='tp-panel pf-recent' aria-labelledby='pf-recent'>
            <h2 id='pf-recent'>
              recent activity
              {data.summary.twoWeeksMs > 0 ? (
                <small>
                  <Duration ms={data.summary.twoWeeksMs} /> in 2 weeks
                </small>
              ) : null}
            </h2>
            {data.recent.length === 0 ? (
              <p className='tp-note'>
                {self ? (
                  <>
                    Nothing in the last 2 weeks. The <Link href='/'>floor</Link> is open.
                  </>
                ) : (
                  'Nothing in the last 2 weeks.'
                )}
              </p>
            ) : (
              data.recent.map((game) => (
                <Link key={game.slug} href={game.href} className='pf-played'>
                  <span className='tp-screen pf-thumb' aria-hidden>
                    <GameStill slug={game.slug} />
                  </span>
                  <span className='pf-played-main'>
                    <strong>{game.name}</strong>
                    <small>
                      {game.best ? (
                        <>
                          <Num className='tp-num' value={game.best.value} /> {labelFor(game.best.label)}
                          {' · '}
                        </>
                      ) : null}
                      <Duration ms={game.totalMs} /> on record
                    </small>
                  </span>
                  <span className='pf-played-side'>
                    {game.weekPlays > 0 ? (
                      <span>
                        <Num className='tp-num' value={game.weekPlays} /> {game.weekPlays === 1 ? 'play' : 'plays'} this week
                      </span>
                    ) : null}
                    <small>last played {ago(game.lastPlayedAt) === 'now' ? 'now' : `${ago(game.lastPlayedAt)} ago`}</small>
                  </span>
                </Link>
              ))
            )}
          </section>

          <section className='tp-panel' aria-labelledby='pf-results'>
            <h2 id='pf-results'>
              recent results
              {data.results.length ? <small><Num value={data.results.length} /></small> : null}
            </h2>
            {data.results.length === 0 ? (
              <p className='tp-note'>{self ? 'Your runs and matches show here.' : 'No results yet.'}</p>
            ) : (
              data.results.map((result) => (
                <div key={result.id} className='tp-row'>
                  <Link href={result.href} className='tp-row-main'>
                    <strong>{result.name}</strong>
                    <small>
                      {result.kind === 'score'
                        ? 'run'
                        : `${result.outcome === 'won' ? 'beat' : result.outcome === 'lost' ? 'lost to' : 'drew with'} ${result.opponent ?? 'a player'}`}
                    </small>
                  </Link>
                  {result.kind === 'score' ? (
                    <Num className='tp-num tp-result-num' value={result.score} />
                  ) : (
                    <span className='tp-result-num' style={{ fontSize: 15, fontWeight: 700 }}>
                      {result.outcome === 'won' ? 'win' : result.outcome === 'lost' ? 'loss' : 'draw'}
                    </span>
                  )}
                  <span className='tp-result-when'>{ago(result.at)}</span>
                </div>
              ))
            )}
          </section>
        </div>

        <aside className='pf-side' aria-label='stats'>
          <dl className='pf-stats'>
            <div>
              <dt>on the floor</dt>
              <dd>{data.summary.totalMs > 0 ? <Duration ms={data.summary.totalMs} /> : <Num className='tp-num' value={0} />}</dd>
            </div>
            <div>
              <dt>games played</dt>
              <dd><Num className='tp-num' value={data.summary.gamesPlayed} /></dd>
            </div>
            <div>
              <dt>achievements</dt>
              <dd>
                {self ? (
                  <Link href='/achievements'>
                    <Num className='tp-num' value={achievements.unlocked} />
                  </Link>
                ) : (
                  <Num className='tp-num' value={achievements.unlocked} />
                )}
                <span className='pf-of'> of <Num className='tp-num' value={achievements.total} /></span>
              </dd>
            </div>
            <div>
              <dt>prizes</dt>
              <dd><Num className='tp-num' value={view.ownedItems.length} /></dd>
            </div>
            {data.season && !view.showcases.some((slot) => slot.type === 'season') ? (
              <div>
                <dt>{data.season.name}</dt>
                <dd>
                  tier <Num className='tp-num' value={data.season.tier} />
                  <span className='pf-of'> of <Num className='tp-num' value={data.season.maxTier} /></span>
                </dd>
              </div>
            ) : null}
          </dl>
          {data.games.length ? (
            <section className='pf-side-bests' aria-labelledby='pf-bests-side'>
              <h2 id='pf-bests-side'>bests</h2>
              {data.games.map((game) => (
                <Link key={game.slug} href={game.href} className='pf-best-row'>
                  <span>{game.name}</span>
                  <Num className='tp-num' value={game.value} />
                  <small>{labelFor(game.label)}</small>
                </Link>
              ))}
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

/* ── the showcase: each slot the player set up, drawn as one block ──────── */

function ItemGrid({ items }: { items: StoreItem[] }) {
  return (
    <div className='pf-items'>
      {items.map((item) => (
        <div key={item.id} className='pf-item'>
          <div className='pf-item-art'>
            <StoreItemPreview
              item={{ id: item.id, name: item.name, gameType: item.gameType, slots: item.slots, assetRef: item.assetRef }}
              forceSquare
            />
          </div>
          <strong>{item.name.toLowerCase()}</strong>
        </div>
      ))}
    </div>
  );
}

function GameScreen({ slug }: { slug: string }) {
  return (
    <span className='tp-screen pf-screen' aria-hidden>
      <GameStill slug={slug} />
    </span>
  );
}

async function featuredScoreTile(game: ProfileGameNumber, key: string, self: boolean, name: string) {
  const rank = await getBoardRank(game.slug, game.label, game.value);
  return (
    <section key={key} className='pf-block pf-feature' aria-label={`featured score, ${game.name}`}>
      <Link href={game.href} className='pf-feature-link'>
        <GameScreen slug={game.slug} />
        <span className='pf-feature-text'>
          <span className='pf-block-head'>{game.name}</span>
          <span className='pf-feature-num'>
            <Num className='tp-num' value={game.value} />
            <span>{labelFor(game.label)}</span>
          </span>
          {rank ? (
            <span className='pf-feature-rank'>
              <Num className='tp-num' value={rank.rank} />
              {ordinalSuffix(rank.rank)} of <Num className='tp-num' value={rank.of} /> on the board
            </span>
          ) : null}
          <span className='pf-feature-cta'>{self ? 'play' : `beat ${name}`}</span>
        </span>
      </Link>
    </section>
  );
}

async function showcaseTile(
  view: ProfileView,
  showcase: ProfileShowcase,
  index: number,
  self: boolean,
): Promise<ReactNode> {
  const key = `${showcase.type}:${showcase.ref}:${index}`;
  const { data, achievements } = view;
  switch (showcase.type) {
    case 'featured-score': {
      const game = data.numbers.find((entry) => entry.slug === showcase.ref);
      return game ? featuredScoreTile(game, key, self, view.name) : null;
    }
    case 'favorite-game': {
      const recent = data.recent.find((entry) => entry.slug === showcase.ref);
      const best = data.numbers.find((entry) => entry.slug === showcase.ref);
      const link = recent ?? best;
      const totalMs = recent?.totalMs ?? best?.playtimeMs ?? 0;
      if (!link && totalMs === 0) return null;
      const game = getArcadeGameBySlug(showcase.ref);
      if (!game) return null;
      const title = getGameDisplayName(game.slug, game.title).toLowerCase();
      return (
        <section key={key} className='pf-block pf-favorite' aria-label={`favorite game, ${title}`}>
          <h2 className='pf-block-title'>favorite game</h2>
          <Link href={getGameDisplayRoute(game.slug, game.href)} className='pf-favorite-link'>
            <GameScreen slug={game.slug} />
            <span className='pf-favorite-text'>
              <span className='pf-block-head'>{title}</span>
              <span className='pf-facts'>
                <span>
                  <Duration ms={totalMs} /> on record
                </span>
                {recent ? (
                  <span>
                    <Num className='tp-num' value={recent.weekPlays} /> this week
                  </span>
                ) : null}
                {best ? (
                  <span>
                    <Num className='tp-num' value={best.value} /> {labelFor(best.label)}
                  </span>
                ) : null}
              </span>
            </span>
          </Link>
        </section>
      );
    }
    case 'achievements': {
      const shown = achievements.featured.slice(0, 6);
      if (shown.length === 0 && achievements.next.length > 0) {
        // Nothing earned yet: the closest three, grey, with how far along.
        return (
          <section key={key} className='pf-block' aria-labelledby={`${key}-h`}>
            <h2 id={`${key}-h`} className='pf-block-title'>
              {self ? 'closest achievements' : 'achievements'}
              <small>
                <Num className='tp-num' value={0} /> of <Num className='tp-num' value={achievements.total} />
              </small>
            </h2>
            <div className='pf-medals'>
              {achievements.next.map((achievement) => (
                <div key={achievement.id} className='pf-medal' data-locked='true' title={achievement.description}>
                  <AchievementIcon src={achievement.icon} alt='' size={56} grayscale />
                  <strong>{achievement.name}</strong>
                  <small>
                    <Num value={Math.min(achievement.current, achievement.target)} /> of <Num value={achievement.target} />
                  </small>
                </div>
              ))}
            </div>
          </section>
        );
      }
      if (shown.length === 0) return null;
      return (
        <section key={key} className='pf-block' aria-labelledby={`${key}-h`}>
          <h2 id={`${key}-h`} className='pf-block-title'>
            achievements
            <small>
              <Num className='tp-num' value={achievements.unlocked} /> of <Num className='tp-num' value={achievements.total} />
            </small>
          </h2>
          <div className='pf-medals'>
            {shown.map((achievement) => (
              <div key={achievement.id} className='pf-medal' title={achievement.description}>
                <AchievementIcon src={achievement.icon} alt='' size={56} />
                <strong>{achievement.name}</strong>
                <small>
                  <Num value={Math.max(0.1, Math.round(achievement.globalRate * 1000) / 10)} decimals={1} />% have it
                </small>
              </div>
            ))}
          </div>
        </section>
      );
    }
    case 'items': {
      const owned = new Map(view.ownedItems.map((item) => [item.id, item]));
      let items = showcase.refs.map((id) => owned.get(id)).filter((item): item is StoreItem => Boolean(item));
      if (items.length === 0) {
        const lead = view.details.featuredItemId ? owned.get(view.details.featuredItemId) : undefined;
        items = [...(lead ? [lead] : []), ...rarestFirst(view.ownedItems).filter((item) => item !== lead)].slice(0, 4);
      }
      if (items.length === 0) return null;
      return (
        <section key={key} className='pf-block' aria-labelledby={`${key}-h`}>
          <h2 id={`${key}-h`} className='pf-block-title'>
            prizes
            <small>
              <Num className='tp-num' value={view.ownedItems.length} />
            </small>
          </h2>
          <ItemGrid items={items} />
        </section>
      );
    }
    case 'season': {
      const season = data.season;
      if (!season) return null;
      return (
        <section key={key} className='pf-block pf-season' aria-labelledby={`${key}-h`}>
          {season.medal ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className='pf-season-medal'
              data-owned={season.medal.owned ? 'true' : undefined}
              src={season.medal.art}
              alt=''
              width={88}
              height={88}
            />
          ) : null}
          <div className='pf-season-text'>
            <h2 id={`${key}-h`} className='pf-block-title'>{season.name}</h2>
            <strong className='pf-season-tier'>
              Tier <Num className='tp-num' value={season.tier} />
              <span> of <Num className='tp-num' value={season.maxTier} /></span>
            </strong>
            <span className='tp-bar' aria-hidden>
              <i style={{ width: `${pct(season.tier, season.maxTier)}%` }} />
            </span>
            {season.medal && !season.medal.owned ? (
              <small>
                The medal comes at tier <Num className='tp-num' value={season.medal.tier} />.
              </small>
            ) : null}
          </div>
        </section>
      );
    }
    case 'bests': {
      const pinned = showcase.refs
        .map((slug) => data.numbers.find((entry) => entry.slug === slug))
        .filter((game): game is ProfileGameNumber => Boolean(game));
      const games = (pinned.length ? pinned : data.numbers).slice(0, 6);
      if (games.length === 0) return null;
      return (
        <section key={key} className='pf-block' aria-labelledby={`${key}-h`}>
          <h2 id={`${key}-h`} className='pf-block-title'>
            bests
            <small>
              <Num className='tp-num' value={data.numbers.length} />
            </small>
          </h2>
          <div className='tp-games pf-games'>
            {games.map((game) => (
              <Link key={game.slug} href={game.href} className='tp-game'>
                <span className='tp-screen' aria-hidden>
                  <GameStill slug={game.slug} />
                </span>
                <span className='tp-game-name'>{game.name}</span>
                <span className='tp-game-fact'>
                  <Num className='tp-num' value={game.value} />
                  {labelFor(game.label)}
                </span>
              </Link>
            ))}
          </div>
        </section>
      );
    }
    default:
      return null;
  }
}
