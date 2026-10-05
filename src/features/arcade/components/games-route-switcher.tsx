/* Kept as a compatibility shim for existing game pages. The bottom navigation
   is now global and lives in AppShell, so routes outside gameplay get the same
   flow and game pages do not render a second fixed bar. */
export function GamesRouteSwitcher() {
  return null;
}
