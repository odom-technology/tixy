import { FeedbackPageContent } from '../_feedback-page';

export const metadata = {
  title: 'New feedback | Arcade',
};

export default function NewFeedbackPage() {
  return <FeedbackPageContent initialCategory='game_request' />;
}
