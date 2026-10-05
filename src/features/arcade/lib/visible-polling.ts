/**
 * Start a polling backstop that fully parks while the tab is hidden and
 * refreshes once on return. SSE remains the primary live path; this only
 * catches missed events without spending network/battery in background tabs.
 */
export function startVisiblePolling(
  callback: () => void | Promise<void>,
  intervalMs: number,
): () => void {
  let stopped = false;
  const run = () => {
    if (stopped || document.hidden) return;
    void callback();
  };
  const interval = window.setInterval(run, intervalMs);
  const onVisibilityChange = () => {
    if (!document.hidden) run();
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  return () => {
    stopped = true;
    window.clearInterval(interval);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}
