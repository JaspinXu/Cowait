// Bundle Cowait into two self-contained files so it runs straight from a clone,
// with no `npm install` on the user's machine.
import { build } from 'esbuild';
import { readFileSync, rmSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));

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
  define: {
    'process.env.NODE_ENV': '"production"',
    // Baked in so a standalone binary (no package.json next to it) knows its version.
    __COWAIT_VERSION__: JSON.stringify(version),
  },
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
// __COWAIT_HOOK_ENTRY__ says which bundle may start a hook run on load (see src/hook.ts).
await build({ ...common, define: { ...common.define, __COWAIT_HOOK_ENTRY__: 'true' }, entryPoints: ['src/hook.ts'], outfile: 'dist/hook.js' });
await build({ ...common, define: { ...common.define, __COWAIT_HOOK_ENTRY__: 'false' }, entryPoints: ['src/cli.ts'], outfile: 'dist/cli.js' });
