import localFont from 'next/font/local';

/* The tixy faces, self-hosted so the build never fetches from Google.
   Both are OFL; the licences sit beside the woff2 files. Only the `tixy`
   theme in globals.css switches the app's faces to these variables, so
   preload stays off while the theme is opt-in. */

export const gabarito = localFont({
  src: './gabarito-latin-variable.woff2',
  weight: '400 900',
  style: 'normal',
  variable: '--font-gabarito',
  display: 'swap',
  preload: false,
});

export const bigShoulders = localFont({
  src: './big-shoulders-latin-variable.woff2',
  weight: '100 900',
  style: 'normal',
  variable: '--font-big-shoulders',
  display: 'swap',
  preload: false,
});
