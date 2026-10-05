'use client';

import { useState } from 'react';

import { DataTable } from '@/features/admin/ui/data-table';
import { fmtInt } from '@/features/admin/ui/format';
import { PlayerLink } from '@/features/admin/ui/metric-ui';
import { AdminPage, Grid, Note, Panel, Stat, Stats } from '@/features/admin/ui/page';
import { useToast } from '@/features/admin/ui/toast';

import { ActionDialog } from '../users/_action-dialog';

type BoardsReport = {
  month: string;
  alreadyAwarded: boolean;
  boards: { key: string; label: string; game: string; total: number; ceiling: number; rows: { rank: number; userId: string; username: string | null; credits: number }[] }[];
  total: number;
  players: number;
  maxPayout: number;
  ceiling: number;
  overCeiling: boolean;
};

type WeeklyReport = Omit<BoardsReport, 'month'> & { week: string; closed: boolean };

type QuestsReport = {
  dryRun: boolean;
  total: number;
  results: { gameSlug: string; total: number; completed: Record<string, number> }[];
};

async function runOp<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch('/api/admin/ops', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `The server answered ${response.status}.`);
  return data;
}

/* The monthly award's last month: it is retired from 2026-10. */
const LAST_MONTHLY = '2026-09';

/* This week's Monday, or the first paid week's before it starts. */
function thisWeek() {
  const now = Math.max(Date.now(), Date.UTC(2026, 9, 5));
  const date = new Date(now);
  const monday = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - ((date.getUTCDay() + 6) % 7) * 86_400_000;
  return new Date(monday).toISOString().slice(0, 10);
}

function BoardsTable({ boards }: { boards: BoardsReport['boards'] }) {
  return (
    <div style={{ margin: '0 -16px' }}>
      <DataTable
        caption='Boards'
        columns={[{ label: 'board' }, { label: 'paid places', align: 'right' }, { label: 'would pay', align: 'right' }, { label: 'board ceiling', align: 'right' }, { label: 'first place' }]}
        rows={boards.map((board) => ({
          key: board.key,
          cells: [board.label, fmtInt(board.rows.length), fmtInt(board.total), fmtInt(board.ceiling), board.rows[0] ? <PlayerLink key='p' id={board.rows[0].userId} name={board.rows[0].username} /> : 'nobody yet'],
          sort: [board.label, board.rows.length, board.total, board.ceiling, board.rows[0]?.username ?? null],
          muted: board.rows.length ? [] : [4],
        }))}
        paged={false}
      />
    </div>
  );
}

