import 'server-only';

/* Who gets a player card. The card and the embed follow the profile page's
   own rule (canViewProfile) and never show more than it does: a public
   profile's card is public and cacheable; a players-only or private
   profile's card is drawn only for the people who can open that page, and
   never cached. The embed is for other sites, so it needs a public profile. */

import { ACCOUNT_SESSION_COOKIE, getIdentityForSessionToken } from '@/server/accounts';
import {
  canViewProfile,
  getAccountByIdentifier,
  loadProfileView,
  readProfileVisibility,
  type ProfileView,
} from '@/server/arcade/player-profile-view';
import { getAppBaseUrl } from '@/server/arcade/shared-utils';

import { playerCardHash, playerCardModel, type PlayerCardModel } from './player-card';

export type CardAccess = {
  view: ProfileView;
  model: PlayerCardModel;
  hash: string;
  /** Anyone may see it, so it may be cached and embedded. */
  isPublic: boolean;
  origin: string;
};

function readCookie(request: Request, name: string) {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

async function viewerFor(request: Request) {
  const token = readCookie(request, ACCOUNT_SESSION_COOKIE);
  if (!token) return null;
  try {
    const identity = await getIdentityForSessionToken(token);
    return identity ? { userId: identity.userId, roles: identity.roles } : null;
  } catch {
    return null;
  }
}

export async function resolvePlayerCard(
  request: Request,
  identifier: string,
  { publicOnly = false }: { publicOnly?: boolean } = {},
): Promise<CardAccess | null> {
  const account = await getAccountByIdentifier(identifier);
  if (!account || account.status === 'deleted') return null;
  const visibility = await readProfileVisibility(account.id);
  const isPublic = account.status === 'active' && visibility === 'public';
  if (!isPublic) {
    if (publicOnly) return null;
    const viewer = await viewerFor(request);
    if (!viewer || !canViewProfile({ account, viewer, visibility })) return null;
  }
  const origin = getAppBaseUrl();
  const view = await loadProfileView(account);
  const model = playerCardModel(view, origin);
  return { view, model, hash: playerCardHash(model), isPublic, origin };
}

export const cardPath = (href: string) => `${href}/card.png`;
export const embedPath = (href: string) => `${href}/embed`;
