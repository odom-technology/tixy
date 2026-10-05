'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import { ArcadeButton, ArcadeSegmented } from '@/features/arcade/components/ui/arcade-ui';
import { SFX_BANK, type SfxId } from '@/features/arcade/lib/sfx-bank';
import { SAMPLED_CUES } from '@/features/arcade/lib/sfx-cues';
import {
  ARCADE_SOUND_CUES,
  hasProceduralCue,
  renderProceduralCue,
  SoundManager,
  type SoundLevel,
} from '@/features/arcade/lib/sound-manager';

import '../kit.css';

type Take = { url: string; ms: number; peakDb: number; punchDb: number };
type TakeIndex = Record<string, { bank: string; prompt: string; pick: number[]; takes: Take[] }>;

const PICKS_KEY = 'tixy-kit-sound-picks';
const LEVELS = [
  { value: 'off', label: 'off' },
  { value: 'low', label: 'low' },
  { value: 'high', label: 'high' },
] as const;

const subscribe = (fn: () => void) => SoundManager.subscribe(fn);
const level = () => SoundManager.getLevel();
const serverLevel = (): SoundLevel => 'off';

/* Every sampled sound, every cue, and (in development, after
   `npm run sfx -- takes`) every generated take, to audition and pick. */
export function SoundSheet() {
  const current = useSyncExternalStore(subscribe, level, serverLevel);
  const [index, setIndex] = useState<TakeIndex | null>(null);
  const [bank, setBank] = useState('all');
  const [picks, setPicks] = useState<Record<string, number[]>>({});
  const [copied, setCopied] = useState(false);

  // scripts/sfx/measure.ts drives these from a headless browser.
  useEffect(() => {
    Object.assign(window, { __tixySound: { renderProceduralCue, SoundManager, SFX_BANK, SAMPLED_CUES, ARCADE_SOUND_CUES } });
  }, []);

  useEffect(() => {
    void fetch('/audio/sfx-takes/index.json', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: TakeIndex | null) => {
        setIndex(data);
        if (!data) return;
        let saved: Record<string, number[]> = {};
        try {
          saved = JSON.parse(localStorage.getItem(PICKS_KEY) ?? '{}');
        } catch { /* fresh picks */ }
        const start: Record<string, number[]> = {};
        for (const [id, entry] of Object.entries(data)) start[id] = saved[id] ?? entry.pick;
        setPicks(start);
      })
      .catch(() => setIndex(null));
  }, []);

  const banks = useMemo(() => {
    const all = new Set<string>(Object.values(SFX_BANK).map((e) => e.bank));
    for (const entry of Object.values(index ?? {})) all.add(entry.bank);
    return ['all', ...Array.from(all).sort((a, b) => (a === 'core' ? -1 : b === 'core' ? 1 : a.localeCompare(b)))];
  }, [index]);

  const inBank = (b: string) => bank === 'all' || b === bank;
  const cuesFor = (id: string) => Object.entries(SAMPLED_CUES).filter(([, c]) => c.sfx === id).map(([cue]) => cue);

  const togglePick = (id: string, take: number) => {
    setPicks((prev) => {
      const had = prev[id] ?? [];
      const next = had.includes(take) ? had.filter((t) => t !== take) : [...had, take].sort((a, b) => a - b);
      const all = { ...prev, [id]: next };
      try {
        localStorage.setItem(PICKS_KEY, JSON.stringify(all));
      } catch { /* blocked storage */ }
      return all;
    });
    setCopied(false);
  };

  const changed = index
    ? Object.fromEntries(
        Object.entries(picks).filter(([id, p]) => index[id] && p.length > 0 && p.join() !== index[id]!.pick.join()),
      )
    : {};

  const copyPicks = () => {
    void navigator.clipboard.writeText(`npm run sfx -- pick '${JSON.stringify(changed)}'`).then(() => setCopied(true));
  };

  return (
    <main className='kit-sheet'>
      <header className='kit-head'>
        <h1>Sounds</h1>
        <p>Click to play. The first click turns audio on; samples arrive a moment later.</p>
      </header>

      <div className='kit-sound-bar'>
        <ArcadeSegmented
          items={LEVELS}
          value={current}
          onChange={(value) => SoundManager.setLevel(value)}
          ariaLabel='Sound level'
        />
        <div className='kit-row-items' role='group' aria-label='Bank'>
          {banks.map((b) => (
            <ArcadeButton key={b} size='sm' pressed={b === bank} onClick={() => setBank(b)}>
              {b}
            </ArcadeButton>
          ))}
        </div>
      </div>

      {index ? (
        <section className='kit-section'>
          <h2>Takes</h2>
          <p className='kit-note'>
            Every generated take, trimmed and levelled as it would ship. Star the ones to keep; more than one ships as
            variants. {Object.keys(changed).length > 0 ? `${Object.keys(changed).length} changed.` : null}
          </p>
          {Object.keys(changed).length > 0 ? (
            <div className='kit-body'>
              <ArcadeButton size='sm' tone='primary' onClick={copyPicks}>
                {copied ? 'copied' : 'copy pick command'}
              </ArcadeButton>
            </div>
          ) : null}
          <div className='kit-sound-list'>
            {Object.entries(index)
              .filter(([, entry]) => inBank(entry.bank))
              .map(([id, entry]) => (
                <div key={id} className='kit-sound-item'>
                  <div className='kit-sound-name'>
                    <strong>{id}</strong> <span>{entry.bank}</span>
                  </div>
                  <p className='kit-sound-prompt'>{entry.prompt}</p>
                  <div className='kit-row-items'>
                    {entry.takes.map((take, n) => {
                      const starred = (picks[id] ?? entry.pick).includes(n);
                      return (
                        <span key={take.url} className='kit-sound-take'>
                          <ArcadeButton size='sm' onClick={() => SoundManager.audition({ url: take.url })}>
                            take {n} · {take.ms} ms
                          </ArcadeButton>
                          <ArcadeButton
                            size='sm'
                            pressed={starred}
                            aria-label={`${starred ? 'Unpick' : 'Pick'} take ${n}`}
                            onClick={() => togglePick(id, n)}
                          >
                            {starred ? '★' : '☆'}
                          </ArcadeButton>
                        </span>
                      );
                    })}
                  </div>
                </div>
              ))}
          </div>
        </section>
      ) : null}

      <section className='kit-section'>
        <h2>Shipped samples</h2>
        <div className='kit-sound-list'>
          {(Object.keys(SFX_BANK) as SfxId[])
            .filter((id) => inBank(SFX_BANK[id].bank))
            .map((id) => {
              const entry = SFX_BANK[id];
              const cues = cuesFor(id);
              return (
                <div key={id} className='kit-sound-item'>
                  <div className='kit-sound-name'>
                    <strong>{id}</strong> <span>{entry.bank} · {entry.ms} ms{'loop' in entry ? ' · loop' : ''}</span>
                  </div>
                  <div className='kit-row-items'>
                    {entry.files.map((url, n) => (
                      <ArcadeButton key={url} size='sm' onClick={() => SoundManager.audition({ url })}>
                        {entry.files.length > 1 ? `variant ${n}` : 'play'}
                      </ArcadeButton>
                    ))}
                  </div>
                  <p className='kit-sound-prompt'>{cues.length ? `cues: ${cues.join(', ')}` : 'no cue plays this yet'}</p>
                </div>
              );
            })}
        </div>
      </section>

      <section className='kit-section'>
        <h2>Cues</h2>
        <p className='kit-note'>
          A cue as games play it, and its procedural sound beside it where it has a sample too.
        </p>
        <div className='kit-sound-cues'>
          {ARCADE_SOUND_CUES.filter((cue) => bank === 'all' || (SAMPLED_CUES[cue] && SFX_BANK[SAMPLED_CUES[cue]!.sfx].bank === bank)).map((cue) => {
            const sampled = SAMPLED_CUES[cue];
            return (
              <div key={cue} className='kit-sound-cue'>
                <span>{cue}</span>
                <ArcadeButton size='sm' onClick={() => SoundManager.play(cue)}>play</ArcadeButton>
                {sampled && hasProceduralCue(cue) ? (
                  <ArcadeButton size='sm' onClick={() => SoundManager.audition({ cue })}>synth</ArcadeButton>
                ) : null}
                {sampled ? <em>{sampled.sfx}</em> : null}
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
