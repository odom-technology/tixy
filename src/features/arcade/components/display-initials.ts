/* Two-letter avatar initials for account chips (top bar, account nav). */
export function getDisplayInitials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || 'A'
  );
}
