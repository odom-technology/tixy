import { notFound } from 'next/navigation';

import { KitSheet } from './_kit-sheet';

export const metadata = {
  title: 'kit | tixy.lol',
  robots: { index: false, follow: false },
};

/* Every shared piece in its states, for review and screenshots. Development
   only, unless TIXY_KIT_SHEET=1 turns it on for a production build. */
export default function KitPage() {
  if (process.env.NODE_ENV === 'production' && process.env.TIXY_KIT_SHEET !== '1') notFound();
  return <KitSheet />;
}
