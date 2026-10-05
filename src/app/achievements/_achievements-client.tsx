'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Star } from 'lucide-react';

import { getFloorGames } from '@/features/arcade/components/arcade-game-registry';
import { AchievementIcon } from '@/features/arcade/components/achievements/achievement-icon';
import {
  ArcadePanel,
  ArcadeProgress,
  Num,
} from '@/features/arcade/components/ui/arcade-ui';
import { prefersReducedMotion } from '@/features/arcade/components/ui/arcade-interactive';
import { MAX_FEATURED_ACHIEVEMENTS } from '@/features/users/account-profile-details';
import type {
  AchievementsForUser,
  AchievementView,
} from '@/server/arcade/achievements';

import './_achievements.css';

const HIDE_LOCKED_KEY = 'arcade:ach:hide-locked';

/* Dates are UTC so the server render and the browser agree. */
function earnedOn(at: number | null): string {
  if (at === null) return '';
  return new Date(at).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function share(rate: number): string {
  const pct = rate * 100;
  if (pct <= 0) return '0%';
  if (pct < 1) return '<1%';
  return `${Math.round(pct)}%`;
}

/* Playtime is stored in milliseconds; show it in hours. */
function amount(a: AchievementView, value: number): number {
  if (a.seriesId === 'global-hours') return Math.round((value / 3_600_000) * 10) / 10;
  return value;
}

function hiddenLocked(a: AchievementView): boolean {
  return a.hidden && !a.unlocked;
}

function displayName(a: AchievementView): string {
  return hiddenLocked(a) ? 'secret' : a.name;
}

function FeatureButton({
  a,
  featured,
  canFeature,
  onToggle,
}: {
  a: AchievementView;
  featured: boolean;
  canFeature: boolean;
  onToggle: (id: string) => void;
}) {
  if (!a.unlocked) return null;
  return (
    <button
      type='button'
      className='ach-star'
      aria-pressed={featured}
      aria-label={featured ? `Remove ${a.name} from your profile` : `Show ${a.name} on your profile`}
      title={featured ? 'On your profile' : 'Show on profile'}
      disabled={!featured && !canFeature}
      onClick={() => onToggle(a.id)}
    >
      <Star size={16} strokeLinecap='square' fill={featured ? 'currentColor' : 'none'} aria-hidden />
    </button>
  );
}

/* What one achievement says about itself: its name, what it asks, how far you
   are, what it paid. */
function Detail({
  a,
  featured,
  canFeature,
  onToggle,
}: {
  a: AchievementView;
  featured: boolean;
  canFeature: boolean;
  onToggle: (id: string) => void;
}) {
  const showProgress = !a.unlocked && !a.hidden && a.target > 0;
  return (
    <div className='ach-detail'>
      <div className='flex items-center gap-2'>
        <span className='ach-detail-title'>{displayName(a)}</span>
        <FeatureButton a={a} featured={featured} canFeature={canFeature} onToggle={onToggle} />
      </div>
      <p>{a.description}</p>
      {showProgress ? (
        <>
          <ArcadeProgress current={amount(a, a.current)} max={amount(a, a.target) || 1} tone='tickets' />
          <div className='ach-meta'>
            <span>
              <b><Num value={amount(a, Math.min(a.current, a.target))} /></b> of{' '}
              <b><Num value={amount(a, a.target)} /></b>
            </span>
          </div>
        </>
      ) : null}
      {a.unlocked ? (
        <div className='ach-meta'>
          <span>Earned {earnedOn(a.unlockedAt)}.</span>
        </div>
      ) : null}
      {!hiddenLocked(a) ? (
        <div className='ach-meta'>
          <span><b><Num value={a.xp} /></b> XP</span>
          {a.cosmeticId ? <span>and an item</span> : null}
          <span><b>{share(a.globalRate)}</b> of players</span>
        </div>
      ) : null}
    </div>
  );
}

type Shared = {
  featured: string[];
  canFeature: boolean;
  onToggle: (id: string) => void;
};

function SeriesCard({ tiers, ...shared }: { tiers: AchievementView[] } & Shared) {
  const next = tiers.find((t) => !t.unlocked) ?? tiers[tiers.length - 1]!;
  const [picked, setPicked] = useState<string | null>(null);
  const selected = tiers.find((t) => t.id === picked) ?? next;
  const earned = tiers.filter((t) => t.unlocked).length;
  return (
    <ArcadePanel variant='panel' className='ach-series' data-ach-series={tiers[0]!.seriesId}>
      <div className='ach-series-head'>
        <h3>{tiers[0]!.seriesName ?? tiers[0]!.name}</h3>
        <span><Num value={`${earned}/${tiers.length}`} /></span>
      </div>
      <div className='ach-tiers' role='group' aria-label='Tiers'>
        {tiers.map((t) => (
          <button
            key={t.id}
            type='button'
            className='ach-tier'
            aria-pressed={t.id === selected.id}
            aria-label={`Tier ${t.tier}, ${t.unlocked ? 'earned' : 'not earned'}`}
            onClick={() => setPicked(t.id)}
          >
            <AchievementIcon src={t.icon} alt='' size={60} grayscale={!t.unlocked} />
          </button>
        ))}
      </div>
      <Detail a={selected} featured={shared.featured.includes(selected.id)} canFeature={shared.canFeature} onToggle={shared.onToggle} />
    </ArcadePanel>
  );
}

function FeatCard({ a, ...shared }: { a: AchievementView } & Shared) {
  return (
    <ArcadePanel variant='panel' className='ach-feat' data-ach-feat={a.id} data-secret={a.hidden || undefined}>
      <AchievementIcon src={a.icon} alt='' size={64} grayscale={!a.unlocked && !a.hidden} />
      <Detail a={a} featured={shared.featured.includes(a.id)} canFeature={shared.canFeature} onToggle={shared.onToggle} />
    </ArcadePanel>
  );
}

function Section({
  id,
  title,
  count,
  note,
  children,
}: {
  id: string;
  title: string;
  count?: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={`ach-${id}`} data-ach-section={id} className='ach-section'>
      <div className='ach-section-head'>
        <h2>{title}</h2>
        {count ? <span><Num value={count} /></span> : null}
      </div>
      {note ? <p className='ach-note'>{note}</p> : null}
      {children}
    </section>
  );
}

/* Tiers of a series in catalog order, one list per series. */
function bySeries(list: AchievementView[]): AchievementView[][] {
  const order: string[] = [];
  const map = new Map<string, AchievementView[]>();
  for (const a of list) {
    const key = a.seriesId!;
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key)!.push(a);
  }
  return order.map((key) => map.get(key)!.sort((x, y) => x.tier - y.tier));
}

