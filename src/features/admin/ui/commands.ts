import { Ban, Gift, ListChecks, Palette, SlidersHorizontal, Ticket, Trophy, type LucideIcon } from 'lucide-react';

/* Actions the command palette offers beyond the pages. Each opens the screen
   where the action happens; nothing runs from the palette itself. */

export type AdminCommand = {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  hint?: string;
  keywords?: string;
};

export const ADMIN_COMMANDS: AdminCommand[] = [
  { id: 'grant-tickets', label: 'grant or remove tickets', href: '/admin/users', icon: Ticket, hint: 'users', keywords: 'adjust credits wallet' },
  { id: 'gift-item', label: 'gift an item', href: '/admin/users', icon: Gift, hint: 'users', keywords: 'grant cosmetic inventory' },
  { id: 'new-item', label: 'edit the catalog', href: '/admin/skins', icon: Palette, hint: 'skin studio', keywords: 'skin item price hide' },
  { id: 'ban', label: 'ban a player from games', href: '/admin/users', icon: Ban, hint: 'users', keywords: 'suspend cheat' },
  { id: 'boards', label: 'weekly boards dry run', href: '/admin/ops', icon: Trophy, hint: 'jobs', keywords: 'leaderboard award week month monthly' },
  { id: 'quests', label: 'complete quests for a game', href: '/admin/ops', icon: ListChecks, hint: 'jobs', keywords: 'redirect off floor retire' },
  { id: 'maintenance', label: 'maintenance and availability', href: '/admin/site-settings', icon: SlidersHorizontal, hint: 'site settings', keywords: 'banner pause games registration' },
];
