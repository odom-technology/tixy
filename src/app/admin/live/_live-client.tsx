'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { DataTable } from '@/features/admin/ui/data-table';
import { Ago } from '@/features/admin/ui/ago';
import { fmtInt } from '@/features/admin/ui/format';
import { GameName, PlayerLink } from '@/features/admin/ui/metric-ui';
import { AdminPage, Grid, Note, Panel, Stat, Stats } from '@/features/admin/ui/page';
import type { LiveMetrics } from '@/server/admin/metrics/types';

const REFRESH_MS = 10_000;

const STATUS_LABEL: Record<string, string> = { online: 'online', in_game: 'playing', away: 'away' };

/* Polls every 10 s while the tab is visible. Only the numbers change; the
   layout stays put. */
export function LiveClient({ initial }: { initial: LiveMetrics | null }) {
  const [data, setData] = useState<LiveMetrics | null>(initial);
  const [error, setError] = useState<string | null>(initial ? null : 'The live numbers did not load.');
  const [paused, setPaused] = useState(false);
  const busy = useRef(false);

  const load = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const response = await fetch('/api/admin/metrics/live', { cache: 'no-store' });
      if (!response.ok) throw new Error(response.status === 429 ? 'Refreshing too often; waiting.' : `The server answered ${response.status}.`);
      setData((await response.json()) as LiveMetrics);
      setError(null);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    if (paused) return;
    const tick = () => {
      if (document.visibilityState === 'visible') void load();
    };
    const timer = window.setInterval(tick, REFRESH_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [load, paused]);

  const tools = (
    <>
      <span className='adm-topbar-sub' aria-live='polite'>
        {paused ? 'paused' : data ? <>updated <Ago ms={data.at} every={5_000} /></> : 'waiting'}
      </span>
      <button type='button' className='adm-btn' onClick={() => setPaused((value) => !value)} aria-pressed={paused}>
        {paused ? 'resume' : 'pause'}
      </button>
      <button type='button' className='adm-btn' onClick={() => void load()}>refresh</button>
    </>
  );

  if (!data) {
    return (
      <AdminPage title='Live' tools={tools}>
        <Note tone='alert'>{error ?? 'The live numbers did not load.'} It retries every 10 seconds.</Note>
      </AdminPage>
    );
  }

  return (
    <AdminPage title='Live' sub='Who is here now and what they are playing. Refreshes every 10 seconds.' tools={tools}>
      {error ? <Note tone='alert'>{error} Showing the last numbers that loaded.</Note> : null}
      <Stats label='Right now'>
        <Stat label='online' value={fmtInt(data.online)} foot='accounts seen in 2 minutes' />
        <Stat label='playing' value={fmtInt(data.inGame)} foot='accounts in a game' />
        <Stat label='active sessions' value={fmtInt(data.activeSessions)} foot='with guests, last 5 minutes' />
        <Stat label='runs' value={fmtInt(data.last15m.runs)} foot='last 15 minutes' />
        <Stat label='machine rounds' value={fmtInt(data.last15m.rounds)} foot='last 15 minutes' />
        <Stat label='tickets minted' value={fmtInt(data.last15m.ticketsMinted)} tickets foot='last 15 minutes' />
      </Stats>

      <Grid cols='2'>
        <Panel title='By game' sub='Accounts playing from presence, sessions from the game server.' flush>
          <DataTable
            caption='Players by game'
            columns={[{ label: 'game' }, { label: 'playing', align: 'right' }, { label: 'sessions', align: 'right' }]}
            rows={data.byGame.map((row) => ({
              key: row.game.key,
              cells: [<GameName key='g' game={row.game} />, fmtInt(row.players), fmtInt(row.sessions)],
              sort: [row.game.title, row.players, row.sessions],
            }))}
            sortBy={2}
            paged={false}
            emptyTitle='Nobody is in a game.'
          />
        </Panel>
        <Panel title='Open tables' sub='Friends games waiting for a player or under way.' flush>
          <DataTable
            caption='Open tables'
            columns={[{ label: 'game' }, { label: 'waiting', align: 'right' }, { label: 'playing', align: 'right' }]}
            rows={data.openTables.filter((row) => row.waiting || row.playing || row.game.onFloor).map((row) => ({
              key: row.game.key,
              cells: [<GameName key='g' game={row.game} />, fmtInt(row.waiting), fmtInt(row.playing)],
              sort: [row.game.title, row.waiting, row.playing],
            }))}
            paged={false}
            emptyTitle='No open tables.'
          />
        </Panel>
      </Grid>

      <Panel title='Online now' sub='Up to 50 accounts, most recently seen first.' flush>
        <DataTable
          caption='Accounts online now'
          filter='filter players'
          columns={[{ label: 'player' }, { label: 'status' }, { label: 'game' }, { label: 'seen', align: 'right' }]}
          rows={data.players.map((player) => ({
            key: player.userId,
            search: `${player.username} ${player.game?.title ?? ''}`,
            href: `/admin/users?user=${encodeURIComponent(player.userId)}`,
            cells: [
              <PlayerLink key='p' id={player.userId} name={player.username} />,
              STATUS_LABEL[player.status] ?? player.status,
              player.game ? <GameName key='g' game={player.game} /> : 'none',
              <Ago key='a' ms={player.lastSeenAt} />,
            ],
            sort: [player.username, player.status, player.game?.title ?? null, player.lastSeenAt],
            muted: [3, ...(player.game ? [] : [2])],
          }))}
          paged={false}
          scroll
          emptyTitle='Nobody is online.'
        />
      </Panel>
    </AdminPage>
  );
}
