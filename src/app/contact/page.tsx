import type { Metadata } from 'next';
import { FeedbackPageContent } from '@/app/feedback/_feedback-page';

export const metadata: Metadata = {
  title: 'Contact | Arcade',
  description: 'Contact Arcade by Odom Tech through a private support form.',
};

export default function ContactPage() {
  return <FeedbackPageContent initialCategory='other' contactMode />;
}
