import { AdminConsoleFrame } from '@/features/admin/components/admin-console';
import type { ReactNode } from 'react';

import {
  ArcadePageHeader,
  cx,
} from '@/features/arcade/components/ui/arcade-ui';

import {
  GamesWalletCard,
  PageHeader,
  type PageHeaderWallet,
} from './page-header';

type FrameWidth = 'standard' | 'wide' | 'full';

const WIDTH_CLASS: Record<FrameWidth, string> = {
  standard: 'arcade-container',
  wide: 'w-full max-w-[92rem] mx-auto',
  full: 'w-full max-w-none',
};

export function AppPageFrame({
  title,
  subtitle,
  eyebrow = 'tixy',
  actions,
  rail,
  children,
  width = 'standard',
  className,
  contentClassName,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  eyebrow?: string;
  actions?: ReactNode;
  rail?: ReactNode;
  children: ReactNode;
  width?: FrameWidth;
  className?: string;
  contentClassName?: string;
}) {
  return (
    // A div, not <main> — AppShell owns the single main landmark (and the
    // skip-link target) for every shell-wrapped page.
    <div className='arcade-page'>
      <section className={cx(WIDTH_CLASS[width], 'space-y-6 sm:space-y-8', className)}>
        <ArcadePageHeader
          eyebrow={eyebrow}
          title={title}
          subtitle={subtitle}
          actions={actions}
        />
        {rail ? (
          <div className='grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(17rem,22rem)]'>
            <div className={cx('min-w-0 space-y-5 sm:space-y-6', contentClassName)}>
              {children}
            </div>
            <aside className='order-first min-w-0 space-y-3 xl:sticky xl:top-6 xl:order-none'>
              {rail}
            </aside>
          </div>
        ) : (
          <div className={contentClassName}>{children}</div>
        )}
      </section>
    </div>
  );
}

/* Admin pages render inside the console shell; this keeps the old name for
   the pages that import it and hands them to the console's frame. */
export function AdminPageFrame({
  title,
  subtitle,
  actions,
  filters,
  rail,
  children,
  className,
  contentClassName,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  filters?: ReactNode;
  rail?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <AdminConsoleFrame
      title={title}
      subtitle={subtitle}
      actions={actions}
      filters={filters}
      className={className}
      contentClassName={contentClassName}
    >
      {rail ? (
        <div className='adm-grid' data-cols='2-1'>
          <div className='min-w-0'>{children}</div>
          <aside className='min-w-0'>{rail}</aside>
        </div>
      ) : (
        children
      )}
    </AdminConsoleFrame>
  );
}

export function GamePageFrame({
  title,
  subtitle,
  eyebrow = 'tixy',
  wallet,
  actions,
  stage,
  rail,
  below,
  maxWidth = 'wide',
  className,
}: {
  title: string;
  subtitle?: ReactNode;
  eyebrow?: string;
  wallet?: PageHeaderWallet | null;
  actions?: ReactNode;
  stage: ReactNode;
  rail?: ReactNode;
  below?: ReactNode;
  maxWidth?: FrameWidth;
  className?: string;
}) {
  return (
    <section
      className={cx(
        'arc-game-page page-shell space-y-5 sm:space-y-7',
        maxWidth === 'full' && 'max-w-none',
        maxWidth === 'wide' && 'max-w-[92rem]',
        maxWidth === 'standard' && 'max-w-[72rem]',
        className,
      )}
    >
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        subtitle={subtitle}
        wallet={wallet}
        actions={actions}
      />
      {wallet ? (
        <div className='sm:hidden'>
          <GamesWalletCard wallet={wallet} compact />
        </div>
      ) : null}
      {rail ? (
        <div className='grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]'>
          <div className='min-w-0'>{stage}</div>
          <aside className='min-w-0 space-y-3 xl:sticky xl:top-6'>{rail}</aside>
        </div>
      ) : (
        stage
      )}
      {below}
    </section>
  );
}
