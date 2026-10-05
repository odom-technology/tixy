import { notFound } from 'next/navigation';

import { SoundSheet } from './_sound-sheet';

export const metadata = {
  title: 'sounds | tixy.lol',
  robots: { index: false, follow: false },
};

/* Every sound to audition: samples, cues and generated takes. Development
   only, like /kit. */
export default function KitSoundsPage() {
  if (process.env.NODE_ENV === 'production' && process.env.TIXY_KIT_SHEET !== '1') notFound();
  return <SoundSheet />;
}