export function AchievementsClient({
  initial,
  initialFeatured,
}: {
  initial: AchievementsForUser;
  initialFeatured: string[];
}) {
  const [featured, setFeatured] = useState<string[]>(initialFeatured);
  const [hideLocked, setHideLocked] = useState(false);

  // Clear the "new" mark once the page is viewed.
  useEffect(() => {
    void fetch('/api/achievements/seen', { method: 'POST' }).catch(() => {});
  }, []);

  // Restore the filter after mount, so the server render is always the default.
  useEffect(() => {
    try {
      if (window.localStorage.getItem(HIDE_LOCKED_KEY) === '1') setHideLocked(true);
    } catch {
      /* storage disabled: the default stands */
    }
  }, []);

  const toggleHideLocked = useCallback((next: boolean) => {
    setHideLocked(next);
    try {
      window.localStorage.setItem(HIDE_LOCKED_KEY, next ? '1' : '0');
    } catch {
      /* the choice just won't persist */
    }
  }, []);

  const floorOrder = useMemo(() => getFloorGames().map((g) => g.slug), []);

  const sections = useMemo(() => {
    const series = initial.achievements.filter((a) => a.seriesId);
    const game = bySeries(series.filter((a) => a.game)).sort(
      (x, y) => {
        const ix = floorOrder.indexOf(x[0]!.game!);
        const iy = floorOrder.indexOf(y[0]!.game!);
        return (ix < 0 ? 99 : ix) - (iy < 0 ? 99 : iy);
      },
    );
    const play = bySeries(series.filter((a) => !a.game));
    const feats = initial.achievements.filter((a) => !a.seriesId && a.category !== 'secret');
    const secrets = initial.achievements.filter((a) => a.category === 'secret');
    const count = (rows: AchievementView[]) => rows.filter((a) => a.unlocked).length;
    return {
      game,
      play,
      feats,
      secrets,
      counts: {
        game: `${count(game.flat())}/${game.flat().length}`,
        play: `${count(play.flat())}/${play.flat().length}`,
        feats: `${count(feats)}/${feats.length}`,
        secrets: `${count(secrets)}/${secrets.length}`,
      },
    };
  }, [initial.achievements, floorOrder]);

  const keepSeries = (tiers: AchievementView[]) => !hideLocked || tiers.some((t) => t.unlocked);
  const keepOne = (a: AchievementView) => !hideLocked || a.unlocked;
  const games = sections.game.filter(keepSeries);
  const play = sections.play.filter(keepSeries);
  const feats = sections.feats.filter(keepOne);
  const secrets = sections.secrets.filter(keepOne);

  async function toggleFeature(id: string) {
    setFeatured((prev) => {
      const next = prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length >= MAX_FEATURED_ACHIEVEMENTS
          ? prev
          : [...prev, id];
      void fetch('/api/achievements/feature', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: next }),
      }).catch(() => {});
      return next;
    });
  }

  const jumpTo = useCallback((id: string) => {
    document
      .getElementById(`ach-${id}`)
      ?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  }, []);

  const shared: Shared = {
    featured,
    canFeature: featured.length < MAX_FEATURED_ACHIEVEMENTS,
    onToggle: toggleFeature,
  };
  const { summary } = initial;
  const shown = games.length + play.length + feats.length + secrets.length;

  const jumps: Array<{ id: string; label: string; count: string; visible: boolean }> = [
    { id: 'games', label: 'games', count: sections.counts.game, visible: games.length > 0 },
    { id: 'play', label: 'play', count: sections.counts.play, visible: play.length > 0 },
    { id: 'feats', label: 'feats', count: sections.counts.feats, visible: feats.length > 0 },
    { id: 'secrets', label: 'secrets', count: sections.counts.secrets, visible: secrets.length > 0 },
    { id: 'retired', label: 'retired', count: String(initial.retired.length), visible: initial.retired.length > 0 },
  ];

  return (
    <div className='space-y-6'>
      <ArcadePanel variant='panel' className='space-y-4 p-4 sm:p-5'>
        <div className='ach-summary'>
          <div>
            <div className='ach-big'>
              <Num value={summary.unlocked} />
              <small>/<Num value={summary.total} /></small>
            </div>
            <div className='ach-big-label'>earned</div>
          </div>
          <div>
            <div className='ach-big'><Num value={summary.xpEarned} /></div>
            <div className='ach-big-label'>XP from achievements</div>
          </div>
        </div>
        <ArcadeProgress current={summary.unlocked} max={summary.total || 1} tone='tickets' />
      </ArcadePanel>

      <div className='ach-toolbar'>
        {jumps
          .filter((j) => j.visible)
          .map((j) => (
            <button key={j.id} type='button' className='ach-jump' data-ach-jump={j.id} onClick={() => jumpTo(j.id)}>
              {j.label}
              <span className='ach-jump-count'><Num value={j.count} /></span>
            </button>
          ))}
        <label className='ach-hide'>
          <input
            type='checkbox'
            data-ach-hidelocked
            checked={hideLocked}
            onChange={(e) => toggleHideLocked(e.target.checked)}
          />
          hide locked
        </label>
      </div>

      {shown === 0 ? (
        <div className='ach-empty'>Nothing earned yet. Turn off hide locked to see what is there.</div>
      ) : null}

      {games.length > 0 ? (
        <Section id='games' title='games' count={sections.counts.game}>
          <div className='ach-grid'>
            {games.map((tiers) => (
              <SeriesCard key={tiers[0]!.seriesId} tiers={tiers} {...shared} />
            ))}
          </div>
        </Section>
      ) : null}

      {play.length > 0 ? (
        <Section id='play' title='play' count={sections.counts.play}>
          <div className='ach-grid'>
            {play.map((tiers) => (
              <SeriesCard key={tiers[0]!.seriesId} tiers={tiers} {...shared} />
            ))}
          </div>
        </Section>
      ) : null}

      {feats.length > 0 ? (
        <Section id='feats' title='feats' count={sections.counts.feats}>
          <div className='ach-grid'>
            {feats.map((a) => (
              <FeatCard key={a.id} a={a} {...shared} />
            ))}
          </div>
        </Section>
      ) : null}

      {secrets.length > 0 ? (
        <Section
          id='secrets'
          title='secrets'
          count={sections.counts.secrets}
          note='Each one shows a hint until you find it.'
        >
          <div className='ach-grid'>
            {secrets.map((a) => (
              <FeatCard key={a.id} a={a} {...shared} />
            ))}
          </div>
        </Section>
      ) : null}

      {initial.retired.length > 0 ? (
        <Section
          id='retired'
          title='retired'
          count={String(initial.retired.length)}
          note='These left the floor. You keep their XP and items.'
        >
          <div className='ach-grid' data-ach-retired>
            {initial.retired.map((a) => (
              <FeatCard key={a.id} a={a} {...shared} />
            ))}
          </div>
        </Section>
      ) : null}
    </div>
  );
}
