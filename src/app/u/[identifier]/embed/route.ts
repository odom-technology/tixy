/* GET /u/<name>/embed: the player card for an <iframe> on another site. A
   bare page (no app shell, no scripts) holding the card image, linked to the
   profile. Only public profiles embed. next.config.ts lets this one path be
   framed by any site; everything else stays frame-ancestors 'none'. */

import { cardPath, resolvePlayerCard } from '@/server/arcade/player-card-access';

export const dynamic = 'force-dynamic';

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

export async function GET(request: Request, { params }: { params: Promise<{ identifier: string }> }) {
  const { identifier } = await params;
  const card = await resolvePlayerCard(request, identifier, { publicOnly: true });
  if (!card) {
    return new Response('<!doctype html><title>tixy.lol</title>', {
      status: 404,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
    });
  }
  const name = escapeHtml(card.view.name);
  const page = escapeHtml(`${card.origin}${card.view.href}`);
  const image = escapeHtml(`${card.origin}${cardPath(card.view.href)}?v=${card.hash}`);
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${name} on tixy.lol</title>
<style>
html, body { margin: 0; padding: 0; background: transparent; }
a { display: block; border-radius: 4.2%/8%; overflow: hidden; outline-offset: 3px; }
a:focus-visible { outline: 3px solid #f2a33c; }
img { display: block; width: 100%; height: auto; }
</style>
</head>
<body>
<a href="${page}" target="_blank" rel="noopener"><img src="${image}" width="1200" height="630" alt="${name}'s player card on tixy.lol"></a>
</body>
</html>
`;
  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=300',
      'x-robots-tag': 'noindex',
    },
  });
}
