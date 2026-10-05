/* Exports the tixy brand files from the React components in
   src/features/brand, so the files and the header draw the same thing.

     npx tsx scripts/brand/build-brand-assets.tsx

   Rerun scripts/brand/outline-wordmark.py first if the wordmark changes.
   Rasterises with sharp, which Next.js already installs for image
   optimisation. Writes:

     src/app/icon.svg              tab icon, the 16 px drawing
     src/app/favicon.ico           16 and 32 px, the 16 px drawing
     src/app/apple-icon.png        180 px, full bleed (iOS rounds it)
     src/app/opengraph-image.png   1200 x 630 share image
     src/app/twitter-image.png     the same image for X
     public/brand/tixy/*.svg       mark, wordmark, lockup, host
     public/brand/tixy/*.png       192 and 512 app icons, maskable 512
*/

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import sharp from 'sharp';

import {
  TixyAppIcon,
  TixyLogo,
  TixyMark,
  TixyWordmark,
} from '../../src/features/brand/tixy-brand';
import { LOCKUP, TIXY_COLORS } from '../../src/features/brand/tixy-brand-geometry';
import { TixyHost } from '../../src/features/brand/tixy-host';

const root = path.resolve(import.meta.dirname, '../..');
const appDir = path.join(root, 'src/app');
const brandDir = path.join(root, 'public/brand/tixy');

const NAME = 'tixy.lol';
const svg = (element: ReactElement) => `${renderToStaticMarkup(element)}\n`;

async function png(markup: string, size: { width: number; height: number }) {
  return sharp(Buffer.from(markup), { density: 72 })
    .resize(size.width, size.height, { kernel: 'lanczos3' })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/* Draw at 8x and scale down, so edges get real antialiasing. */
async function iconPng(element: (size: number) => ReactElement, size: number) {
  return png(svg(element(size * 8)), { width: size, height: size });
}

/* An .ico is a small directory of PNGs. */
function ico(images: { size: number; data: Buffer }[]) {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, index) => {
    const entry = 6 + index * 16;
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt8(0, entry + 2);
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map((image) => image.data)]);
}

/* 1200 x 630 on paper: the lockup, centred. No slogan. */
function shareImage() {
  const width = 1200;
  const height = 630;
  const logoWidth = 780;
  const logoHeight = (logoWidth * LOCKUP.height) / LOCKUP.width;
  const logo = renderToStaticMarkup(
    createElement(TixyLogo, { height: logoHeight, color: TIXY_COLORS.ink }),
  ).replace(
    '<svg ',
    `<svg x="${(width - logoWidth) / 2}" y="${(height - logoHeight) / 2}" `,
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${TIXY_COLORS.paper}"/>${logo}</svg>\n`;
}

async function main() {
  await mkdir(brandDir, { recursive: true });
  const written: string[] = [];
  const write = async (file: string, data: string | Buffer) => {
    await writeFile(file, data);
    written.push(path.relative(root, file));
  };

  const small = (size: number) => createElement(TixyAppIcon, { size, detail: 'small', label: NAME });
  const rounded = (size: number) => createElement(TixyAppIcon, { size, label: NAME });
  const square = (size: number) => createElement(TixyAppIcon, { size, shape: 'square', label: NAME });
  const maskable = (size: number) => createElement(TixyAppIcon, { size, shape: 'maskable', label: NAME });

  await write(path.join(appDir, 'icon.svg'), svg(small(32)));
  await write(
    path.join(appDir, 'favicon.ico'),
    ico([
      { size: 16, data: await iconPng(small, 16) },
      { size: 32, data: await iconPng(small, 32) },
    ]),
  );
  await write(path.join(appDir, 'apple-icon.png'), await iconPng(square, 180));

  const share = await png(shareImage(), { width: 1200, height: 630 });
  await write(path.join(appDir, 'opengraph-image.png'), share);
  await write(path.join(appDir, 'twitter-image.png'), share);

  await write(path.join(brandDir, 'icon-192.png'), await iconPng(rounded, 192));
  await write(path.join(brandDir, 'icon-512.png'), await iconPng(rounded, 512));
  await write(path.join(brandDir, 'icon-maskable-512.png'), await iconPng(maskable, 512));
  await write(path.join(brandDir, 'icon.svg'), svg(rounded(512)));

  await write(path.join(brandDir, 'mark.svg'), svg(createElement(TixyMark, { width: 240, label: NAME })));
  await write(
    path.join(brandDir, 'wordmark.svg'),
    svg(createElement(TixyWordmark, { height: 120, color: TIXY_COLORS.ink, label: NAME })),
  );
  await write(
    path.join(brandDir, 'wordmark-on-ink.svg'),
    svg(createElement(TixyWordmark, { height: 120, color: TIXY_COLORS.paper, label: NAME })),
  );
  await write(
    path.join(brandDir, 'logo.svg'),
    svg(createElement(TixyLogo, { height: 160, color: TIXY_COLORS.ink, label: NAME })),
  );
  await write(
    path.join(brandDir, 'logo-on-ink.svg'),
    svg(createElement(TixyLogo, { height: 160, color: TIXY_COLORS.paper, label: NAME })),
  );
  await write(path.join(brandDir, 'host.svg'), svg(createElement(TixyHost, { width: 300 })));

  console.log(written.map((file) => `wrote ${file}`).join('\n'));
}

await main();
