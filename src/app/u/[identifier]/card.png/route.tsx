/* GET /u/<name>/card.png: the player card as a 1200 x 630 PNG, or 2400 x
   1260 with ?size=2x. Every other query parameter is ignored, so a share
   link's ?v=<hash> only busts caches and can't force extra draws. */

import { renderPlayerCard } from '@/server/arcade/player-card';
import { resolvePlayerCard } from '@/server/arcade/player-card-access';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/* Drawn cards, keyed by their ETag (the model's hash and the size), so a
   card is drawn once per change. Oldest out first past 200 cards. */
const MAX_DRAWN = 200;
const drawn = new Map<string, ArrayBuffer>();
function remember(etag: string, body: ArrayBuffer) {
  drawn.set(etag, body);
  if (drawn.size > MAX_DRAWN) drawn.delete(drawn.keys().next().value!);
}

const notFound = () =>
  new Response('Not found.', {
    status: 404,
    headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'content-type': 'text/plain; charset=utf-8' },
  });

async function handle(request: Request, params: Promise<{ identifier: string }>, head: boolean) {
  const { identifier } = await params;
  const card = await resolvePlayerCard(request, identifier);
  if (!card) return notFound();

  const scale = new URL(request.url).searchParams.get('size') === '2x' ? 2 : 1;
  const etag = `"${card.hash}-${scale}x"`;
  const headers: Record<string, string> = {
    'content-type': 'image/png',
    'cache-control': card.isPublic ? 'public, max-age=300' : 'private, no-store',
    etag,
    'x-content-type-options': 'nosniff',
  };
  // Other sites may draw a public card in an <img> or a canvas.
  if (card.isPublic) headers['access-control-allow-origin'] = '*';

  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers });
  }
  if (head) return new Response(null, { status: 200, headers });

  try {
    let body = drawn.get(etag);
    if (!body) {
      body = await renderPlayerCard(card.model, scale);
      remember(etag, body);
    }
    return new Response(body, { status: 200, headers });
  } catch (error) {
    console.error('[player-card] render failed:', error);
    return new Response('The card did not draw.', {
      status: 500,
      headers: { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' },
    });
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ identifier: string }> }) {
  return handle(request, params, false);
}

export async function HEAD(request: Request, { params }: { params: Promise<{ identifier: string }> }) {
  return handle(request, params, true);
}
