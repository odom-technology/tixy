'use client';

import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';

import { ARCADE_GAMES } from '@/features/arcade/components/arcade-game-registry';
import { ArcadeInput, ArcadeNotice, ArcadeStat } from '@/features/arcade/components/ui/arcade-ui';
import { ArcadeSwitch } from '@/features/arcade/components/ui/arcade-interactive';
import {
  SITE_SECTIONS,
  type SiteAvailabilityConfig,
  type SiteSectionId,
} from '@/lib/site-availability';

type AvailabilityEditorProps = {
  config: SiteAvailabilityConfig;
  saved: SiteAvailabilityConfig;
  onChange: (config: SiteAvailabilityConfig) => void;
  disabled: boolean;
};

const gameName = new Map(ARCADE_GAMES.map(({ slug, title }) => [slug, title]));

export function describeAvailabilityChanges(
  saved: SiteAvailabilityConfig,
  draft: SiteAvailabilityConfig,
) {
  const changes: string[] = [];
  for (const section of SITE_SECTIONS) {
    if (saved.sections[section.id] !== draft.sections[section.id]) {
      changes.push(`${section.label}: ${draft.sections[section.id] ? 'reopen' : 'close'}`);
    }
  }
  if (saved.registrationEnabled !== draft.registrationEnabled) {
    changes.push(`New account registration: ${draft.registrationEnabled ? 'reopen' : 'close'}`);
  }
  if (saved.ticketBundlesEnabled !== draft.ticketBundlesEnabled) {
    changes.push(`Ticket bundles: ${draft.ticketBundlesEnabled ? 'reopen' : 'close'}`);
  }
  const savedGames = new Set(saved.disabledGames);
  const draftGames = new Set(draft.disabledGames);
  for (const game of ARCADE_GAMES) {
    if (savedGames.has(game.slug) !== draftGames.has(game.slug)) {
      changes.push(`${game.title}: ${draftGames.has(game.slug) ? 'disable' : 'reopen'}`);
    }
  }
  if (saved.disabledGameDisplay !== draft.disabledGameDisplay) {
    changes.push(`Unavailable game cards: ${draft.disabledGameDisplay === 'hidden' ? 'hide' : 'show with notice'}`);
  }
  if (saved.message.trim() !== draft.message.trim()) {
    changes.push('Unavailable message: update');
  }
  return changes;
}

