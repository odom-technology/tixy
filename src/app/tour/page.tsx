import { redirect } from 'next/navigation';

/* The tixy tour is scrapped for now (ROADMAP.md, "Decided for this roadmap").
   Its weekly games are the weekly card on the season page. The code stays
   until phase 8. */
export const dynamic = 'force-dynamic';

export default function ArcadeTourPage() {
  redirect('/');
}
