import type { Metadata } from 'next';
import { FeedbackPageContent } from './_feedback-page';
import { getFeedbackCategory } from '@/features/arcade/lib/feedback-categories';

export const metadata: Metadata = {
  title: 'Feedback | tixy',
  description: 'Contact tixy team for account and purchase help, privacy requests, bug reports, and game suggestions.',
  alternates: { canonical: '/feedback' },
};

export default async function FeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string | string[] }>;
}) {
  const { category } = await searchParams;
  return <FeedbackPageContent initialCategory={getFeedbackCategory(category)} />;
}