export function AvailabilityEditor({ config, saved, onChange, disabled }: AvailabilityEditorProps) {
  const [gameSearch, setGameSearch] = useState('');
  const filteredGames = useMemo(() => {
    const term = gameSearch.trim().toLowerCase();
    return term
      ? ARCADE_GAMES.filter((game) => `${game.title} ${game.slug} ${game.sectionId}`.toLowerCase().includes(term))
      : ARCADE_GAMES;
  }, [gameSearch]);
  const liveOpenSections = SITE_SECTIONS.filter(({ id }) => saved.sections[id]).length;
  const draftOpenSections = SITE_SECTIONS.filter(({ id }) => config.sections[id]).length;
  const liveOpenGames = saved.sections.games ? ARCADE_GAMES.length - saved.disabledGames.length : 0;
  const draftOpenGames = config.sections.games ? ARCADE_GAMES.length - config.disabledGames.length : 0;
  const changes = describeAvailabilityChanges(saved, config);

  const setSection = (sectionId: SiteSectionId, enabled: boolean) => {
    onChange({ ...config, sections: { ...config.sections, [sectionId]: enabled } });
  };
  const setGame = (slug: string, enabled: boolean) => {
    onChange({
      ...config,
      disabledGames: enabled
        ? config.disabledGames.filter((current) => current !== slug)
        : [...config.disabledGames, slug],
    });
  };

  return (
    <div className='space-y-5'>
      <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-4'>
        <ArcadeStat label='Open sections' value={`${draftOpenSections}/${SITE_SECTIONS.length}`} sub={`Live: ${liveOpenSections}/${SITE_SECTIONS.length}`} tone='primary' />
        <ArcadeStat label='Available games' value={`${draftOpenGames}/${ARCADE_GAMES.length}`} sub={`Live: ${liveOpenGames}/${ARCADE_GAMES.length}`} tone='info' />
        <ArcadeStat label='Registration' value={config.registrationEnabled ? 'Open' : 'Closed'} sub={`Live: ${saved.registrationEnabled ? 'open' : 'closed'}`} tone={config.registrationEnabled ? 'prize' : 'danger'} />
        <ArcadeStat label='Ticket bundles' value={config.ticketBundlesEnabled ? 'Open' : 'Closed'} sub={`Live: ${saved.ticketBundlesEnabled ? 'open' : 'closed'}`} tone={config.ticketBundlesEnabled ? 'prize' : 'danger'} />
      </div>

      {changes.length > 0 ? (
        <ArcadeNotice tone='warning'>Draft changes are not live. Review and save to publish {changes.length} change{changes.length === 1 ? '' : 's'}.</ArcadeNotice>
      ) : (
        <ArcadeNotice tone='info'>The draft matches the live availability settings.</ArcadeNotice>
      )}
      <p className='text-sm text-faint'>Availability rules apply to everyone, including admins. Admin controls stay reachable.</p>

      <section className='arcade-card p-4 sm:p-5' aria-labelledby='availability-sections-title'>
        <h2 id='availability-sections-title' className='arcade-display text-lg uppercase text-strong'>Site sections</h2>
        <p className='mt-1 text-sm text-faint'>Choose which areas visitors can enter and use.</p>
        <p className='mt-2 text-xs leading-5 text-faint'>Closing Games prevents new play. Existing saved sessions and wagers can finish or settle; daily puzzles pause immediately.</p>
        <div className='mt-4 grid gap-3 xl:grid-cols-2'>
          {SITE_SECTIONS.map((section) => (
            <div key={section.id} className='arcade-card-inset flex items-center justify-between gap-4 p-4'>
              <div className='min-w-0'>
                <p className='font-semibold text-strong'>{section.label}</p>
                <p className='mt-1 text-xs leading-5 text-faint'>{section.description}</p>
              </div>
              <ArcadeSwitch
                checked={config.sections[section.id]}
                onChange={(enabled) => setSection(section.id, enabled)}
                label={`${section.label} ${config.sections[section.id] ? 'open' : 'closed'}`}
                disabled={disabled}
                className='shrink-0'
              />
            </div>
          ))}
        </div>
      </section>

      <section className='arcade-card p-4 sm:p-5' aria-labelledby='availability-access-title'>
        <h2 id='availability-access-title' className='arcade-display text-lg uppercase text-strong'>Accounts & purchases</h2>
        <div className='mt-4 grid gap-3 xl:grid-cols-2'>
          <div className='arcade-card-inset flex items-center justify-between gap-4 p-4'>
            <div>
              <p className='font-semibold text-strong'>New account registration</p>
              <p className='mt-1 text-xs text-faint'>Existing accounts remain available when this is closed.</p>
            </div>
            <ArcadeSwitch checked={config.registrationEnabled} onChange={(enabled) => onChange({ ...config, registrationEnabled: enabled })} label='New account registration' disabled={disabled} className='shrink-0' />
          </div>
          <div className='arcade-card-inset flex items-center justify-between gap-4 p-4'>
            <div>
              <p className='font-semibold text-strong'>Ticket bundles</p>
              <p className='mt-1 text-xs text-faint'>Control new bundle purchases separately from the store.</p>
            </div>
            <ArcadeSwitch checked={config.ticketBundlesEnabled} onChange={(enabled) => onChange({ ...config, ticketBundlesEnabled: enabled })} label='Ticket bundle purchases' disabled={disabled} className='shrink-0' />
          </div>
        </div>
      </section>

      <section className='arcade-card p-4 sm:p-5' aria-labelledby='availability-games-title'>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <div>
            <h2 id='availability-games-title' className='arcade-display text-lg uppercase text-strong'>Individual games</h2>
            <p className='mt-1 text-sm text-faint'>Turn off one cabinet without closing the whole game floor.</p>
          </div>
          <span className='text-xs font-bold uppercase text-faint'>{config.disabledGames.length} disabled</span>
        </div>
        {!config.sections.games ? (
          <ArcadeNotice tone='warning' className='mt-4'>The Games section is closed, so every game is unavailable until it reopens.</ArcadeNotice>
        ) : null}
        <div className='mt-4 max-w-md'>
          <ArcadeInput
            type='search'
            icon={<Search size={16} aria-hidden='true' />}
            value={gameSearch}
            onChange={(event) => setGameSearch(event.target.value)}
            placeholder='Search games or aisles'
            aria-label='Search games to manage availability'
            disabled={disabled}
          />
        </div>
        <div className='mt-4 grid max-h-[31rem] gap-2 overflow-y-auto pr-1 xl:grid-cols-2'>
          {filteredGames.map((game) => (
            <div key={game.slug} className='arcade-card-inset flex items-center justify-between gap-4 p-3'>
              <div className='min-w-0'>
                <p className='font-semibold text-strong'>{game.title}</p>
                <p className='text-xs capitalize text-faint'>{game.sectionId}</p>
              </div>
              <ArcadeSwitch
                checked={!config.disabledGames.includes(game.slug)}
                onChange={(enabled) => setGame(game.slug, enabled)}
                label={`${game.title} availability`}
                disabled={disabled}
                className='shrink-0'
              />
            </div>
          ))}
          {filteredGames.length === 0 ? <p className='p-4 text-sm text-faint'>No games match that search.</p> : null}
        </div>
      </section>

      <section className='arcade-card p-4 sm:p-5' aria-labelledby='availability-message-title'>
        <h2 id='availability-message-title' className='arcade-display text-lg uppercase text-strong'>Unavailable experience</h2>
        <div className='mt-4 grid gap-5 xl:grid-cols-2'>
          <label className='block'>
            <span className='arcade-kicker mb-2 block'>Game cards</span>
            <select
              className='arcade-input w-full px-3 py-2 text-sm'
              value={config.disabledGameDisplay}
              onChange={(event) => onChange({ ...config, disabledGameDisplay: event.target.value as SiteAvailabilityConfig['disabledGameDisplay'] })}
              disabled={disabled}
            >
              <option value='visible'>Show with an unavailable notice</option>
              <option value='hidden'>Hide disabled games</option>
            </select>
          </label>
          <label className='block'>
            <span className='arcade-kicker mb-2 block'>Visitor message</span>
            <textarea
              className='arcade-input w-full px-3 py-2 text-sm'
              rows={4}
              maxLength={1200}
              value={config.message}
              onChange={(event) => onChange({ ...config, message: event.target.value })}
              disabled={disabled}
            />
            <span className='mt-1.5 block text-xs text-faint'>Shown when a closed section or game is visited.</span>
          </label>
        </div>
        <div className='arcade-card-inset mt-4 p-4' aria-label='Unavailable message preview'>
          <p className='arcade-kicker'>Visitor preview</p>
          <p className='mt-2 whitespace-pre-wrap text-sm text-body'>{config.message.trim() || 'Add a message for visitors.'}</p>
        </div>
      </section>
    </div>
  );
}

export function availabilityConfigsEqual(a: SiteAvailabilityConfig, b: SiteAvailabilityConfig) {
  if (a.registrationEnabled !== b.registrationEnabled || a.ticketBundlesEnabled !== b.ticketBundlesEnabled || a.disabledGameDisplay !== b.disabledGameDisplay || a.message.trim() !== b.message.trim()) return false;
  if (SITE_SECTIONS.some(({ id }) => a.sections[id] !== b.sections[id])) return false;
  if (a.disabledGames.length !== b.disabledGames.length) return false;
  const aGames = new Set(a.disabledGames);
  return b.disabledGames.every((slug) => aGames.has(slug) && gameName.has(slug));
}
