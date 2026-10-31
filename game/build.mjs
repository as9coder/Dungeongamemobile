import * as esbuild from 'esbuild';
import fs from 'fs';
const watch = process.argv.includes('--watch');
fs.mkdirSync('dist', { recursive: true });
const opts = {
  entryPoints: { game: 'src/main.js' },
  bundle: true, minify: !watch, sourcemap: false, outdir: 'dist',
  target: ['chrome80', 'safari13'], format: 'iife', logLevel: 'info',
  loader: { '.woff2': 'dataurl', '.woff': 'dataurl' },
  legalComments: 'none', define: { 'process.env.NODE_ENV': '"production"' },
};
fs.copyFileSync('src/index.html', 'dist/index.html');
if (watch) { const ctx = await esbuild.context(opts); await ctx.watch(); }
else await esbuild.build(opts);
