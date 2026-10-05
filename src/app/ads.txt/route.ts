const DEFAULT_PUBLISHER_ID = 'pub-9188105841935377';

const normalizePublisherId = () => {
  const explicit = process.env.ADSENSE_PUBLISHER_ID?.trim();
  if (explicit) return explicit.startsWith('pub-') ? explicit : `pub-${explicit}`;

  const clientId = process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID?.trim();
  if (!clientId) return DEFAULT_PUBLISHER_ID;
  return clientId.replace(/^ca-/, '');
};

export function GET() {
  const publisherId = normalizePublisherId();

  return new Response(
    `google.com, ${publisherId}, DIRECT, f08c47fec0942fa0\n`,
    {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      },
    },
  );
}
