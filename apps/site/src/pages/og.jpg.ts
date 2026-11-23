/**
 * Share image (Open Graph) generated at build time: the hero photo with the logo
 * and the hero copy drawn on top. Social networks only accept bitmaps, so the
 * layout is built with satori (text becomes paths) and flattened with sharp.
 */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

import type { APIRoute } from 'astro';
import satori from 'satori';
import sharp from 'sharp';

import { ICON } from '../components/icons';
import { HERO, SITE } from '../config';

const WIDTH = 1200;
const HEIGHT = 630;
const GREEN = '#0c7a4b';
const AMBER = '#f2a93b';

// Build runs from apps/site; resolving from there also finds hoisted packages.
const siteRoot = process.cwd();
const resolve = createRequire(path.join(siteRoot, 'package.json')).resolve;

/** Minimal element factory: satori takes React-shaped objects, no React needed. */
type Node = { type: string; props: Record<string, unknown> };
const h = (type: string, props: Record<string, unknown>, ...children: (Node | string)[]): Node => ({
  type,
  props: { ...props, children: children.length === 1 ? children[0] : children },
});

const font = (file: string) => readFile(resolve(`@fontsource/${file}`));

function layout(): Node {
  const logo = h(
    'div',
    { style: { display: 'flex', alignItems: 'center', gap: 18 } },
    h(
      'div',
      { style: { display: 'flex', width: 56, height: 56, borderRadius: 15, background: GREEN, alignItems: 'center', justifyContent: 'center' } },
      h(
        'svg',
        { width: 32, height: 32, viewBox: '0 0 24 24', fill: 'none', stroke: '#ffffff', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
        h('path', { d: ICON.route }),
      ),
    ),
    h('div', { style: { fontFamily: 'Bricolage Grotesque', fontWeight: 700, fontSize: 30, letterSpacing: '-0.02em' } }, SITE.name),
  );

  const headline = h(
    'div',
    { style: { display: 'block', fontFamily: 'Bricolage Grotesque', fontWeight: 700, fontSize: 76, lineHeight: 1.08, letterSpacing: '-0.03em', maxWidth: 880 } },
    HERO.headline.before,
    h('span', { style: { color: AMBER } }, HERO.headline.highlight),
    HERO.headline.after,
  );

  return h(
    'div',
    {
      style: {
        width: WIDTH, height: HEIGHT, display: 'flex', flexDirection: 'column',
        padding: 72, color: '#ffffff',
        backgroundImage: 'linear-gradient(90deg, rgba(6,24,16,0.82) 0%, rgba(6,24,16,0.55) 60%, rgba(6,24,16,0.25) 100%)',
      },
    },
    logo,
    h(
      'div',
      { style: { display: 'flex', flexDirection: 'column', justifyContent: 'center', flexGrow: 1, gap: 28 } },
      headline,
      h('div', { style: { fontFamily: 'Inter', fontSize: 30, color: 'rgba(240,253,244,0.92)' } }, HERO.tagline),
    ),
  );
}

export const GET: APIRoute = async () => {
  const [bricolage, inter, photo] = await Promise.all([
    font('bricolage-grotesque/files/bricolage-grotesque-latin-700-normal.woff'),
    font('inter/files/inter-latin-400-normal.woff'),
    readFile(path.join(siteRoot, 'src/assets/lima-costa.webp')),
  ]);

  const overlay = await satori(layout() as Parameters<typeof satori>[0], {
    width: WIDTH,
    height: HEIGHT,
    fonts: [
      { name: 'Bricolage Grotesque', data: bricolage, weight: 700, style: 'normal' },
      { name: 'Inter', data: inter, weight: 400, style: 'normal' },
    ],
  });

  const image = await sharp(photo)
    .resize(WIDTH, HEIGHT, { fit: 'cover' })
    .composite([{ input: Buffer.from(overlay) }])
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();

  return new Response(new Uint8Array(image), { headers: { 'Content-Type': 'image/jpeg' } });
};
