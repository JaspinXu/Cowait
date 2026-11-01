// Assemble the product page: site/ plus the README media, into one folder ready to serve.
//   node scripts/site.mjs [out]     (default: data/site, inside the clone)
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const out = path.resolve(root, process.argv[2] ?? 'data/site');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(path.join(root, 'site'), out, { recursive: true });
cpSync(path.join(root, 'docs', 'media'), path.join(out, 'media'), { recursive: true });
console.log('site ready in', path.relative(root, out) || '.');
