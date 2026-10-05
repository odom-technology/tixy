import {
  Activity,
  Award,
  BarChart3,
  Dices,
  Gamepad2,
  ShieldAlert,
  Store,
  TrendingUp,
  UserCheck,
  Coins,
  FileText,
  Grid3x3,
  Hexagon,
  LayoutDashboard,
  MessageSquare,
  MessagesSquare,
  Palette,
  SlidersHorizontal,
  Timer,
  Type,
  Users,
  Filter,
  History,
  PlayCircle,
  type LucideIcon,
} from 'lucide-react';

/* Every console page, in rail order. The rail, the command palette and the
   g-key shortcuts all read this list, so a page added here is reachable all
   three ways. `key` is the second key of its g shortcut. */

export type AdminNavItem = {
  href: string;
  label: string;
  title: string;
  icon: LucideIcon;
  key?: string;
  keywords?: string;
};

export type AdminNavGroup = { label: string; items: AdminNavItem[] };

export const ADMIN_NAV: AdminNavGroup[] = [
  {
    label: 'watch',
    items: [
      { href: '/admin', label: 'overview', title: 'Overview', icon: LayoutDashboard, key: 'o', keywords: 'dashboard home' },
      { href: '/admin/live', label: 'live', title: 'Live', icon: Activity, key: 'v', keywords: 'online now presence playing' },
      { href: '/admin/players', label: 'players', title: 'Players', icon: UserCheck, key: 'p', keywords: 'dau wau mau active retention cohorts new returning' },
      { href: '/admin/games', label: 'games', title: 'Games', icon: Gamepad2, key: 'g', keywords: 'plays runs starts finishes share floor' },
      { href: '/admin/economy', label: 'economy', title: 'Economy', icon: TrendingUp, key: 'e', keywords: 'tickets minted spent supply sources sinks cap balances' },
      { href: '/admin/machines', label: 'machines', title: 'Machines', icon: Dices, key: 'm', keywords: 'rtp wagers payouts wins' },
      { href: '/admin/counter', label: 'counter', title: 'Counter', icon: Store, key: 'c', keywords: 'store purchases items stripe revenue packs conversion' },
      { href: '/admin/progression', label: 'progression', title: 'Progression', icon: BarChart3, key: 'r', keywords: 'levels season tiers quests rerolls achievements' },
      { href: '/admin/trust', label: 'trust', title: 'Trust', icon: ShieldAlert, key: 't', keywords: 'anti-cheat flags rejects bans rate limits' },
      { href: '/admin/analytics', label: 'funnel', title: 'Funnel', icon: Filter, key: 'f', keywords: 'analytics activation signup sources' },
    ],
  },
  {
    label: 'operate',
    items: [
      { href: '/admin/users', label: 'users', title: 'Users', icon: Users, key: 'u', keywords: 'players accounts ban grant gift roles' },
      { href: '/admin/skins', label: 'skin studio', title: 'Skin studio', icon: Palette, key: 's', keywords: 'catalog items cosmetics store' },
      { href: '/admin/db/economy', label: 'ledger and store', title: 'Ledger and store', icon: Coins, key: 'l', keywords: 'economy tickets catalog rotation adjustments' },
      { href: '/admin/db/game-time', label: 'game time', title: 'Game time', icon: Timer, keywords: 'time cards sessions' },
      { href: '/admin/site-settings', label: 'site settings', title: 'Site settings', icon: SlidersHorizontal, keywords: 'maintenance availability banner registration' },
      { href: '/admin/ops', label: 'jobs', title: 'Jobs', icon: PlayCircle, key: 'j', keywords: 'weekly boards monthly boards dry run complete quests' },
      { href: '/admin/audit', label: 'audit log', title: 'Audit log', icon: History, key: 'a', keywords: 'history who changed writes' },
    ],
  },
  {
    label: 'content',
    items: [
      { href: '/admin/feedback', label: 'feedback', title: 'Feedback', icon: MessageSquare, keywords: 'reports bugs requests' },
      { href: '/admin/social', label: 'social', title: 'Social moderation', icon: MessagesSquare, keywords: 'chat reports moderation lobby' },
      { href: '/admin/achievements', label: 'achievements', title: 'Achievements', icon: Award, keywords: 'unlock rates catalog' },
      { href: '/admin/word-grid', label: 'word grid', title: 'Word grid', icon: Type, keywords: 'daily puzzle answers' },
      { href: '/admin/pangram', label: 'pangram', title: 'Pangram', icon: Hexagon, keywords: 'daily letters puzzle' },
      { href: '/admin/connections', label: 'connections', title: 'Connections', icon: Grid3x3, keywords: 'daily puzzle groups' },
    ],
  },
];

export const ADMIN_NAV_ITEMS: AdminNavItem[] = ADMIN_NAV.flatMap((group) => group.items);

export const ADMIN_DOCS_ITEM: AdminNavItem = {
  href: 'https://github.com/odom-technology/tixy/blob/main/docs/admin-metrics.md',
  label: 'metric definitions',
  title: 'Metric definitions',
  icon: FileText,
};

/** The nav item a pathname belongs to: the longest href that prefixes it. */
export function activeNavItem(pathname: string): AdminNavItem | null {
  let best: AdminNavItem | null = null;
  for (const item of ADMIN_NAV_ITEMS) {
    const match = item.href === '/admin' ? pathname === '/admin' : pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (match && (!best || item.href.length > best.href.length)) best = item;
  }
  return best;
}
