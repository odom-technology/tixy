import type { Metadata } from 'next';

import StarterMatchClient from './_starter-match-client';

export const metadata: Metadata = {
  title: 'Pattern Match | tixy',
  description: 'Match eight shapes in the Tixy contributor starter game.',
};

export default function StarterMatchPage() {
  return <StarterMatchClient />;
}
