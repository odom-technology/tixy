import {
  Award,
  CircleDot,
  Crown,
  Gamepad2,
  Keyboard,
  Layers,
  ShoppingBag,
  Sparkles,
  Trophy,
  Users,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';

export type AppNavItem = {
  href: string;
  label: string;
  mobileLabel?: string;
  icon: LucideIcon;
  exact?: boolean;
};

export const PLAY_NAV_ITEMS: AppNavItem[] = [
  { href: '/', label: 'All games', mobileLabel: 'Games', icon: Gamepad2, exact: true },
  { href: '/leaderboard', label: 'Leaderboards', icon: Trophy },
  { href: '/players', label: 'Players', icon: UsersRound },
  { href: '/store', label: 'Store', icon: ShoppingBag },
];

export const MULTIPLAYER_NAV_ITEMS: AppNavItem[] = [
  { href: '/typing-test/duel', label: 'Typing Duel', mobileLabel: 'Duel', icon: Keyboard },
  { href: '/chess', label: 'Chess', icon: Crown },
  { href: '/8-ball', label: '8-Ball', mobileLabel: 'Pool', icon: CircleDot },
];

export const REWARDS_NAV_ITEMS: AppNavItem[] = [
  { href: '/leaderboard', label: 'Leaderboards', icon: Trophy },
  { href: '/battlepass', label: 'Season Pass', mobileLabel: 'Season', icon: Sparkles },
  { href: '/achievements', label: 'Achievements', mobileLabel: 'Awards', icon: Award },
  { href: '/store', label: 'Store', icon: ShoppingBag },
  { href: '/inventory', label: 'Inventory', icon: Layers },
];

/* Small-screen dock. Secondary destinations live in the Menu item. */
export const GLOBAL_MOBILE_NAV_ITEMS: AppNavItem[] = [
  PLAY_NAV_ITEMS[0],
  PLAY_NAV_ITEMS[1],
  { href: '/social', label: 'Social', icon: Users },
  PLAY_NAV_ITEMS[3],
];
