import type { Metadata } from 'next';
import { ArrowUpRight, Check, Code2, GitFork, GitPullRequest, Terminal } from 'lucide-react';

import { AppPageFrame } from '@/features/arcade/components/shell/page-frame';
import {
  ArcadeAnchorButton,
  ArcadePanel,
} from '@/features/arcade/components/ui/arcade-ui';

const REPOSITORY = 'https://github.com/odom-technology/tixy';
const SOURCE = `${REPOSITORY}/tree/dev`;
const DOCS = `${REPOSITORY}/blob/dev`;
const TUTORIAL = `${DOCS}/docs/first-game.md`;
const PROPOSAL = `${REPOSITORY}/issues/new?template=game-proposal.yml`;

export const metadata: Metadata = {
  title: 'Build for Tixy | tixy',
  description:
    'Build a browser game for Tixy. Start with working examples, develop locally, and submit your game for maintainer review.',
  alternates: { canonical: '/developers' },
};

const examples = [
  {
    number: '01',
    title: 'Pattern Match',
    label: 'Start here',
    slug: 'starter-match',
    description:
      'Eight rounds. Four shapes. One matching choice. Follow a complete run from controls to a saved personal best.',
    detail: 'Signed sessions · deterministic replay · game leaderboard',
    command: 'npm run test:starter-game',
    tone: 'text-primary-text',
  },
  {
    number: '02',
    title: 'Lights Out',
    label: 'See an adaptation',
    slug: 'lights-out',
    description:
      'A solvable 3 × 3 toggle puzzle. See how the starter becomes a different game with a bounded move log and a solved-state check.',
    detail: 'Puzzle rules · move validation · retry-safe results',
    command: 'npm run test:lights-out',
    tone: 'text-prize-text',
  },
];

