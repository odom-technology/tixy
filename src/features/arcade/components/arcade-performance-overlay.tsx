'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import {
  beginArcadeNavigation,
  createArcadeFrameMonitor,
  getArcadePerformanceServerSnapshot,
  getArcadePerformanceSnapshot,
  recordArcadePerformanceMetric,
  setArcadePerformanceEnabled,
  subscribeArcadePerformance,
  type ArcadePerformanceSpan,
} from '@/features/arcade/lib/arcade-performance';

function milliseconds(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}ms`;
}

function ArcadePerformanceOverlay() {
  const snapshot = useSyncExternalStore(
    subscribeArcadePerformance,
    getArcadePerformanceSnapshot,
    getArcadePerformanceServerSnapshot,
  );
  const latest = snapshot.metrics.slice(-3).reverse();

  return (
    <aside
      aria-label='tixy performance diagnostics'
      className='pointer-events-none fixed top-2 left-2 z-[200] w-60 rounded-md border border-white/25 bg-black/90 p-2 font-mono text-[10px] leading-4 text-white shadow-lg'
    >
      <div className='mb-1 flex items-center justify-between text-[11px] font-bold uppercase tracking-wide'>
        <span>tixy perf</span>
        <span className='text-emerald-300'>live</span>
      </div>
      <div className='grid grid-cols-2 gap-x-2'>
        <span className='text-white/60'>Average</span>
        <span>{snapshot.frames.averageFps?.toFixed(0) ?? '—'} fps</span>
        <span className='text-white/60'>Frame p95</span>
        <span>{milliseconds(snapshot.frames.p95FrameMs)}</span>
        <span className='text-white/60'>&gt;33ms</span>
        <span>{snapshot.frames.longFramePercent?.toFixed(1) ?? '—'}%</span>
        <span className='text-white/60'>Worst</span>
        <span>{milliseconds(snapshot.frames.worstFrameMs)}</span>
        {snapshot.quality ? (
          <>
            <span className='text-white/60'>3D tier</span>
            <span data-arcade-tier={snapshot.quality.tier}>
              {snapshot.quality.tier}
              {snapshot.quality.tier !== snapshot.quality.startTier
                ? ` (from ${snapshot.quality.startTier})`
                : ''}
            </span>
            <span className='text-white/60'>3D p50 / p90</span>
            <span>
              {milliseconds(snapshot.quality.p50FrameMs)} /{' '}
              {milliseconds(snapshot.quality.p90FrameMs)}
            </span>
          </>
        ) : null}
      </div>
      {latest.length > 0 ? (
        <div className='mt-1 border-t border-white/15 pt-1'>
          {latest.map((metric) => (
            <div key={metric.id} className='flex gap-1'>
              <span className='min-w-0 flex-1 truncate text-white/60'>
                {metric.kind} · {metric.label}
              </span>
              <span>{milliseconds(metric.durationMs)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </aside>
  );
}

/**
 * Shell-level opt-in controller. Add `?arcadePerf=1` to enable collection and
 * the overlay for the lifetime of the client session/navigation tree.
 */
export function ArcadePerformanceController({ pathname }: { pathname: string }) {
  const [visible, setVisible] = useState(false);
  const activeRef = useRef(false);
  const pendingNavigationRef = useRef<ArcadePerformanceSpan | null>(null);
  const previousPathnameRef = useRef(pathname);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('arcadePerf');
    if (requested !== '1' && requested !== 'true') return;

    activeRef.current = true;
    setArcadePerformanceEnabled(true);
    setVisible(true);

    // Hydration-to-shell-ready is a useful initial-navigation baseline. It is
    // deliberately recorded here rather than installing a global observer.
    recordArcadePerformanceMetric(
      'navigation',
      window.location.pathname,
      performance.now(),
      { source: 'initial-shell-ready' },
      0,
    );

    const frameMonitor = createArcadeFrameMonitor('shell-display');
    let animationFrame = 0;
    const onFrame = (timestamp: number) => {
      frameMonitor.frame(timestamp);
      animationFrame = window.requestAnimationFrame(onFrame);
    };
    animationFrame = window.requestAnimationFrame(onFrame);

    const beginNavigation = (destination: string, source: string) => {
      pendingNavigationRef.current?.cancel();
      pendingNavigationRef.current = beginArcadeNavigation(destination, { source });
    };

    const onClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest('a[href]');
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === '_blank' || anchor.download) {
        return;
      }
      const destination = new URL(anchor.href, window.location.href);
      if (destination.origin !== window.location.origin) return;
      // The shell observes pathname changes. Ignore query/hash-only links so
      // they cannot leave a navigation span waiting for a route signal.
      if (destination.pathname === window.location.pathname) return;
      beginNavigation(destination.pathname, 'link');
    };

    const onPopState = () => beginNavigation(window.location.pathname, 'history');
    const onVisibilityChange = () => frameMonitor.reset();
    document.addEventListener('click', onClick, true);
    window.addEventListener('popstate', onPopState);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      activeRef.current = false;
      pendingNavigationRef.current?.cancel();
      pendingNavigationRef.current = null;
      window.cancelAnimationFrame(animationFrame);
      frameMonitor.dispose();
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('popstate', onPopState);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      setArcadePerformanceEnabled(false);
    };
  }, []);

  useEffect(() => {
    if (!activeRef.current || previousPathnameRef.current === pathname) return;
    previousPathnameRef.current = pathname;
    if (pendingNavigationRef.current) {
      pendingNavigationRef.current.end({ renderedPath: pathname });
      pendingNavigationRef.current = null;
    } else {
      recordArcadePerformanceMetric('navigation', pathname, 0, {
        source: 'programmatic-route-ready',
      });
    }
  }, [pathname]);

  return visible ? <ArcadePerformanceOverlay /> : null;
}
