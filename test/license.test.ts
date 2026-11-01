import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  activateLicense,
  validateLicense,
  deactivateLicense,
  loadLicense,
  saveLicense,
  clearLicense,
  currentPlan,
  needsCheck,
  maskKey,
  licensePath,
  type License,
} from '../src/license.js';
import { POLAR, licensingConfigured } from '../src/product.js';
import { browserCommand, safeHttpUrl } from '../src/open.js';
import { tempHome } from './helpers.js';

const ORG = '11111111-2222-3333-4444-555555555555';
const KEY = 'COWAIT-4F2A9C1E-7B3D-4E8F-9A6B-1C2D3E4F7XYZ';
const NOW = Date.parse('2026-11-01T00:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

const keyObj = (over: Record<string, unknown> = {}) => ({
  id: 'lk_1',
  organization_id: ORG,
  user_id: 'u_1',
  benefit_id: 'ben-pro',
  key: KEY,
  display_key: '****-7XYZ',
  status: 'granted',
  limit_activations: 3,
  usage: 0,
  limit_usage: null,
  validations: 0,
  last_validated_at: null,
  expires_at: null,
  ...over,
});

const activation = (over: Record<string, unknown> = {}) => ({
  id: 'act_1',
  license_key_id: 'lk_1',
  label: 'x',
  meta: {},
  created_at: '2026-11-01T00:00:00Z',
  modified_at: null,
  license_key: keyObj(over),
});

type Call = { url: string; endpoint: string; body: any; headers: Record<string, string> };
type Reply = { status: number; body?: unknown };

/** A stand-in for fetch: `handler` answers per endpoint; every request is recorded. */
function fakeFetch(handler: (endpoint: string, body: any) => Reply | Promise<Reply>) {
  const calls: Call[] = [];
  const fn = (async (input: any, init: any) => {
    const url = String(input);
    const endpoint = url.split('/').pop()!;
    const body = JSON.parse(init.body);
    calls.push({ url, endpoint, body, headers: init.headers });
    const r = await handler(endpoint, body);
    return new Response(r.status === 204 || r.body === undefined ? null : JSON.stringify(r.body), {
      status: r.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { fetch: fn, calls };
}

const stored = (over: Partial<License> = {}): License => ({
  key: KEY,
  display: '****-7XYZ',
  activationId: 'act_1',
  plan: 'pro',
  status: 'granted',
  label: 'box (linux)',
  activatedAt: NOW - 10 * DAY,
  checkedAt: NOW - 4 * DAY,
  expiresAt: null,
  benefitId: 'ben-pro',
  ...over,
});

let savedTeam: string[];
beforeEach(() => {
  tempHome();
  process.env.COWAIT_POLAR_ORG = ORG;
  delete process.env.COWAIT_LICENSE_API;
  savedTeam = POLAR.benefits.team;
  POLAR.benefits.team = ['ben-team'];
});
afterEach(() => {
  delete process.env.COWAIT_POLAR_ORG;
  delete process.env.COWAIT_LICENSE_API;
  POLAR.benefits.team = savedTeam;
});

describe('configuration', () => {
  it('does nothing until a Polar organization is set', async () => {
    delete process.env.COWAIT_POLAR_ORG;
    expect(licensingConfigured()).toBe(false);
    const f = fakeFetch(() => ({ status: 200, body: activation() }));
    expect(await activateLicense(KEY, { fetch: f.fetch, now: NOW })).toEqual({ ok: false, reason: 'not_configured' });
    expect(await validateLicense(stored(), { fetch: f.fetch, now: NOW })).toEqual({ ok: false, reason: 'not_configured' });
    expect(f.calls).toEqual([]);
    expect(loadLicense()).toBeNull();
  });

  it('can point at the Polar sandbox', async () => {
    process.env.COWAIT_LICENSE_API = 'sandbox';
    const f = fakeFetch(() => ({ status: 200, body: activation() }));
    await activateLicense(KEY, { fetch: f.fetch, now: NOW });
    expect(f.calls[0].url).toBe('https://sandbox-api.polar.sh/v1/customer-portal/license-keys/activate');
  });
});

describe('activateLicense', () => {
  it('activates a Pro key, sends a sensible request and saves the license', async () => {
    const f = fakeFetch(() => ({ status: 200, body: activation() }));
    const r = await activateLicense(`  ${KEY}\n`, { fetch: f.fetch, now: NOW });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.license).toMatchObject({
      key: KEY,
      display: '****-7XYZ',
      activationId: 'act_1',
      plan: 'pro',
      status: 'granted',
      activatedAt: NOW,
      checkedAt: NOW,
      expiresAt: null,
      benefitId: 'ben-pro',
    });
    expect(loadLicense()).toEqual(r.license);
    expect(currentPlan(loadLicense(), NOW)).toBe('pro');

    const c = f.calls[0];
    expect(c.url).toBe('https://api.polar.sh/v1/customer-portal/license-keys/activate');
    expect(c.body).toMatchObject({ key: KEY, organization_id: ORG, label: `${os.hostname()} (${process.platform})` });
    expect(c.headers['user-agent']).toMatch(/^cowait\/\d+\.\d+\.\d+$/);
    expect(c.headers['content-type']).toBe('application/json');
  });

  it('tells Team keys apart by benefit id, and keeps a custom label', async () => {
    const f = fakeFetch(() => ({ status: 200, body: activation({ benefit_id: 'ben-team', expires_at: '2027-11-01T00:00:00Z' }) }));
    const r = await activateLicense(KEY, { fetch: f.fetch, now: NOW, label: 'work laptop' });
    expect(r.ok && r.license.plan).toBe('team');
    expect(r.ok && r.license.expiresAt).toBe(Date.parse('2027-11-01T00:00:00Z'));
    expect(f.calls[0].body.label).toBe('work laptop');
  });

  it('falls back to validate for keys that do not support activations', async () => {
    const f = fakeFetch((ep) =>
      ep === 'activate'
        ? {
            status: 403,
            body: {
              error: 'NotPermitted',
              detail: 'This license key does not support activations. Use the /validate endpoint instead to check license validity.',
            },
          }
        : { status: 200, body: { ...keyObj({ limit_activations: null }), activation: null } },
    );
    const r = await activateLicense(KEY, { fetch: f.fetch, now: NOW });
    expect(r.ok).toBe(true);
    expect(f.calls.map((c) => c.endpoint)).toEqual(['activate', 'validate']);
    expect(f.calls[1].body).toEqual({ key: KEY, organization_id: ORG });
    expect(r.ok && r.license.activationId).toBeUndefined();
    expect(loadLicense()?.plan).toBe('pro');
  });

  it('reports a reached activation limit', async () => {
    const f = fakeFetch(() => ({ status: 403, body: { error: 'NotPermitted', detail: 'License key activation limit already reached' } }));
    const r = await activateLicense(KEY, { fetch: f.fetch, now: NOW });
    expect(r).toMatchObject({ ok: false, reason: 'limit' });
    expect(loadLicense()).toBeNull();
  });

  it('reports a key that is no longer active, or expired', async () => {
    let detail = 'License key is no longer active. This license key can not be activated.';
    const f = fakeFetch(() => ({ status: 403, body: { error: 'NotPermitted', detail } }));
    expect(await activateLicense(KEY, { fetch: f.fetch, now: NOW })).toMatchObject({ ok: false, reason: 'revoked' });
    detail = 'License key has expired.';
    expect(await activateLicense(KEY, { fetch: f.fetch, now: NOW })).toEqual({ ok: false, reason: 'revoked', detail: 'expired' });
    expect(loadLicense()).toBeNull();
  });

  it('calls unknown keys invalid', async () => {
    const f = fakeFetch(() => ({ status: 404, body: { error: 'ResourceNotFound', detail: 'Not found' } }));
    expect(await activateLicense(KEY, { fetch: f.fetch, now: NOW })).toMatchObject({ ok: false, reason: 'invalid' });
    const bad = fakeFetch(() => ({ status: 422, body: { detail: [{ loc: ['body', 'key'], msg: 'Field required', type: 'missing' }] } }));
    expect(await activateLicense(KEY, { fetch: bad.fetch, now: NOW })).toEqual({ ok: false, reason: 'invalid', detail: 'Field required' });
    expect(loadLicense()).toBeNull();
  });

  it('rejects an empty key without asking Polar', async () => {
    const f = fakeFetch(() => ({ status: 200, body: activation() }));
    expect(await activateLicense('   ', { fetch: f.fetch, now: NOW })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(f.calls).toEqual([]);
  });

  it('rejects a key that belongs to another organization', async () => {
    const f = fakeFetch(() => ({ status: 200, body: activation({ organization_id: 'someone-else' }) }));
    expect(await activateLicense(KEY, { fetch: f.fetch, now: NOW })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(loadLicense()).toBeNull();
  });

  it('turns network failures and timeouts into `network`, and 5xx into `server`', async () => {
    const down = fakeFetch(() => {
      throw new TypeError('fetch failed');
    });
    expect(await activateLicense(KEY, { fetch: down.fetch, now: NOW })).toEqual({ ok: false, reason: 'network', detail: 'fetch failed' });

    const hang = (async (_url: any, init: any) =>
      new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))) as typeof fetch;
    expect(await activateLicense(KEY, { fetch: hang, now: NOW, timeoutMs: 20 })).toEqual({ ok: false, reason: 'network', detail: 'timed out' });

    const broken = fakeFetch(() => ({ status: 502 }));
    expect(await activateLicense(KEY, { fetch: broken.fetch, now: NOW })).toEqual({ ok: false, reason: 'server', detail: 'HTTP 502' });
    expect(loadLicense()).toBeNull();
  });

  it('re-entering the active key re-checks it instead of using another activation', async () => {
    saveLicense(stored());
    const f = fakeFetch(() => ({ status: 200, body: { ...keyObj(), activation: { id: 'act_1' } } }));
    const r = await activateLicense(KEY, { fetch: f.fetch, now: NOW });
    expect(r.ok && r.license.activationId).toBe('act_1');
    expect(f.calls.map((c) => c.endpoint)).toEqual(['validate']);

    // If that activation was removed (say, in Polar's customer portal), activate afresh.
    const g = fakeFetch((ep) => (ep === 'validate' ? { status: 404, body: { detail: 'Not found' } } : { status: 200, body: activation({}) }));
    const again = await activateLicense(KEY, { fetch: g.fetch, now: NOW });
    expect(g.calls.map((c) => c.endpoint)).toEqual(['validate', 'activate']);
    expect(again.ok && again.license.status).toBe('granted');
  });
});

describe('validateLicense', () => {
  it('updates status, check time and expiry, sending the activation id', async () => {
    saveLicense(stored());
    const f = fakeFetch(() => ({ status: 200, body: { ...keyObj({ expires_at: '2026-12-01T00:00:00Z' }), activation: { id: 'act_1' } } }));
    const r = await validateLicense(loadLicense()!, { fetch: f.fetch, now: NOW });
    expect(r.ok).toBe(true);
    expect(f.calls[0].body).toEqual({ key: KEY, organization_id: ORG, activation_id: 'act_1' });
    const l = loadLicense()!;
    expect(l.checkedAt).toBe(NOW);
    expect(l.expiresAt).toBe(Date.parse('2026-12-01T00:00:00Z'));
    expect(needsCheck(l, NOW)).toBe(false);
  });

  it('keeps a revoked key on disk with its new status', async () => {
    saveLicense(stored());
    const f = fakeFetch(() => ({ status: 200, body: { ...keyObj({ status: 'revoked' }), activation: null } }));
    expect(await validateLicense(stored(), { fetch: f.fetch, now: NOW })).toMatchObject({ ok: false, reason: 'revoked' });
    expect(loadLicense()).toMatchObject({ status: 'revoked', checkedAt: NOW });
    expect(currentPlan(loadLicense(), NOW)).toBe('free');
  });

  it('handles Polar refusing the key (403) or no longer knowing it (404)', async () => {
    saveLicense(stored());
    const inactive = fakeFetch(() => ({ status: 403, body: { error: 'NotPermitted', detail: 'License key is no longer active.' } }));
    expect(await validateLicense(stored(), { fetch: inactive.fetch, now: NOW })).toMatchObject({ ok: false, reason: 'revoked' });
    expect(loadLicense()?.status).toBe('revoked');

    saveLicense(stored());
    const expired = fakeFetch(() => ({ status: 403, body: { error: 'NotPermitted', detail: 'License key has expired.' } }));
    expect(await validateLicense(stored(), { fetch: expired.fetch, now: NOW })).toEqual({ ok: false, reason: 'revoked', detail: 'expired' });
    expect(currentPlan(loadLicense(), NOW)).toBe('free');

    saveLicense(stored());
    const gone = fakeFetch(() => ({ status: 404, body: { error: 'ResourceNotFound', detail: 'Not found' } }));
    expect(await validateLicense(stored(), { fetch: gone.fetch, now: NOW })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(loadLicense()).toMatchObject({ key: KEY, status: 'revoked' });
  });

  it('leaves the file alone when Polar cannot be reached', async () => {
    const before = stored();
    saveLicense(before);
    const down = fakeFetch(() => {
      throw new Error('ECONNRESET');
    });
    expect(await validateLicense(before, { fetch: down.fetch, now: NOW })).toMatchObject({ ok: false, reason: 'network' });
    const broken = fakeFetch(() => ({ status: 500, body: { detail: 'oops' } }));
    expect(await validateLicense(before, { fetch: broken.fetch, now: NOW })).toEqual({ ok: false, reason: 'server', detail: 'oops' });
    expect(loadLicense()).toEqual(before);
  });
});

describe('deactivateLicense', () => {
  it('frees the activation and forgets the key', async () => {
    saveLicense(stored());
    const f = fakeFetch(() => ({ status: 204 }));
    expect(await deactivateLicense(stored(), { fetch: f.fetch, now: NOW })).toEqual({ ok: true });
    expect(f.calls[0].body).toEqual({ key: KEY, organization_id: ORG, activation_id: 'act_1' });
    expect(fs.existsSync(licensePath())).toBe(false);
  });

  it('treats an activation Polar no longer has as already gone', async () => {
    saveLicense(stored());
    const f = fakeFetch(() => ({ status: 404, body: { detail: 'Not found' } }));
    expect((await deactivateLicense(stored(), { fetch: f.fetch })).ok).toBe(true);
    expect(loadLicense()).toBeNull();
  });

  it('keeps the key when Polar fails, and needs no request without an activation', async () => {
    saveLicense(stored());
    const f = fakeFetch(() => ({ status: 500, body: { detail: 'oops' } }));
    expect(await deactivateLicense(stored(), { fetch: f.fetch })).toEqual({ ok: false, detail: 'oops' });
    expect(loadLicense()).not.toBeNull();

    const g = fakeFetch(() => ({ status: 204 }));
    expect((await deactivateLicense(stored({ activationId: undefined }), { fetch: g.fetch })).ok).toBe(true);
    expect(g.calls).toEqual([]);
    expect(loadLicense()).toBeNull();
  });
});

describe('plan rules', () => {
  it('currentPlan: free without a usable key, paid within the offline grace period', () => {
    expect(currentPlan(null, NOW)).toBe('free');
    expect(currentPlan(stored({ checkedAt: NOW }), NOW)).toBe('pro');
    expect(currentPlan(stored({ checkedAt: NOW, plan: 'team' }), NOW)).toBe('team');
    expect(currentPlan(stored({ checkedAt: NOW - 29 * DAY }), NOW)).toBe('pro');
    expect(currentPlan(stored({ checkedAt: NOW - 31 * DAY }), NOW)).toBe('free');
    expect(currentPlan(stored({ checkedAt: NOW, status: 'disabled' }), NOW)).toBe('free');
    expect(currentPlan(stored({ checkedAt: NOW, expiresAt: NOW + 1000 }), NOW)).toBe('pro');
    expect(currentPlan(stored({ checkedAt: NOW, expiresAt: NOW }), NOW)).toBe('free');
  });

  it('needsCheck: after 3 days, or when the clock went backwards', () => {
    expect(needsCheck(null, NOW)).toBe(false);
    expect(needsCheck(stored({ checkedAt: NOW - 2 * DAY }), NOW)).toBe(false);
    expect(needsCheck(stored({ checkedAt: NOW - 4 * DAY }), NOW)).toBe(true);
    expect(needsCheck(stored({ checkedAt: NOW + 2 * DAY }), NOW)).toBe(true);
  });
});

describe('license file', () => {
  it('loads a license.json written with a BOM (PowerShell 5, Notepad)', () => {
    const l = stored();
    fs.mkdirSync(path.dirname(licensePath()), { recursive: true });
    fs.writeFileSync(licensePath(), '\uFEFF' + JSON.stringify(l, null, 2));
    expect(loadLicense()).toEqual(l);
  });

  it('ignores a file that is not a license, and clears cleanly', () => {
    fs.mkdirSync(path.dirname(licensePath()), { recursive: true });
    fs.writeFileSync(licensePath(), JSON.stringify({ key: KEY, plan: 'gold', status: 'granted' }));
    expect(loadLicense()).toBeNull();
    fs.writeFileSync(licensePath(), '{ not json');
    expect(loadLicense()).toBeNull();
    clearLicense();
    clearLicense();
    expect(fs.existsSync(licensePath())).toBe(false);
  });

  it('maskKey shows only the ends', () => {
    expect(maskKey(KEY)).toBe('COWA…7XYZ');
    expect(maskKey(` ${KEY} `)).toBe('COWA…7XYZ');
    expect(maskKey('ABCDEF')).toBe('AB…EF');
    expect(maskKey('ABC')).toBe('…');
  });
});

describe('openUrl', () => {
  it('only opens http(s) URLs', () => {
    expect(safeHttpUrl('https://polar.sh/checkout?a=1&b=2')).toBe('https://polar.sh/checkout?a=1&b=2');
    for (const bad of ['javascript:alert(1)', 'file:///C:/Windows/System32/calc.exe', 'calc.exe', '', 'http://a"b.com/']) {
      expect(safeHttpUrl(bad)).toBeNull();
      expect(browserCommand(bad, 'win32')).toBeNull();
    }
  });

  it('never hands the URL to a shell', () => {
    const url = 'https://buy.polar.sh/x?a=1&b=2|whoami';
    const win = browserCommand(url, 'win32')!;
    expect(win.cmd).toMatch(/[\\/]System32[\\/]rundll32\.exe$/i);
    expect(win.args).toEqual(['url.dll,FileProtocolHandler', url]);
    expect(browserCommand(url, 'darwin')).toEqual({ cmd: '/usr/bin/open', args: [url] });
    expect(browserCommand(url, 'linux')).toEqual({ cmd: 'xdg-open', args: [url] });
  });
});
