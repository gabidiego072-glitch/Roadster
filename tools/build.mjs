// Builds dist/Roadster.html: one self-contained file (game + three.js + CSS) that runs with a double click.
// Usage: npm install && npm run build
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nodePaths = process.env.NODE_PATH ? process.env.NODE_PATH.split(':') : [];
const out = await build({
  entryPoints: [join(root, 'js/main.js')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  write: false,
  nodePaths,
  legalComments: 'none',
});
const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = readFileSync(join(root, 'css/style.css'), 'utf8');
let html = readFileSync(join(root, 'index.html'), 'utf8');
html = html.replace(/\s*<script type="importmap">[\s\S]*?<\/script>/, '');
html = html.replace('<link rel="stylesheet" href="css/style.css" />', () => `<style>\n${css}\n</style>`);
html = html.replace('<script type="module" src="js/main.js"></script>', () => `<script>\n${js}\n</script>`);
mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/Roadster.html'), html);
console.log('dist/Roadster.html', (html.length / 1024 / 1024).toFixed(2) + ' MB');
