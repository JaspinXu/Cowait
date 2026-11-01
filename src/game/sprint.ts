/**
 * Code Sprint (代码速打) — a short-wait typing game: type 5 real lines of code, one at a time.
 * A round fits a 20–60 second wait and can be dropped at any moment: a pause between two keys
 * costs at most PAUSE_CAP_MS of "active" time, so walking away to read Claude's answer and coming
 * back later does not ruin the score.
 *
 * Pure logic, plain JSON state (saved to disk as-is), no clock of its own: every call takes `now`.
 */

/** A pause between two keys counts as at most this much typing time. */
export const PAUSE_CAP_MS = 3000;
/** `typed` never grows more than this many characters past the end of the line. */
export const OVERFLOW = 8;
/** Personal bests only count rounds at least this accurate. */
export const PB_MIN_ACCURACY = 0.9;
/** Faster than this is a paste, not typing: never a personal best. */
export const PB_MAX_WPM = 250;

/** Bounds for lines pulled out of Claude's changes. */
const CHANGE_MIN = 16;
const CHANGE_MAX = 64;

// ---------------------------------------------------------------- built-in lines

/** Original single lines of everyday code (18–60 printable ASCII chars, no indentation). */
export const SNIPPETS: string[] = [
  // TypeScript / JavaScript
  'const total = items.reduce((sum, x) => sum + x.price, 0);',
  'export function clamp(n: number, lo: number, hi: number) {',
  "if (!user) throw new Error('user not found');",
  "import { readFile } from 'node:fs/promises';",
  "const res = await fetch(url, { method: 'POST', body });",
  'return todos.filter((t) => t.done).length;',
  'setTimeout(() => controller.abort(), 5000);',
  'const [count, setCount] = useState(0);',
  'for (const [key, value] of Object.entries(env)) {',
  "export type Status = 'idle' | 'busy' | 'failed';",
  'const id = crypto.randomUUID().slice(0, 8);',
  "app.get('/health', (req, res) => res.send('ok'));",
  'const names = users.map((u) => u.name).sort();',
  "if (retries > 3) return { ok: false, reason: 'timeout' };",
  'console.error(`failed after ${ms} ms`, err);',
  "const query = new URLSearchParams({ page: '2', q });",
  'await Promise.all(jobs.map((job) => job.run()));',
  "localStorage.setItem('theme', JSON.stringify(mode));",
  'const debounced = debounce(save, 300);',
  'throw new TypeError(`expected string, got ${typeof v}`);',
  'export default defineConfig({ plugins: [react()] });',
  'const isEmpty = (s: string) => s.trim().length === 0;',
  'while (queue.length > 0) visit(queue.shift()!);',
  "expect(parse('3 + 4')).toEqual({ op: '+', a: 3, b: 4 });",
  "router.delete('/items/:id', requireAuth, removeItem);",
  'const { rows } = await pool.query(sql, [userId]);',
  'if (Number.isNaN(n)) return fallback;',
  'process.exitCode = failed > 0 ? 1 : 0;',
  'const key = `${user.id}:${day.toISOString()}`;',
  'const sleep = (ms) => new Promise((r) => setTimeout(r, ms));',
  "document.querySelector('#save')?.focus();",
  'export const MAX_RETRIES = Number(process.env.RETRIES ?? 3);',
  // Python
  'def area(width: float, height: float) -> float:',
  'with open(path, encoding="utf-8") as fh:',
  'squares = [n * n for n in range(10) if n % 2 == 0]',
  'from dataclasses import dataclass, field',
  'if __name__ == "__main__":',
  'raise ValueError(f"bad port: {port!r}")',
  'counts = Counter(word.lower() for word in words)',
  'return sorted(rows, key=lambda r: r["created_at"])',
  'logger.info("loaded %d records in %.2fs", n, dt)',
  'async def fetch_page(session, url: str) -> str:',
  'df = df.dropna(subset=["price"]).reset_index(drop=True)',
  'parser.add_argument("--limit", type=int, default=50)',
  'self.cache: dict[str, bytes] = {}',
  'total = sum(len(chunk) for chunk in chunks)',
  // Go
  'func (s *Server) Close() error { return s.ln.Close() }',
  'if err != nil { return nil, fmt.Errorf("open: %w", err) }',
  'ctx, cancel := context.WithTimeout(ctx, 2*time.Second)',
  'defer rows.Close()',
  'for i, v := range values { total += v * i }',
  'type Point struct { X, Y float64 }',
  'results := make(chan string, 16)',
  'http.HandleFunc("/ping", pingHandler)',
  // Rust
  'let mut buf = String::with_capacity(64);',
  'fn parse_port(s: &str) -> Result<u16, ParseIntError> {',
  "let names: Vec<&str> = line.split(',').collect();",
  'match cmd { Cmd::Quit => break, _ => continue }',
  '#[derive(Debug, Clone, PartialEq)]',
  'if let Some(hit) = cache.get(&key) { return hit.clone(); }',
  'let total: u64 = sizes.iter().sum();',
  // SQL
  'SELECT id, email FROM users WHERE active = true;',
  "UPDATE orders SET status = 'shipped' WHERE id = $1;",
  'CREATE INDEX idx_orders_user ON orders (user_id);',
  'DELETE FROM sessions WHERE expires_at < now();',
  'SELECT kind, COUNT(*) FROM events GROUP BY kind;',
  "INSERT INTO tags (name) VALUES ('urgent') RETURNING id;",
  'ALTER TABLE users ADD COLUMN last_login timestamptz;',
  // Shell / git
  'git rebase -i HEAD~3',
  'git log --oneline --graph -n 20',
  'git commit -am "fix off-by-one in pager"',
  'npm run build && npm test',
  'grep -rn "TODO" src/ | wc -l',
  'find . -name "*.log" -mtime +7 -delete',
  'docker compose up -d --build api',
  'curl -s localhost:8080/health | jq .status',
  'tar -czf backup.tgz data/ --exclude="*.tmp"',
  'export PATH="$HOME/.local/bin:$PATH"',
  'git switch -c feature/search-filters',
  'chmod +x scripts/deploy.sh && ./scripts/deploy.sh',
  'kubectl rollout restart deployment/web',
  // CSS
  '.card { display: grid; gap: 12px; padding: 16px; }',
  '@media (max-width: 600px) { .nav { display: none; } }',
  'button:hover { background: var(--accent); }',
  'transition: transform 150ms ease-out;',
  'grid-template-columns: repeat(3, 1fr);',
  ':root { --radius: 6px; --gap: 0.75rem; }',
];

