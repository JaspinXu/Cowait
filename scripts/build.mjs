// Bundle Cowait into two self-contained files so it runs straight from a clone,
// with no `npm install` on the user's machine.
import { build } from 'esbuild';
import { rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });

const common = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  legalComments: 'none',
  logLevel: 'warning',
  // CommonJS dependencies (React) call require(); give the ESM bundle one.
  banner: { js: "import { createRequire as __cowaitRequire } from 'node:module'; const require = __cowaitRequire(import.meta.url);" },
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [
    {
      // Ink only connects to React DevTools when DEV=true; ship an empty stand-in.
      name: 'stub-devtools',
      setup(b) {
        b.onResolve({ filter: /^react-devtools-core$/ }, () => ({ path: 'react-devtools-core', namespace: 'stub' }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export default { initialize() {}, connectToDevTools() {} };' }));
      },
    },
  ],
};

// The hook runs on every tool call: keep it tiny and dependency-free.
await build({ ...common, entryPoints: ['src/hook.ts'], outfile: 'dist/hook.js' });
await build({ ...common, entryPoints: ['src/cli.ts'], outfile: 'dist/cli.js' });
