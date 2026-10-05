/** Refresh product wording in saved, administrator-authored site notices. */
export function rebrandSiteText(value: string): string {
  return value.replace(/\b(?:[Tt]he\s+)?Arcade\b/g, 'tixy');
}
