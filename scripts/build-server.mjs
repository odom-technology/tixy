import { existsSync, statSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = path.join(root, 'src');
const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

const resolveSourcePath = (request) => {
  const base = path.join(srcRoot, request.slice(2));
  if (existsSync(base) && statSync(base).isFile()) return base;
  for (const extension of extensions) {
    const candidate = `${base}${extension}`;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  for (const extension of extensions) {
    const candidate = path.join(base, `index${extension}`);
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return base;
};

const tsconfigPathsPlugin = {
  name: 'arcade-tsconfig-paths',
  setup(buildApi) {
    buildApi.onResolve({ filter: /^next\/headers$/ }, () => ({
      path: 'next/headers.js',
      external: true,
    }));

    buildApi.onResolve({ filter: /^@\// }, (args) => ({
      path: resolveSourcePath(args.path),
    }));
  },
};

await rm(path.join(root, 'dist'), { recursive: true, force: true });
await mkdir(path.join(root, 'dist'), { recursive: true });

await build({
  entryPoints: [path.join(root, 'server.ts')],
  outdir: path.join(root, 'dist'),
  bundle: true,
  splitting: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: false,
  entryNames: 'server',
  chunkNames: 'chunks/[name]-[hash]',
  outExtension: { '.js': '.mjs' },
  packages: 'external',
  plugins: [tsconfigPathsPlugin],
  banner: {
    js: [
      "import { createRequire as __arcadeCreateRequire } from 'node:module';",
      'const require = __arcadeCreateRequire(import.meta.url);',
    ].join('\n'),
  },
  logLevel: 'info',
});
