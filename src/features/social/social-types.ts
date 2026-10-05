export type SocialPerson = {
  userId: string;
  name: string;
  imageUrl: string | null;
};

export type FriendSummary = SocialPerson & {
  friendshipId: string;
  requestedAt: number;
};

export type SocialMessage = {
  id: string;
  conversationId: string;
  senderUserId: string;
  senderName: string;
  senderImageUrl?: string | null;
  type: 'text' | 'reaction' | 'system';
  content: string;
  createdAt: number;
  deletedAt: number | null;
};

export type ConversationSummary = {
  id: string;
  kind: 'dm';
  gameType: string | null;
  otherMembers: SocialPerson[];
  lastMessage: SocialMessage | null;
  unreadCount: number;
  muted: boolean;
  updatedAt: number;
};

export type SocialSnapshot = {
  currentUser: SocialPerson & { isAdmin: boolean };
  friends: FriendSummary[];
  incoming: FriendSummary[];
  outgoing: FriendSummary[];
  conversations: ConversationSummary[];
  lobbyUnreadCount: number;
  blockedUserIds: string[];
  presence: Array<{
    userId: string;
    status: 'online' | 'in_game' | 'away' | 'offline';
    gameSlug: string | null;
    lastSeenAt: number;
  }>;
};

export type SocialSearchPlayer = SocialPerson & {
  profileHref: string;
  relationship:
    | { status: 'none' | 'self' }
    | { status: 'friends' | 'incoming' | 'outgoing'; friendshipId: string };
};

export type SocialThreadTarget =
  | { kind: 'lobby'; id: 'arcade-lobby' }
  | { kind: 'dm'; id: string };
