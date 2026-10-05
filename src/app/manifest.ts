import type { MetadataRoute } from 'next';

/* Icons come from scripts/brand/build-brand-assets.tsx. `display: browser`
   keeps today's behaviour: adding the site to a home screen opens a tab,
   so checkout and sign-in flows stay in the browser. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'tixy.lol',
    short_name: 'tixy',
    start_url: '/',
    display: 'browser',
    background_color: '#F4EBDC',
    theme_color: '#1F1A16',
    icons: [
      { src: '/brand/tixy/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/tixy/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/brand/tixy/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
