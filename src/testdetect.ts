/** Recognise test runs in Bash commands and read their outcome from the output. */

const RUNNERS = new Set(['jest', 'vitest', 'mocha', 'ava', 'pytest', 'py.test', 'tox', 'nox', 'rspec', 'phpunit', 'ctest', 'unittest']);
const WRAPPERS = new Set(['npx', 'bunx', 'uvx', 'time', 'sudo', 'exec', 'env', 'command']);
const RUN_WRAPPERS = new Set(['uv', 'poetry', 'pipenv', 'pdm', 'hatch', 'rye']);

function segmentIsTest(segment: string): boolean {
  const w = segment.trim().split(/\s+/).filter(Boolean);
  // Drop leading env assignments and wrappers: `CI=1 npx vitest`, `uv run pytest`, `python -m pytest`.
  for (let guard = 0; guard < 6 && w.length; guard++) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0]) || WRAPPERS.has(w[0])) w.shift();
    else if (RUN_WRAPPERS.has(w[0]) && w[1] === 'run') w.splice(0, 2);
    else if ((w[0] === 'pnpm' || w[0] === 'yarn') && (w[1] === 'exec' || w[1] === 'dlx')) w.splice(0, 2);
    else if (/^python(\d+(\.\d+)?)?(\.exe)?$/.test(w[0]) && w[1] === '-m') w.splice(0, 2);
    else break;
  }
  if (!w.length) return false;
  const cmd = w[0].split(/[\\/]/).pop()!.replace(/\.(cmd|exe|bat)$/i, '');
  const args = w.slice(1).filter((a) => !a.startsWith('-'));
  if (RUNNERS.has(cmd)) return true;
  if (cmd === 'playwright') return args[0] === 'test';
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(cmd)) {
    if (args[0] === 'test' || args[0] === 't' || args[0]?.startsWith('test:')) return true;
    return args[0] === 'run' && /^test(\b|:)/.test(args[1] ?? '');
  }
  if (cmd === 'go' || cmd === 'dotnet' || cmd === 'deno') return args[0] === 'test';
  if (cmd === 'cargo') return args[0] === 'test' || args[0] === 'nextest';
  if (cmd === 'make') return args.includes('test') || args.includes('check');
  if (/^mvnw?$/.test(cmd)) return args.includes('test') || args.includes('verify');
  if (/^gradlew?$/.test(cmd)) return args.some((a) => a === 'test' || a === 'check' || a.endsWith(':test'));
  return false;
}

export function isTestCommand(command: string): boolean {
  return command.split(/&&|\|\||;|\||\n/).some(segmentIsTest);
}

const FAIL_PATTERNS: RegExp[] = [
  /\b[1-9]\d*\s+(failed|failing|failures?)\b/i,
  /\b[1-9]\d*\s+errors?\b(?!\s*=\s*0)/i,
  /^\s*FAIL\b/m,
  /^--- FAIL/m,
  /test result: FAILED/,
  /\bFAILED\s*\((failures|errors)=/,
  /^FAILED\b/m,
  /Tests?:\s+[^\n]*\b[1-9]\d* failed/i,
  /BUILD FAILURE/,
];

const PASS_PATTERNS: RegExp[] = [
  /\b\d+\s+(passed|passing)\b/i,
  /test result: ok\b/,
  /^ok\s+\S+/m,
  /^\s*PASS\b/m,
  /^OK(\s*\(|\s*$)/m,
  /\ball tests passed\b/i,
  /BUILD SUCCESS/,
  /Tests?:\s+\d+ passed/i,
];

export type TestResult = 'pass' | 'fail' | 'unknown';

export function testOutcome(output: string): TestResult {
  if (!output) return 'unknown';
  if (FAIL_PATTERNS.some((r) => r.test(output))) return 'fail';
  if (PASS_PATTERNS.some((r) => r.test(output))) return 'pass';
  return 'unknown';
}