export default function DevelopersPage() {
  return (
    <AppPageFrame
      eyebrow='For developers'
      title='Build for Tixy'
      subtitle='Your next small browser game could have a place in the arcade. Bring the idea; start with a working example.'
      contentClassName='space-y-6 sm:space-y-8'
      actions={
        <ArcadeAnchorButton href={SOURCE} tone='ghost' size='sm'>
          <Code2 size={16} aria-hidden />
          Public source
          <ArrowUpRight size={14} aria-hidden />
        </ArcadeAnchorButton>
      }
    >
      <ArcadePanel variant='raised' className='overflow-hidden'>
        <div className='grid gap-6 p-5 sm:p-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:gap-10'>
          <div className='min-w-0 space-y-5'>
            <p className='arcade-kicker text-primary-text'>Make something worth one more play</p>
            <h2 className='arcade-display max-w-xl text-3xl leading-tight text-strong uppercase sm:text-4xl'>
              Small game.<br />Real arcade.
            </h2>
            <p className='max-w-xl text-sm leading-7 text-body'>
              Build a short single-player game with your own rules and controls.
              Tixy provides shared UI, accounts, themes, and helpers for sessions
              and results. Your game supplies the fun and a score the server can verify.
            </p>
            <div className='flex flex-wrap gap-3'>
              <ArcadeAnchorButton href={TUTORIAL} tone='primary'>
                Build your first game
                <ArrowUpRight size={16} aria-hidden />
              </ArcadeAnchorButton>
              <ArcadeAnchorButton href={PROPOSAL} tone='ghost'>
                Propose a game
              </ArcadeAnchorButton>
            </div>
          </div>
          <div className='min-w-0 rounded-xl border border-soft bg-well p-5'>
            <p className='arcade-kicker mb-4'>From idea to arcade</p>
            <ol className='space-y-5'>
              {[
                { Icon: GitFork, title: 'Fork & build', text: 'Branch from dev and work on your local machine.' },
                { Icon: Check, title: 'Play & verify', text: 'Test the rules, saved results, keyboard, and touch controls.' },
                { Icon: GitPullRequest, title: 'Submit for review', text: 'Open a PR to dev. Maintainers review and release approved games.' },
              ].map(({ Icon, title, text }) => (
                <li key={title} className='flex items-start gap-3'>
                  <Icon size={20} className='mt-0.5 shrink-0 text-primary-text' aria-hidden />
                  <div>
                    <p className='font-semibold text-strong'>{title}</p>
                    <p className='mt-1 text-sm leading-6 text-body'>{text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
        <p className='border-t border-soft px-5 py-4 text-sm leading-6 text-body sm:px-8'>
          Start score-only. Tickets, XP, achievements, and other rewards need a
          separate design and maintainer approval. Contributors do not need
          production credentials or access to private ops.
        </p>
      </ArcadePanel>

      <section aria-labelledby='examples-heading' className='space-y-4'>
        <div className='space-y-2'>
          <p className='arcade-kicker'>Learn by playing with the code</p>
          <h2 id='examples-heading' className='arcade-display text-xl text-strong uppercase sm:text-2xl'>
            Two examples. Your own direction.
          </h2>
          <p className='text-sm leading-6 text-body'>
            Both examples are score-only. Run them locally from the dev branch;
            their source includes engine, database, and browser checks.
          </p>
        </div>
        <div className='grid gap-4 md:grid-cols-2'>
          {examples.map((example) => (
            <ArcadePanel key={example.slug} className='flex min-w-0 flex-col gap-4 p-5 sm:p-6'>
              <div className='flex items-start justify-between gap-4'>
                <div>
                  <p className={`arcade-kicker ${example.tone}`}>{example.label}</p>
                  <h3 className='arcade-display mt-2 text-xl text-strong uppercase'>{example.title}</h3>
                </div>
                <span className={`arcade-display text-3xl ${example.tone}`} aria-hidden>{example.number}</span>
              </div>
              <p className='text-sm leading-7 text-body'>{example.description}</p>
              <p className='text-xs leading-6 text-muted'>{example.detail}</p>
              <code className='break-words rounded-lg border border-soft bg-well px-3 py-2 text-xs leading-6 text-strong'>
                {example.command}
              </code>
              <div className='mt-auto'>
                <ArcadeAnchorButton href={`${SOURCE}/src/app/%28games%29/${example.slug}`} size='sm' tone='ghost'>
                  View {example.title} source
                  <ArrowUpRight size={14} aria-hidden />
                </ArcadeAnchorButton>
              </div>
            </ArcadePanel>
          ))}
        </div>
      </section>

      <ArcadePanel variant='raised' className='grid gap-6 p-5 sm:p-8 lg:grid-cols-2 lg:gap-10' aria-labelledby='local-heading'>
        <div className='min-w-0 space-y-4'>
          <p className='arcade-kicker flex items-center gap-2'><Terminal size={16} aria-hidden />Your local workshop</p>
          <h2 id='local-heading' className='arcade-display text-xl text-strong uppercase sm:text-2xl'>
            Get a game running
          </h2>
          <p className='text-sm leading-7 text-body'>
            Use Node.js 24 and Docker Compose, or your own PostgreSQL 18
            instance. Fork the public repo, clone your fork, and branch from dev.
          </p>
          <pre className='whitespace-pre-wrap break-words rounded-xl border border-soft bg-well p-4 text-xs leading-7 text-strong'>
            <code>{`git clone https://github.com/YOUR-USERNAME/tixy.git
cd tixy
git switch dev
git switch -c game/your-game
npm ci
cp env/.env.example env/.env.local
npm run db:up`}</code>
          </pre>
        </div>
        <div className='min-w-0 space-y-4 text-sm leading-7 text-body'>
          <ol className='list-decimal space-y-3 pl-5'>
            <li>
              Generate separate local values for <code className='break-words text-strong'>GAME_SESSION_SECRET</code> and{' '}
              <code className='break-words text-strong'>CRON_SECRET</code>. Set{' '}
              <code className='break-words text-strong'>ARCADE_ADMIN_EMAILS</code> to your local test account email.
              The tutorial includes the commands and PowerShell alternatives.
            </li>
            <li>
              Run <code className='text-strong'>npm run db:migrate</code>, then{' '}
              <code className='text-strong'>npm run dev</code>. Register a synthetic account
              at <code className='text-strong'>localhost:3000</code> and play{' '}
              <code className='text-strong'>/starter-match</code> or{' '}
              <code className='text-strong'>/lights-out</code>.
            </li>
            <li>
              Copy the starter, adapt its rules and checks, and verify a fresh
              clone before submitting. Use disposable local databases and keep
              environment files out of your contribution.
            </li>
          </ol>
          <p>
            Run development checks locally. GitHub Actions runs only on main;
            submitting a PR to dev does not run CI.
          </p>
          <a href={TUTORIAL} className='arcade-link inline-flex items-center gap-2'>
            Follow the complete setup and test commands
            <ArrowUpRight size={16} aria-hidden />
          </a>
        </div>
      </ArcadePanel>

      <ArcadePanel className='space-y-5 p-5 sm:p-8' aria-labelledby='review-heading'>
        <div className='space-y-2'>
          <p className='arcade-kicker'>Ready for another player</p>
          <h2 id='review-heading' className='arcade-display text-xl text-strong uppercase sm:text-2xl'>
            Make your contribution reviewable
          </h2>
        </div>
        <ul className='grid gap-4 text-sm leading-7 text-body md:grid-cols-3'>
          <li><strong className='block text-strong'>Clear rules</strong>Describe controls, scoring, and completion. Submit bounded inputs; derive results with server replay.</li>
          <li><strong className='block text-strong'>A complete experience</strong>Include keyboard and touch controls, loading and retry states, and local engine, database, and browser results.</li>
          <li><strong className='block text-strong'>Assets with a source</strong>Document artwork, audio, fonts, and dependencies, with their licenses and required notices.</li>
        </ul>
        <div className='flex flex-wrap gap-3'>
          <ArcadeAnchorButton href={`${DOCS}/docs/game-review-checklist.md`} tone='primary' size='sm'>Review checklist</ArcadeAnchorButton>
          <ArcadeAnchorButton href={`${DOCS}/docs/contributing-games.md`} tone='ghost' size='sm'>Game contribution guide</ArcadeAnchorButton>
          <ArcadeAnchorButton href={`${DOCS}/CONTRIBUTING.md`} tone='ghost' size='sm'>Contributing to Tixy</ArcadeAnchorButton>
        </div>
        <p className='border-t border-soft pt-4 text-sm leading-7 text-body'>
          Application code is AGPL-3.0-only unless a file states otherwise.
          Tixy branding is reserved, and bundled assets have separate terms.{' '}
          <a href={`${DOCS}/LICENSING.md`} className='arcade-link'>Read licensing and asset terms</a>
          {' '}before reusing or adding assets.
        </p>
      </ArcadePanel>
    </AppPageFrame>
  );
}
