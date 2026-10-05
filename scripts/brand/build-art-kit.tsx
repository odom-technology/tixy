/* Exports the art kit from the components in src/features/brand/avatars, so
   the files and the app draw the same thing.

     npx tsx scripts/brand/build-art-kit.tsx

   Writes, under public/art/:

     avatars/<id>.svg and .png     96 unit square, PNG at 192 px
     frames/<id>.svg and .png      rings over the same square
     namecards/<id>.svg and .png   256 x 64 units, PNG at 512 x 128
     medals/<id>.svg and .png      96 unit square, PNG at 192 px

   The SVG is the source. The PNG is for places that can't take an SVG, such
   as an `<Image>` that skips optimisation or a share card, and is drawn at 4x
   and scaled down so edges get real antialiasing. Run
   `npx tsx scripts/check-art-kit.ts` afterwards. */

import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import sharp from 'sharp';

import {
  ART_DIR,
  ART_ITEMS,
  Frame,
  Medal,
  Namecard,
  PNG_SIZE,
  StubAvatar,
  artPath,
  type ArtItem,
} from '../../src/features/brand/avatars';

const root = path.resolve(import.meta.dirname, '../..');
const out = path.join(root, 'public', ART_DIR);

function element(item: ArtItem): ReactElement {
  switch (item.kind) {
    case 'avatar':
      return createElement(StubAvatar, item.spec);
    case 'frame':
      return createElement(Frame, { id: item.frame });
    case 'namecard':
      return createElement(Namecard, { id: item.card });
    case 'medal':
      return createElement(Medal, { id: item.medal });
  }
}

/* React closes every element, `<circle ...></circle>`. SVG doesn't need it. */
export const toSvg = (item: ArtItem) =>
  `${renderToStaticMarkup(element(item)).replace(/<(\w+)([^>]*)><\/\1>/g, '<$1$2/>')}\n`;

async function main() {
  await rm(out, { recursive: true, force: true });
  let svgBytes = 0;
  for (const item of ART_ITEMS) {
    const svg = toSvg(item);
    const file = (ext: 'svg' | 'png') => path.join(root, 'public', artPath(item, ext));
    await mkdir(path.dirname(file('svg')), { recursive: true });
    await writeFile(file('svg'), svg);
    const { width, height } = PNG_SIZE[item.kind];
    const png = await sharp(Buffer.from(svg), { density: 72 * 4 })
      .resize(width, height, { kernel: 'lanczos3' })
      .png({ compressionLevel: 9, palette: false })
      .toBuffer();
    await writeFile(file('png'), png);
    svgBytes += svg.length;
  }
  console.log(`wrote ${ART_ITEMS.length} items to public/${ART_DIR} (${svgBytes} bytes of SVG)`);
}

if (import.meta.url === `file://${process.argv[1]}`) void main();