export function OpsClient({ offFloor }: { offFloor: { slug: string; title: string; status: string }[] }) {
  const toast = useToast();
  const [boards, setBoards] = useState<BoardsReport | null>(null);
  const [boardsBusy, setBoardsBusy] = useState(false);
  const [month, setMonth] = useState(LAST_MONTHLY);
  const [weekly, setWeekly] = useState<WeeklyReport | null>(null);
  const [weeklyBusy, setWeeklyBusy] = useState(false);
  const [week, setWeek] = useState(thisWeek());
  const [slugs, setSlugs] = useState<string[]>([]);
  const [quests, setQuests] = useState<QuestsReport | null>(null);
  const [questsBusy, setQuestsBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const boardsDryRun = async () => {
    setBoardsBusy(true);
    setError(null);
    try {
      setBoards(await runOp<BoardsReport>({ op: 'monthly-boards-dry-run', month }));
    } catch (caught) {
      setError(`Monthly boards dry run: ${(caught as Error).message}`);
    } finally {
      setBoardsBusy(false);
    }
  };

  const weeklyDryRun = async () => {
    setWeeklyBusy(true);
    setError(null);
    try {
      setWeekly(await runOp<WeeklyReport>({ op: 'weekly-boards-dry-run', week }));
    } catch (caught) {
      setError(`Weekly boards dry run: ${(caught as Error).message}`);
    } finally {
      setWeeklyBusy(false);
    }
  };

  const questsRun = async (dryRun: boolean, reason?: string) => {
    setQuestsBusy(true);
    setError(null);
    try {
      const report = await runOp<QuestsReport>({ op: 'complete-quests', slugs, dryRun, ...(dryRun ? {} : { reason, confirm: slugs.join(',') }) });
      setQuests(report);
      if (!dryRun) toast.show(`${fmtInt(report.total)} quests set complete.`);
    } finally {
      setQuestsBusy(false);
    }
  };

  return (
    <AdminPage title='Jobs' sub='Runs that change many players at once, checked before they happen. Every run is in the audit log.'>
      {error ? <Note tone='alert'>{error}</Note> : null}

      <Panel
        title='Weekly boards'
        sub='Three games a week pay 300, 200 and 100 tickets and a medal for first. The server pays each week when it closes. This shows a week’s standings as they would pay now; it writes nothing.'
        tools={
          <>
            <input className='adm-input' type='date' step={7} aria-label='Week (a Monday)' value={week} onChange={(event) => setWeek(event.target.value)} style={{ width: 150 }} />
            <button type='button' className='adm-btn' data-tone='primary' disabled={weeklyBusy || !week} onClick={() => void weeklyDryRun()}>{weeklyBusy ? 'running' : 'dry run'}</button>
          </>
        }
      >
        {weekly ? (
          <div style={{ display: 'grid', gap: 12 }}>
            {weekly.alreadyAwarded ? <Note>The week of {weekly.week} has been paid.</Note> : weekly.closed ? <Note>The week of {weekly.week} is closed and waits for the next sweep.</Note> : null}
            <Stats label='Weekly boards'>
              <Stat label={weekly.alreadyAwarded ? 'paid' : 'would pay'} value={fmtInt(weekly.total)} tickets foot={`most ${fmtInt(weekly.maxPayout)}`} />
              <Stat label='players' value={fmtInt(weekly.players)} />
              <Stat label='boards' value={fmtInt(weekly.boards.length)} foot={weekly.boards.map((board) => board.label).join(', ')} />
            </Stats>
            <BoardsTable boards={weekly.boards} />
          </div>
        ) : (
          <p style={{ margin: 0, color: 'var(--adm-ink-3)', fontSize: 12 }}>Pick a week’s Monday and run it.</p>
        )}
      </Panel>

      <Panel
        title='Monthly boards'
        sub='Retired from October 2026. What a month before that would pay on the season 0 boards, from the data now. It writes nothing.'
        tools={
          <>
            <input className='adm-input' type='month' aria-label='Month' value={month} max={LAST_MONTHLY} onChange={(event) => setMonth(event.target.value)} style={{ width: 150 }} />
            <button type='button' className='adm-btn' data-tone='primary' disabled={boardsBusy || !month} onClick={() => void boardsDryRun()}>{boardsBusy ? 'running' : 'dry run'}</button>
          </>
        }
      >
        {boards ? (
          <div style={{ display: 'grid', gap: 12 }}>
            {boards.overCeiling ? <Note tone='alert'>The total, {fmtInt(boards.total)}, is over the month’s ceiling of {fmtInt(boards.ceiling)}.</Note> : null}
            {boards.alreadyAwarded ? <Note>{boards.month} has already been awarded.</Note> : null}
            <Stats label='Monthly boards'>
              <Stat label='would pay' value={fmtInt(boards.total)} tickets foot={`ceiling ${fmtInt(boards.ceiling)}`} />
              <Stat label='players' value={fmtInt(boards.players)} />
              <Stat label='boards' value={fmtInt(boards.boards.length)} foot='season 0 rules' />
              <Stat label='most it can pay' value={fmtInt(boards.maxPayout)} />
            </Stats>
            <BoardsTable boards={boards.boards} />
          </div>
        ) : (
          <p style={{ margin: 0, color: 'var(--adm-ink-3)', fontSize: 12 }}>Pick a month and run it.</p>
        )}
      </Panel>

      <Grid cols='2'>
        <Panel title='Complete quests for a game' sub='Sets every unclaimed quest on a game that left the floor to complete, so players can claim it. Run it the day the game’s route starts to redirect. A dry run counts without writing.'>
          <div style={{ display: 'grid', gap: 10 }}>
            <label className='adm-field'>
              <span>games off the floor</span>
              <select
                className='adm-select'
                multiple
                size={8}
                value={slugs}
                onChange={(event) => setSlugs(Array.from(event.target.selectedOptions).map((option) => option.value).slice(0, 10))}
                style={{ height: 'auto', padding: 4 }}
              >
                {offFloor.map((game) => <option key={game.slug} value={game.slug}>{game.title} ({game.status})</option>)}
              </select>
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type='button' className='adm-btn' data-tone='primary' disabled={!slugs.length || questsBusy} onClick={() => void questsRun(true).catch((caught: Error) => setError(`Complete quests: ${caught.message}`))}>dry run</button>
              <button type='button' className='adm-btn' data-tone='danger' disabled={!slugs.length || questsBusy || !quests?.dryRun} title={quests?.dryRun ? undefined : 'Do a dry run first'} onClick={() => setConfirming(true)}>run for real</button>
            </div>
          </div>
        </Panel>
        <Panel title={quests ? (quests.dryRun ? 'Dry run result' : 'Run result') : 'Result'} flush>
          {quests ? (
            <DataTable
              caption='Quests completed by game'
              columns={[{ label: 'game' }, { label: 'daily', align: 'right' }, { label: 'weekly', align: 'right' }, { label: 'season', align: 'right' }, { label: 'card', align: 'right' }, { label: quests.dryRun ? 'would complete' : 'completed', align: 'right' }]}
              rows={quests.results.map((result) => ({
                key: result.gameSlug,
                cells: [
                  result.gameSlug,
                  fmtInt(result.completed.user_daily_quests ?? 0),
                  fmtInt(result.completed.user_weekly_quests ?? 0),
                  fmtInt(result.completed.user_season_quests ?? 0),
                  fmtInt(result.completed.user_weekly_cards ?? 0),
                  fmtInt(result.total),
                ],
              }))}
              paged={false}
            />
          ) : (
            <p style={{ margin: 0, padding: '0 16px 10px', color: 'var(--adm-ink-3)', fontSize: 12 }}>Pick games and do a dry run first.</p>
          )}
        </Panel>
      </Grid>

      {confirming ? (
        <ActionDialog
          title='Complete these quests for real'
          confirm='complete quests'
          tone='danger'
          fields={[
            { name: 'reason', label: 'reason', type: 'textarea', required: true },
            { name: 'confirm', label: `type ${slugs.join(',')} to confirm`, type: 'text', required: true, mustEqual: slugs.join(',') },
          ]}
          onClose={() => setConfirming(false)}
          onSubmit={async (values) => {
            await questsRun(false, values.reason);
            setConfirming(false);
          }}
        />
      ) : null}
    </AdminPage>
  );
}