// ---------------------------------------------------------------- lines from Claude's changes

/** Structural subset of `ReviewCard` / `EditInfo` that `linesFromChanges` reads. */
export interface ChangeLike {
  hunks?: { old: string; new: string }[];
  patch?: { lines: string[] }[];
  more?: ChangeLike[];
}

const PRINTABLE = /^[\x20-\x7e]+$/;
const COMMENT = /^(\/\/|#|\/\*|\*|--|<!--)/;

function usable(line: string): boolean {
  return (
    line.length >= CHANGE_MIN &&
    line.length <= CHANGE_MAX &&
    PRINTABLE.test(line) &&
    (line.match(/[A-Za-z]/g)?.length ?? 0) >= 4 &&
    !COMMENT.test(line)
  );
}

/** Split hook text into lines, dropping the partial last line before an `…` clip marker. */
function textLines(text: string): string[] {
  const lines = text.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '…') lines.splice(-2, 2);
  return lines;
}

/** Added lines of one edit, in file order (no recursion into `more`). */
function addedLines(edit: ChangeLike): string[] {
  if (edit.patch?.length) {
    return edit.patch.flatMap((h) => (h.lines ?? []).filter((l) => l.startsWith('+')).map((l) => l.slice(1)));
  }
  return (edit.hunks ?? []).flatMap((h) => {
    // `new` repeats the unchanged lines around the edit; only lines missing from `old` were added.
    const before = new Set(textLines(h.old ?? '').map((l) => l.trim()));
    return textLines(h.new ?? '').filter((l) => !before.has(l.trim()));
  });
}

/**
 * Typeable lines Claude added, oldest first (cards in queue order, each card's folded-in `more`
 * edits after it). Tabs become two spaces, ends are trimmed, and only printable-ASCII lines of
 * 16–64 chars with at least 4 letters that are not comments survive. A repeated line keeps its
 * newest position. Returns the newest `max`.
 */
