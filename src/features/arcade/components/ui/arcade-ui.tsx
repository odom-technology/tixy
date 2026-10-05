import Link from 'next/link';
import {
  ArrowDown,
  ArrowUp,
  Check,
  CircleAlert,
  Info,
  Star,
  Ticket,
} from 'lucide-react';
import type {
  ComponentPropsWithoutRef,
  ElementType,
  KeyboardEvent,
  ReactNode,
} from 'react';

import { Num } from './num';

export { Num } from './num';
export { formatNum } from './num-format';

/* Midway primitives — docs/design/midway/readme.md
   Legacy tone names map onto enamel paints so existing call sites keep
   working: default→key · success→prize · warning→tickets.            */

export type ArcadeTone =
  | 'default'
  | 'primary'
  | 'danger'
  | 'success'
  | 'warning'
  | 'ghost'
  | 'key'
  | 'tickets'
  | 'prize'
  | 'info';

export type ArcadeEnamel = 'primary' | 'tickets' | 'prize' | 'info' | 'danger';

type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'icon-xs' | 'icon-sm' | 'icon';

const TONE_MAP: Record<ArcadeTone, string> = {
  default: 'key',
  primary: 'primary',
  danger: 'danger',
  success: 'prize',
  warning: 'tickets',
  ghost: 'ghost',
  key: 'key',
  tickets: 'tickets',
  prize: 'prize',
  info: 'info',
};

const SIZE_MAP: Record<ButtonSize, { size: string; iconOnly: boolean }> = {
  xs: { size: 'xs', iconOnly: false },
  sm: { size: 'sm', iconOnly: false },
  md: { size: 'md', iconOnly: false },
  lg: { size: 'lg', iconOnly: false },
  'icon-xs': { size: 'xs', iconOnly: true },
  'icon-sm': { size: 'sm', iconOnly: true },
  icon: { size: 'md', iconOnly: true },
};

export function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

function keyDataProps(tone: ArcadeTone, size: ButtonSize, pressed?: boolean) {
  const s = SIZE_MAP[size];
  return {
    'data-tone': TONE_MAP[tone],
    'data-size': s.size,
    'data-icononly': s.iconOnly || undefined,
    'data-pressed': pressed || undefined,
  };
}

/* ── Layout ─────────────────────────────────────────────────────────── */

export function ArcadePage({
  children,
  className,
  narrow = false,
}: {
  children: ReactNode;
  className?: string;
  narrow?: boolean;
}) {
  return (
    <main className={cx('arcade-page', className)}>
      <section className={narrow ? 'arcade-container-narrow' : 'arcade-container'}>
        {children}
      </section>
    </main>
  );
}

export function ArcadeCard({
  children,
  className,
  inset = false,
}: {
  children: ReactNode;
  className?: string;
  inset?: boolean;
}) {
  return (
    <section className={cx(inset ? 'arcade-card-inset' : 'arcade-card', className)}>
      {children}
    </section>
  );
}

/* The painted panel — the basic Midway surface. 'well' is the inset
   variant for stages, inputs, and readouts. */
export function ArcadePanel({
  children,
  variant = 'panel',
  className,
  ...props
}: ComponentPropsWithoutRef<'section'> & {
  variant?: 'panel' | 'cabinet' | 'raised' | 'well';
}) {
  return (
    <section
      {...props}
      data-variant={variant}
      className={cx('arc-panel', className)}
    >
      {children}
    </section>
  );
}

/* The backlit signage band that names a cabinet — Bungee on solid enamel.
   Sits flush at the top of a padding-0 panel, card, or modal. */
export function ArcadeMarquee({
  children,
  tone = 'primary',
  size = 'sm',
  trailing,
  className,
  ...props
}: ComponentPropsWithoutRef<'header'> & {
  tone?: ArcadeEnamel | 'cream';
  size?: 'sm' | 'md' | 'lg';
  trailing?: ReactNode;
}) {
  return (
    <header
      {...props}
      data-tone={tone}
      data-size={size}
      className={cx('arc-marquee', className)}
    >
      <span className='min-w-0 truncate uppercase'>{children}</span>
      {trailing ? (
        <span className='inline-flex shrink-0 items-center gap-2 whitespace-nowrap'>
          {trailing}
        </span>
      ) : null}
    </header>
  );
}

