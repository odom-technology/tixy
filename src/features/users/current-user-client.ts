/** One client-side identity lookup shared by presence and leaderboard surfaces. */
let currentUserIdPromise: Promise<string | null> | null = null;

export function fetchCurrentUserId(): Promise<string | null> {
  if (!currentUserIdPromise) {
    currentUserIdPromise = fetch('/api/users/me', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return null;
        const data = await response.json().catch(() => null);
        return typeof data?.userId === 'string' ? data.userId : null;
      })
      .catch(() => null);
  }
  return currentUserIdPromise;
}
