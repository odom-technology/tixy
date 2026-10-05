import { notFound } from 'next/navigation';

import { WheelSheet } from './_wheel-sheet';

export const metadata = {
  title: 'wheel | tixy.lol',
  robots: { index: false, follow: false },
};

/* The daily wheel with a local draw, for feel review, frame timing and
   screenshots. Development only, like /kit. */
export default function KitWheelPage() {
  if (process.env.NODE_ENV === 'production' && process.env.TIXY_KIT_SHEET !== '1') notFound();
  return <WheelSheet />;
}