export function ArcadePageHeader({
  eyebrow = 'tixy',
  title,
  subtitle,
  actions,
  className,
}: {
  eyebrow?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cx(
        'flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between',
        className,
      )}
    >
      <div className='min-w-0'>
        {/* Below lg the kicker carries a tappable "tixy" home link (the top
            bar wordmark covers it from lg up); the page-context eyebrow is a
            plain label, not a link — it used to point home, which read as a
            broken breadcrumb. */}
        <p className='arcade-kicker'>
          <Link href='/' className='transition-colors hover:text-strong lg:hidden'>
            tixy
          </Link>
          {eyebrow !== 'tixy' ? (
            <>
              <span aria-hidden className='lg:hidden'>
                {' · '}
              </span>
              <span>{eyebrow}</span>
            </>
          ) : null}
        </p>
        <h1 className='arcade-display mt-3 text-2xl text-strong uppercase sm:text-3xl'>
          {title}
        </h1>
        {subtitle ? (
          <p className='mt-3 max-w-3xl text-sm text-body'>{subtitle}</p>
        ) : null}
      </div>
      {actions ? <div className='flex flex-wrap gap-2'>{actions}</div> : null}
    </header>
  );
}

/* ── Keys (buttons with real travel) ────────────────────────────────── */

export function ArcadeButton({
  children,
  className,
  size = 'md',
  tone = 'default',
  pressed,
  ...props
}: ComponentPropsWithoutRef<'button'> & {
  size?: ButtonSize;
  tone?: ArcadeTone;
  pressed?: boolean;
}) {
  return (
    <button
      type='button'
      {...props}
      {...keyDataProps(tone, size, pressed)}
      className={cx('arc-key', className)}
    >
      {children}
    </button>
  );
}

export function ArcadeLinkButton({
  children,
  className,
  size = 'md',
  tone = 'default',
  pressed,
  ...props
}: ComponentPropsWithoutRef<typeof Link> & {
  size?: ButtonSize;
  tone?: ArcadeTone;
  pressed?: boolean;
}) {
  return (
    <Link
      {...props}
      {...keyDataProps(tone, size, pressed)}
      className={cx('arc-key', className)}
    >
      {children}
    </Link>
  );
}

export function ArcadeAnchorButton({
  children,
  className,
  size = 'md',
  tone = 'default',
  pressed,
  ...props
}: ComponentPropsWithoutRef<'a'> & {
  size?: ButtonSize;
  tone?: ArcadeTone;
  pressed?: boolean;
}) {
  return (
    <a
      {...props}
      {...keyDataProps(tone, size, pressed)}
      className={cx('arc-key', className)}
    >
      {children}
    </a>
  );
}

/* ── Forms ──────────────────────────────────────────────────────────── */

export function ArcadeField({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx('block min-w-0', className)}>
      <span className='arcade-kicker arc-field-label mb-2 block'>{label}</span>
      {children}
      {error ? (
        <span role='alert' className='mt-1.5 block text-xs text-danger-text'>
          {error}
        </span>
      ) : hint ? (
        <span className='mt-1.5 block text-xs text-faint'>{hint}</span>
      ) : null}
    </label>
  );
}

/* Text input as an inset well — the player types "into" the panel. */
export function ArcadeInput({
  icon,
  inputSize = 'md',
  mono = false,
  invalid = false,
  className,
  wrapClassName,
  ...props
}: ComponentPropsWithoutRef<'input'> & {
  icon?: ReactNode;
  inputSize?: 'md' | 'lg';
  mono?: boolean;
  invalid?: boolean;
  wrapClassName?: string;
}) {
  return (
    <span className={cx('arc-input-wrap', wrapClassName)}>
      {icon ? <span className='arc-input-icon'>{icon}</span> : null}
      <input
        {...props}
        data-size={inputSize}
        data-mono={mono || undefined}
        data-invalid={invalid || undefined}
        aria-invalid={invalid || undefined}
        data-hasicon={icon ? 'true' : undefined}
        className={cx('arc-input', className)}
      />
    </span>
  );
}

/* ── Display ────────────────────────────────────────────────────────── */

/* Small pill for statuses, counts, and section tags. Neutral by default;
   enamel tones for semantic states. */
export function ArcadeChip({
  children,
  tone,
  className,
  ...props
}: ComponentPropsWithoutRef<'span'> & {
  tone?: ArcadeEnamel;
}) {
  return (
    <span {...props} data-tone={tone} className={cx('arc-chip', className)}>
      {children}
    </span>
  );
}

/* Segmented control: one inset well with an active "key" — the single-surface
   replacement for stacks of tab cabinets / accordions (leaderboard modes,
   store/inventory filters, game modes). onChange makes it a client tab strip;
   the caller owns selection state. */
export type ArcadeSegmentItem<T extends string = string> = {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
};

