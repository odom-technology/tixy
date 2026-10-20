import { getAccountById } from '@/server/accounts';
import { requireIdentity } from '@/server/auth';
import {
  type FeedbackCategory,
  listFeedbackForUser,
  toFeedbackTicketEntry,
} from '@/server/feedback';

import { FeedbackClient } from './_feedback-client';

type FeedbackPageContentProps = {
  initialCategory?: FeedbackCategory;
};

export async function FeedbackPageContent({
  initialCategory,
}: FeedbackPageContentProps) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    identity = null;
  }

  const [account, entries] = identity
    ? await Promise.all([
        getAccountById(identity.userId),
        listFeedbackForUser(identity.userId, 50),
      ])
    : [null, []];

  return (
    <FeedbackClient
      key={initialCategory ?? 'other'}
      account={
        account
          ? {
              username: account.username,
            }
          : null
      }
      initialEntries={entries.map(toFeedbackTicketEntry)}
      initialCategory={initialCategory}
    />
  );
}
