import { getAccountById } from '@/server/accounts';
import { requireIdentity } from '@/server/auth';
import {
  type FeedbackCategory,
  listFeedbackForUser,
} from '@/server/feedback';

import { FeedbackClient } from './_feedback-client';

type FeedbackPageContentProps = {
  initialCategory?: FeedbackCategory;
  contactMode?: boolean;
};

export async function FeedbackPageContent({
  initialCategory,
  contactMode = false,
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
        listFeedbackForUser(identity.userId, 10),
      ])
    : [null, []];

  return (
    <FeedbackClient
      account={
        account
          ? {
              username: account.username,
              email: account.email,
            }
          : null
      }
      initialEntries={entries}
      initialCategory={initialCategory}
      contactMode={contactMode}
    />
  );
}