export function ArcadeSegmented<T extends string = string>({
  items,
  value,
  onChange,
  tone = 'primary',
  ariaLabel,
  className,
}: {
  items: ReadonlyArray<ArcadeSegmentItem<T>>;
  value: T;
  onChange?: (value: T) => void;
  tone?: ArcadeEnamel;
  ariaLabel?: string;
  className?: string;
}) {
  // Tabs-pattern keyboard support: ←/→/Home/End move selection and focus
  // together. Items stay in the tab order (this doubles as a filter strip,
  // not a strict tablist), so this only adds keys, never removes them.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!onChange) return;
    const currentIndex = items.findIndex((item) => item.value === value);
    if (currentIndex < 0) return;
    let nextIndex: number;
    switch (event.key) {
      case 'ArrowLeft':
        nextIndex = (currentIndex - 1 + items.length) % items.length;
        break;
      case 'ArrowRight':
        nextIndex = (currentIndex + 1) % items.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = items.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const next = items[nextIndex];
    if (!next || next.value === value) return;
    onChange(next.value);
    const tabs = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs[nextIndex]?.focus();
  };

  return (
    <div
      role='tablist'
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={cx('arc-seg', className)}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type='button'
            role='tab'
            aria-selected={active}
            data-active={active || undefined}
            data-tone={tone}
            onClick={onChange ? () => onChange(item.value) : undefined}
            className='arc-seg-item'
          >
            {item.icon}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

/* Red enamel name-plate for page headers — "★ Ranked Cabinet ★",
   "{game} Elo". Presentational + server-safe. Star is a filled lucide
   Star in amber (token-driven). Pass star to flank both sides. */
export function ArcadeCabinetBadge({
  children,
  icon,
  star = false,
  tone,
  className,
  ...props
}: ComponentPropsWithoutRef<'span'> & {
  icon?: ReactNode;
  star?: boolean;
  /** default (no tone) = red primary plate; enamel tones supported */
  tone?: ArcadeEnamel;
}) {
  return (
    <span
      {...props}
      data-tone={tone}
      className={cx('arc-cabinet-badge', className)}
    >
      {star ? (
        <span className='arc-cabinet-star'>
          <Star aria-hidden size={12} fill='currentColor' strokeWidth={0} />
        </span>
      ) : (
        icon ?? null
      )}
      {children}
      {star ? (
        <span className='arc-cabinet-star'>
          <Star aria-hidden size={12} fill='currentColor' strokeWidth={0} />
        </span>
      ) : null}
    </span>
  );
}

/* Stat tile: kicker label + big tabular number in an inset well. */
export function ArcadeStat({
  label,
  value,
  detail,
  sub,
  tone,
  icon: Icon,
  className,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  sub?: ReactNode;
  tone?: ArcadeEnamel;
  icon?: ElementType;
  className?: string;
}) {
  const subline = sub ?? detail;
  return (
    <div data-tone={tone} className={cx('arc-stat', className)}>
      <span className='arcade-kicker flex items-center justify-between gap-2'>
        {label}
        {Icon ? <Icon aria-hidden className='h-3.5 w-3.5 shrink-0' /> : null}
      </span>
      <span className='arc-stat-value'>{value}</span>
      {subline ? <span className='arc-stat-sub'>{subline}</span> : null}
    </div>
  );
}

/* The stub: the one ticket shape. A rounded ticket with a half-circle notch
   on each short end, from the mark's outline. Only tickets get it: balances,
   prices, bet values, the result strip. A card, a button or a tab never
   does (PLAN.md, "Shape"). `perf` adds the perforation near the right end.
   The notches are tixy only; under the Midway themes it is a plain amber
   tag. */
export function ArcadeStub({
  children,
  perf = false,
  size = 'md',
  muted = false,
  className,
  ...props
}: ComponentPropsWithoutRef<'span'> & {
  perf?: boolean;
  size?: 'sm' | 'md' | 'lg';
  /** A void or spent ticket: paper 3 instead of ticket amber. */
  muted?: boolean;
}) {
  return (
    <span
      {...props}
      data-perf={perf || undefined}
      data-size={size}
      data-muted={muted || undefined}
      className={cx('arc-ticket-stub', className)}
    >
      {children}
    </span>
  );
}

/* The wallet, drawn as a ticket stub: the count, a perforation, the label.
   Under tixy it is the stub shape above. Delta pops in on balance change. */
export function ArcadeTicketStub({
  value,
  label = 'tickets',
  delta,
  size = 'md',
  className,
  ...props
}: ComponentPropsWithoutRef<'span'> & {
  value: number | string;
  label?: string;
  delta?: number | null;
  size?: 'sm' | 'md';
}) {
  return (
    <span {...props} data-size={size} className={cx('arc-stub', className)}>
      <span className='arc-stub-no'>
        <Num value={value} labelSuffix={typeof value === 'number' ? label : undefined} />
        {delta != null && delta !== 0 ? (
          <Num key={delta} className='arc-stub-delta' data-up={delta > 0 ? 'true' : 'false'} value={delta} signed />
        ) : null}
      </span>
      <span className='arc-stub-label uppercase' aria-hidden={typeof value === 'number' || undefined}>
        {label}
      </span>
    </span>
  );
}

/* Daily-cap / quest meter: an inset track filled with enamel paint. */
export function ArcadeProgress({
  label,
  current,
  max,
  tone = 'tickets',
  className,
  ...props
}: ComponentPropsWithoutRef<'div'> & {
  label?: ReactNode;
  current: number;
  max: number;
  tone?: ArcadeEnamel;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (current / max) * 100)) : 0;
  return (
    <div {...props} data-tone={tone} className={cx('arc-progress', className)}>
      {label != null ? (
        <div className='arc-progress-head'>
          <span className='arcade-kicker'>{label}</span>
          <Num className='arc-progress-count' value={`${current}/${max}`} />
        </div>
      ) : null}
      <div
        className='arc-progress-track'
        role='progressbar'
        aria-valuenow={current}
        aria-valuemin={0}
        aria-valuemax={max}
      >
        <div className='arc-progress-fill' style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/* ── Feedback ───────────────────────────────────────────────────────── */

/* Inline notice: an inset strip with a small enamel badge. Calm by
   default — enamel only marks the semantic moment. */
export function ArcadeNotice({
  children,
  tone = 'default',
  icon,
  className,
  shake = false,
}: {
  children: ReactNode;
  tone?: ArcadeTone;
  icon?: ReactNode;
  className?: string;
  /** Brief error shake (e.g. validation / failed action). */
  shake?: boolean;
}) {
  const mapped = TONE_MAP[tone];
  const noticeTone = mapped === 'key' || mapped === 'ghost' ? 'neutral' : mapped;
  return (
    <p
      data-tone={noticeTone}
      className={cx('arc-notice arc-enter-up', shake && 'arc-shake', className)}
    >
      <span className='arc-notice-dot'>{icon ?? <NoticeGlyph tone={noticeTone} />}</span>
      <span className='min-w-0'>{children}</span>
    </p>
  );
}

function NoticeGlyph({ tone }: { tone: string }) {
  /* lucide only — never emoji or unicode-as-icon */
  const Icon =
    tone === 'prize'
      ? Check
      : tone === 'danger'
        ? CircleAlert
        : tone === 'tickets'
          ? Ticket
          : Info;
  return <Icon aria-hidden size={12} strokeWidth={2.5} />;
}

/* Which optional cells the board renders. Rank + Player + Score are always
   present; tier / record / delta are opt-in so the table works in BOTH Elo
   mode (Rank | Player | Elo | Tier | W-L | Δ) and score / speed mode (just
   Rank | Player | Score [+ Δ]). */
export type ArcadeLeaderboardColumns = {
  tier?: boolean;
  record?: boolean;
  delta?: boolean;
};

/* Build the shared grid-column template so the header and every row line up.
   Order: Rank | Player | Score | Tier? | Record? | Δ? */
function leaderboardTemplate(cols: ArcadeLeaderboardColumns): string {
  return [
    '44px', // rank
    'minmax(0, 1fr)', // player
    'minmax(64px, max-content)', // score
    cols.tier ? 'minmax(72px, max-content)' : null, // tier
    cols.record ? 'minmax(56px, max-content)' : null, // record
    cols.delta ? '64px' : null, // delta
  ]
    .filter(Boolean)
    .join(' ');
}

const TIER_KEY: Record<string, string> = {
  grandmaster: 'grandmaster',
  master: 'master',
  diamond: 'diamond',
  platinum: 'platinum',
  gold: 'gold',
};

/* Header row for the columnar leaderboard. Pass the SAME `columns` you
   pass the rows so the grid aligns. Render it as the first child of the
   padding-0 panel that wraps the rows. */
export function ArcadeLeaderboardHeader({
  columns = {},
  scoreLabel = 'Score',
  playerLabel = 'Player',
  className,
  ...props
}: ComponentPropsWithoutRef<'div'> & {
  columns?: ArcadeLeaderboardColumns;
  scoreLabel?: ReactNode;
  playerLabel?: ReactNode;
}) {
  return (
    <div
      {...props}
      className={cx('arc-lbrow arc-lbrow-head', className)}
      style={{ ['--lb-cols' as string]: leaderboardTemplate(columns), ...props.style }}
    >
      <span>Rank</span>
      <span>{playerLabel}</span>
      <span className='arc-lbcol-num'>{scoreLabel}</span>
      {columns.tier ? <span>Tier</span> : null}
      {columns.record ? <span>W-L</span> : null}
      {columns.delta ? <span className='arc-lbcol-num'>Δ</span> : null}
    </div>
  );
}

/* Footer summary band — pass plain strings/nodes as items. */
export function ArcadeLeaderboardFoot({
  items,
  className,
  ...props
}: ComponentPropsWithoutRef<'div'> & {
  items: ReactNode[];
}) {
  return (
    <div {...props} className={cx('arc-lbfoot', className)}>
      {items.map((item, i) => (
        <span key={i} className='arc-lbfoot-item'>
          {item}
        </span>
      ))}
    </div>
  );
}

/* Leaderboard row: square gold/silver/bronze rank badges for the top
   three, mono scores, optional tier badge + W-L record + rank-change
   arrow. A CSS grid (column template via --lb-cols) so it reads as a real
   table. Stack rows inside a padding-0 ArcadePanel, ideally under an
   ArcadeLeaderboardHeader with matching `columns`.

   Backward compatible: if you pass only rank/name/score(/scoreSub/delta)
   it renders the original 4-column layout. Pass `tier`/`record` (and set
   the header `columns`) for the full Elo table. */
export function ArcadeLeaderboardRow({
  rank,
  name,
  sub,
  score,
  scoreSub,
  tier,
  record,
  delta,
  columns,
  you = false,
  avatar,
  className,
  ...props
}: ComponentPropsWithoutRef<'div'> & {
  rank: number;
  name: ReactNode;
  sub?: ReactNode;
  score: ReactNode;
  scoreSub?: ReactNode;
  /** Optional tier name (renders an enamel tier badge). */
  tier?: ReactNode;
  /** Optional W-L record cell. */
  record?: ReactNode;
  delta?: number | null;
  /**
   * Column layout for this row. Defaults to: tier/record/delta present iff
   * the matching prop is supplied — so a row sizes itself. Pass an explicit
   * `columns` (matching the header) to keep all rows aligned even when some
   * rows lack a value.
   */
  columns?: ArcadeLeaderboardColumns;
  you?: boolean;
  avatar?: ReactNode;
}) {
  const hasDelta = delta != null && delta !== 0;
  const cols: ArcadeLeaderboardColumns = columns ?? {
    tier: tier != null,
    record: record != null,
    delta: hasDelta,
  };
  const tierKey =
    typeof tier === 'string' ? TIER_KEY[tier.toLowerCase()] ?? 'gold' : 'gold';

  return (
    <div
      {...props}
      data-rank={rank}
      data-podium={rank <= 3 || undefined}
      data-you={you || undefined}
      className={cx('arc-lbrow', className)}
      style={{ ['--lb-cols' as string]: leaderboardTemplate(cols), ...props.style }}
    >
      <span className='arc-lbrow-rank'>{rank}</span>
      <span className='arc-lbrow-player'>
        <span className='arc-lbrow-avatar'>
          {avatar ?? String(name ?? '').slice(0, 2).toUpperCase()}
        </span>
        <span className='arc-lbrow-name'>
          <b>{name}</b>
          {sub ? <span>{sub}</span> : null}
        </span>
        {you ? <span className='arc-lbrow-youtag'>you</span> : null}
      </span>
      <span className='arc-lbrow-score'>
        <b>{score}</b>
        {scoreSub ? <span>{scoreSub}</span> : null}
      </span>
      {cols.tier ? (
        <span className='arc-lbrow-tier'>
          {tier != null ? (
            <span className='arc-lbtier' data-tier={tierKey}>
              {tier}
            </span>
          ) : null}
        </span>
      ) : null}
      {cols.record ? (
        <span className='arc-lbrow-record'>{record}</span>
      ) : null}
      {cols.delta ? (
        <span
          className='arc-lbrow-delta'
          data-dir={hasDelta && delta! > 0 ? 'up' : 'down'}
        >
          {hasDelta ? (
            <>
              {delta! > 0 ? (
                <ArrowUp aria-hidden size={11} strokeWidth={2.5} />
              ) : (
                <ArrowDown aria-hidden size={11} strokeWidth={2.5} />
              )}
              {Math.abs(delta!)}
            </>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