export function linesFromChanges(cards: ChangeLike[], max = 20): string[] {
  if (max <= 0) return [];
  const all: string[] = [];
  for (const card of cards) {
    for (const edit of [card, ...(card.more ?? [])]) {
      for (const raw of addedLines(edit)) {
        const line = raw.replace(/\t/g, '  ').trim();
        if (usable(line)) all.push(line);
      }
    }
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (let k = all.length - 1; k >= 0 && out.length < max; k--) {
    if (seen.has(all[k])) continue;
    seen.add(all[k]);
    out.push(all[k]);
  }
  return out.reverse();
}

// ---------------------------------------------------------------- state

export interface LineStat {
  /** Active typing time on this line (pauses capped). */
  ms: number;
  errors: number;
  chars: number;
}

export interface Sprint {
  lines: string[];
  /** Index of the line being typed; `lines.length` once done. */
  i: number;
  typed: string;
  /** Every counted keystroke, backspaces included. */
  keys: number;
  errors: number;
  /** Total active typing time (pauses capped at PAUSE_CAP_MS). */
  activeMs: number;
  /** Time of the previous key on the current line; unset before its first key. */
  lastKeyAt?: number;
  perLine: LineStat[];
  lineMs: number;
  lineErrors: number;
  done: boolean;
  source: 'builtin' | 'changes';
}

/** mulberry32: a tiny seeded generator, so a seed always deals the same lines. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Partial Fisher–Yates: `n` distinct items of `xs` in random order. */
function sample(xs: string[], n: number, rand: () => number): string[] {
  const a = xs.slice();
  const k = Math.min(n, a.length);
  for (let j = 0; j < k; j++) {
    const r = j + Math.floor(rand() * (a.length - j));
    [a[j], a[r]] = [a[r], a[j]];
  }
  return a.slice(0, k);
}

/**
 * A new round of `n` distinct lines picked from `pool` (deterministic for a seed). Lines that are
 * not plain printable ASCII are skipped; a pool with fewer than `n` usable lines is topped up
 * from SNIPPETS.
 */
export function newSprint(seed: number, pool: string[], n = 5, source: Sprint['source'] = 'builtin'): Sprint {
  const rand = mulberry32(seed);
  const want = Math.max(1, Math.floor(n));
  const clean = [...new Set(pool.map((l) => l.trim()).filter((l) => PRINTABLE.test(l)))];
  const lines = sample(clean, want, rand);
  if (lines.length < want) {
    const have = new Set(lines);
    lines.push(...sample(SNIPPETS.filter((l) => !have.has(l)), want - lines.length, rand));
  }
  return { lines, i: 0, typed: '', keys: 0, errors: 0, activeMs: 0, perLine: [], lineMs: 0, lineErrors: 0, done: false, source };
}

// ---------------------------------------------------------------- typing

/** The line being typed ('' once done). */
export function currentLine(sp: Sprint): string {
  return sp.lines[sp.i] ?? '';
}

/** Count the gap since the previous key on this line, capped so a pause costs little. */
function tick(sp: Sprint, now: number): void {
  if (sp.lastKeyAt !== undefined) {
    const dt = Math.min(Math.max(0, now - sp.lastKeyAt), PAUSE_CAP_MS);
    sp.activeMs += dt;
    sp.lineMs += dt;
  }
  sp.lastKeyAt = now;
}

function finishLine(sp: Sprint): void {
  sp.perLine.push({ ms: sp.lineMs, errors: sp.lineErrors, chars: currentLine(sp).length });
  sp.i++;
  sp.typed = '';
  sp.lineMs = 0;
  sp.lineErrors = 0;
  sp.lastKeyAt = undefined;
  if (sp.i >= sp.lines.length) sp.done = true;
}

/**
 * Type `ch` (one key, or a chunk from a paste / keys that arrived together). Characters outside
 * printable ASCII (Enter, Tab, IME output) are ignored. A key is an error when the typed text is
 * then not a prefix of the line, so a mistake keeps counting until it is backspaced away. A line
 * completes the moment it is typed exactly; the rest of a chunk goes on to the next line.
 */
export function typeChar(sp: Sprint, ch: string, now: number): void {
  for (const c of ch) {
    if (sp.done) return;
    if (!PRINTABLE.test(c)) continue;
    const line = currentLine(sp);
    tick(sp, now);
    sp.keys++;
    if (sp.typed.length < line.length + OVERFLOW) sp.typed += c;
    if (!line.startsWith(sp.typed)) {
      sp.errors++;
      sp.lineErrors++;
    } else if (sp.typed === line) {
      finishLine(sp);
    }
  }
}

/** Delete the last typed character: a keystroke, never an error. Does nothing on an empty line. */
export function backspace(sp: Sprint, now: number): void {
  if (sp.done || !sp.typed) return;
  tick(sp, now);
  sp.keys++;
  sp.typed = sp.typed.slice(0, -1);
}

// ---------------------------------------------------------------- scoring

/** Words (5 chars) per minute over completed lines; 0 until a line has taken measurable time. */
export function wpm(sp: Sprint): number {
  let chars = 0;
  let ms = 0;
  for (const l of sp.perLine) {
    chars += l.chars;
    ms += l.ms;
  }
  return ms > 0 ? Math.round(chars / 5 / (ms / 60000)) : 0;
}

/** Share of keystrokes that were not errors (0..1); 1 before any key. */
export function accuracy(sp: Sprint): number {
  return sp.keys > 0 ? (sp.keys - sp.errors) / sp.keys : 1;
}

/** 1-based number of the line being typed (`of` once done). */
export function progress(sp: Sprint): { line: number; of: number } {
  return { line: Math.min(sp.i + 1, sp.lines.length), of: sp.lines.length };
}

/** Per position of the current line (or of `typed`, if longer): typed right, typed wrong, or not yet typed. */
export function charStates(sp: Sprint): Array<'ok' | 'bad' | 'todo'> {
  const line = currentLine(sp);
  const len = Math.max(line.length, sp.typed.length);
  const out: Array<'ok' | 'bad' | 'todo'> = [];
  for (let k = 0; k < len; k++) {
    if (k >= sp.typed.length) out.push('todo');
    else out.push(sp.typed[k] === line[k] ? 'ok' : 'bad');
  }
  return out;
}

export function result(sp: Sprint): { wpm: number; accuracy: number; ms: number; lines: number } {
  return { wpm: wpm(sp), accuracy: accuracy(sp), ms: sp.activeMs, lines: sp.perLine.length };
}

/** A new best: a finished, accurate round, faster than before (and not implausibly fast). */
export function isPersonalBest(prevBestWpm: number, sp: Sprint): boolean {
  if (!sp.done || accuracy(sp) < PB_MIN_ACCURACY) return false;
  const w = wpm(sp);
  return w > prevBestWpm && w <= PB_MAX_WPM;
}
