import type { FeedbackCategory } from '@/server/feedback';

export const feedbackCategories: Array<{
  value: FeedbackCategory;
  label: string;
  hint: string;
  prompt: string;
  placeholder: string;
  pageLabel?: string;
}> = [
  { value: 'other', label: 'General question', hint: 'Ask us anything about tixy or ODOM Tech.', prompt: 'What would you like to ask?', placeholder: 'Tell us what you need help with or would like to know.' },
  { value: 'bug', label: 'Bug report', hint: 'Tell us what happened so we can reproduce it.', prompt: 'What went wrong?', placeholder: 'What did you expect? What happened instead? Include steps to reproduce it.', pageLabel: 'Page or game where it happened' },
  { value: 'game_request', label: 'Game request', hint: 'Suggest a game or an improvement to an existing one.', prompt: 'What would you like to see?', placeholder: 'Describe the game or feature and why it would be fun.' },
  { value: 'performance', label: 'Slow or broken page', hint: 'Help us track down slow loading, lag, or errors.', prompt: 'What felt slow or failed?', placeholder: 'Which device and browser were you using? What happened?', pageLabel: 'Page or game affected' },
  { value: 'layout', label: 'Design feedback', hint: 'Share what is confusing or could be easier to use.', prompt: 'What could we improve?', placeholder: 'What were you trying to do, and what made it difficult?', pageLabel: 'Page you are referring to' },
  { value: 'account', label: 'Account help', hint: 'Tell us about sign in, profile, or account access issues.', prompt: 'How can we help with your account?', placeholder: 'Describe the issue. Do not include your password or recovery code.' },
  { value: 'purchase', label: 'Purchase help', hint: 'Ask about a charge, purchase, or digital item.', prompt: 'What happened with your purchase?', placeholder: 'Include the approximate date and item. Do not include card numbers or payment details.' },
  { value: 'privacy', label: 'Privacy request', hint: 'Ask about your data or request a privacy action.', prompt: 'What privacy help do you need?', placeholder: 'Describe your request. We may ask you to verify account ownership before acting.' },
  { value: 'ads', label: 'Ad issue', hint: 'Report an ad that is confusing, inappropriate, or broken.', prompt: 'What was wrong with the ad?', placeholder: 'Describe the ad and where you saw it. Do not include sensitive personal information.', pageLabel: 'Page where you saw the ad' },
];

export function getFeedbackCategory(
  value: string | string[] | undefined,
  fallback: FeedbackCategory = 'other',
): FeedbackCategory {
  const requested = Array.isArray(value) ? value[0] : value;
  return feedbackCategories.find((item) => item.value === requested)?.value ?? fallback;
}
