/**
 * `cowait demo`: a fake Claude session that writes the same events the real hook
 * writes, so you can try every mode without Claude Code. It also plays the hook's
 * part for review notes (picks them up and marks them delivered).
 */
import { appendLine } from './fsutil.js';
import { paths } from './paths.js';
import { claimNotes } from './feedback.js';
import type { EditInfo, IEvent } from './events.js';

const CWD = process.platform === 'win32' ? 'G:\\code\\shop-api' : '/home/dev/shop-api';
const f = (p: string) => (process.platform === 'win32' ? `${CWD}\\${p.replace(/\//g, '\\')}` : `${CWD}/${p}`);

const EDITS: EditInfo[] = [
  {
    file: f('src/routes/orders.ts'),
    kind: 'edit',
    hunks: [
      {
        old: "router.post('/orders', async (req, res) => {\n  const order = await db.orders.create(req.body);\n  res.json(order);\n});",
        new: "router.post('/orders', async (req, res) => {\n  const parsed = OrderInput.safeParse(req.body);\n  if (!parsed.success) {\n    return res.status(400).json({ error: parsed.error.flatten() });\n  }\n  const order = await db.orders.create(parsed.data);\n  res.status(201).json(order);\n});",
      },
    ],
  },
  {
    file: f('src/services/payment.ts'),
    kind: 'edit',
    hunks: [
      {
        old: 'export async function charge(orderId: string, amount: number) {\n  return stripe.paymentIntents.create({ amount, currency: "sgd" });\n}',
        new: 'export async function charge(orderId: string, amount: number) {\n  // Retries must not double-charge: reuse one key per order.\n  return stripe.paymentIntents.create(\n    { amount, currency: "sgd", metadata: { orderId } },\n    { idempotencyKey: `charge-${orderId}` },\n  );\n}',
      },
    ],
  },
  {
    file: f('tests/orders.test.ts'),
    kind: 'write',
    created: true,
    hunks: [
      {
        old: '',
        new: "import { describe, it, expect } from 'vitest';\nimport request from 'supertest';\nimport { app } from '../src/app';\n\ndescribe('POST /orders', () => {\n  it('rejects an empty body', async () => {\n    const res = await request(app).post('/orders').send({});\n    expect(res.status).toBe(400);\n  });\n\n  it('creates an order', async () => {\n    const res = await request(app).post('/orders').send({ sku: 'A1', qty: 2 });\n    expect(res.status).toBe(201);\n  });\n});",
      },
    ],
  },
  {
    file: f('src/lib/cache.ts'),
    kind: 'edit',
    hunks: [
      {
        old: 'await redis.set(key, JSON.stringify(value), "EX", ttl);',
        new: '// Spread expiries so hot keys do not all expire at once (cache avalanche).\nconst jitter = Math.floor(Math.random() * ttl * 0.1);\nawait redis.set(key, JSON.stringify(value), "EX", ttl + jitter);',
      },
    ],
  },
  {
    file: f('src/db/pool.ts'),
    kind: 'edit',
    hunks: [
      {
        old: 'export const pool = new Pool({\n  connectionString: process.env.DATABASE_URL,\n  max: 50,\n});',
        new: 'export const pool = new Pool({\n  connectionString: process.env.DATABASE_URL,\n  max: 10,\n  idleTimeoutMillis: 30_000,\n  connectionTimeoutMillis: 5_000,\n});',
      },
    ],
  },
  {
    file: f('src/utils/retry.ts'),
    kind: 'edit',
    hunks: [
      {
        old: 'for (let i = 0; i < tries; i++) {\n  try { return await fn(); } catch (e) { last = e; }\n}',
        new: 'for (let i = 0; i < tries; i++) {\n  try {\n    return await fn();\n  } catch (e) {\n    last = e;\n    await sleep(2 ** i * 100 + Math.random() * 100); // exponential backoff + jitter\n  }\n}',
      },
    ],
  },
];

type Step = [delayMs: number, make: (t: number) => IEvent | null];

export function startDemo(speed = 1): () => void {
  const sid = 'demo';
  let turn = 0;
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;

  const write = (ev: IEvent) => appendLine(paths.events(), JSON.stringify(ev));
  const tool = (t: number, name: string, extra: Partial<Extract<IEvent, { k: 'tool' }>> = {}): IEvent => ({ t, k: 'tool', sid, cwd: CWD, tool: name, ...extra });

  const turnSteps = (n: number): Step[] => {
    const a = EDITS[(n * 2) % EDITS.length];
    const b = EDITS[(n * 2 + 1) % EDITS.length];
    const pass = n % 4 !== 2;
    return [
      [0, (t) => ({ t, k: 'prompt', sid, cwd: CWD })],
      [2500, (t) => tool(t, 'Read')],
      [3000, (t) => tool(t, 'Edit', { edit: a })],
      [3000, (t) => tool(t, 'Grep')],
      [3500, (t) => tool(t, a.kind === 'write' ? 'Write' : 'Edit', { edit: b })],
      [3500, (t) => tool(t, 'Bash', { bash: { cmd: 'npm test', test: true, result: pass ? 'pass' : 'fail' } })],
      [3000, (t) => ({ t, k: 'stop', sid, cwd: CWD })],
      [9000, () => null],
    ];
  };

  let steps: Step[] = turnSteps(0);
  let i = 0;
  const next = () => {
    if (stopped) return;
    if (i >= steps.length) {
      turn++;
      steps = turnSteps(turn);
      i = 0;
    }
    const [delay, make] = steps[i++];
    timer = setTimeout(() => {
      const t = Date.now();
      const ev = make(t);
      if (ev) {
        write(ev);
        // Play the hook's part: hand waiting review notes to "Claude".
        if (ev.k === 'tool' || ev.k === 'prompt') {
          const notes = claimNotes();
          if (notes.length) write({ t, k: 'delivered', sid, ids: notes.map((x) => x.id) });
        }
      }
      next();
    }, delay * speed);
  };
  next();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
