/**
 * Paid-plan license keys, issued and checked by Polar (see product.ts).
 *
 * - `activateLicense` registers this machine as one activation of a key (or, for keys without an
 *   activation limit, just validates it) and stores the result in <data>/license.json.
 * - `validateLicense` re-checks a stored key now and then (`needsCheck`); `currentPlan` decides
 *   offline, with a 30-day grace period since the last successful check.
 * - None of the network functions throw: every failure comes back as a `reason`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dataDir, packageRoot } from './paths.js';
import { parseJson, readJson, writeJsonAtomic } from './fsutil.js';
import { POLAR, licenseApi, licensingConfigured, polarOrgId } from './product.js';

export type Plan = 'free' | 'pro' | 'team';
export type LicenseStatus = 'granted' | 'revoked' | 'disabled';

export interface License {
  key: string;
  /** Polar's masked form of the key, for display. */
  display: string;
  /** Polar activation id; absent for keys without an activation limit. */
  activationId?: string;
  plan: Plan;
  status: LicenseStatus;
  label: string;
  activatedAt: number;
  /** Last time Polar answered about this key (ms). */
  checkedAt: number;
  expiresAt: number | null;
  benefitId?: string;
}

export type FailReason = 'not_configured' | 'invalid' | 'limit' | 'revoked' | 'network' | 'server';
export type Result = { ok: true; license: License } | { ok: false; reason: FailReason; detail?: string };

export interface NetOptions {
  fetch?: typeof fetch;
  now?: number;
  /** Request timeout; 8 s by default. */
  timeoutMs?: number;
}

const DAY = 24 * 60 * 60 * 1000;
/** Without a successful check for this long, paid features switch off until the next check. */
export const OFFLINE_GRACE_MS = 30 * DAY;
/** Re-check a stored key once it is this old. */
export const CHECK_EVERY_MS = 3 * DAY;
const TIMEOUT_MS = 8000;
const STATUSES: LicenseStatus[] = ['granted', 'revoked', 'disabled'];
const PLANS: Plan[] = ['free', 'pro', 'team'];

export function licensePath(): string {
  return path.join(dataDir(), 'license.json');
}

// ---------- local file ----------

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

/** The stored license, or null if there is none or the file is not one we understand. */
export function loadLicense(): License | null {
  const raw = readJson<any>(licensePath(), null);
  if (!raw || typeof raw !== 'object') return null;
  const key = str(raw.key);
  if (!key || !PLANS.includes(raw.plan) || !STATUSES.includes(raw.status)) return null;
  const lic: License = {
    key,
    display: str(raw.display) ?? maskKey(key),
    plan: raw.plan,
    status: raw.status,
    label: typeof raw.label === 'string' ? raw.label : '',
    activatedAt: num(raw.activatedAt) ?? 0,
    checkedAt: num(raw.checkedAt) ?? 0,
    expiresAt: num(raw.expiresAt) ?? null,
  };
  if (str(raw.activationId)) lic.activationId = raw.activationId;
  if (str(raw.benefitId)) lic.benefitId = raw.benefitId;
  return lic;
}

export function saveLicense(l: License): void {
  const file = licensePath();
  writeJsonAtomic(file, l, true);
  // The key is a credential: keep it private to this user where the OS supports it.
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      /* ignore */
    }
  }
}

export function clearLicense(): void {
  try {
    fs.rmSync(licensePath(), { force: true });
  } catch {
    /* ignore */
  }
}

// ---------- plan logic (offline) ----------

/** The plan in effect right now, decided without the network. */
export function currentPlan(lic: License | null, now: number): Plan {
  if (!lic || lic.status !== 'granted') return 'free';
  if (lic.expiresAt !== null && now >= lic.expiresAt) return 'free';
  if (now - lic.checkedAt > OFFLINE_GRACE_MS) return 'free';
  return lic.plan;
}

/** Time to ask Polar again? Also true when the last check claims to be in the future (clock changed). */
export function needsCheck(lic: License | null, now: number): boolean {
  if (!lic) return false;
  return now - lic.checkedAt > CHECK_EVERY_MS || lic.checkedAt > now + DAY;
}

/** "ABCD…WXYZ": enough to recognise a key without showing it. */
export function maskKey(key: string): string {
  const k = key.trim();
  if (k.length <= 8) return k.length <= 4 ? '…' : `${k.slice(0, 2)}…${k.slice(-2)}`;
  return `${k.slice(0, 4)}…${k.slice(-4)}`;
}

// ---------- network ----------

let ua: string | undefined;
function userAgent(): string {
  if (ua === undefined) {
    try {
      const v = parseJson<{ version?: unknown }>(fs.readFileSync(path.join(packageRoot(), 'package.json'), 'utf8')).version;
      ua = typeof v === 'string' && v ? `cowait/${v}` : 'cowait';
    } catch {
      ua = 'cowait';
    }
  }
  return ua;
}

type Reply = { status: number; body: any } | { error: string };

/** POST JSON to a Polar license-key endpoint. Never throws. */
async function post(endpoint: string, payload: unknown, opts: NetOptions): Promise<Reply> {
  const doFetch = opts.fetch ?? globalThis.fetch;
  if (typeof doFetch !== 'function') return { error: 'fetch is not available' };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? TIMEOUT_MS);
  try {
    const res = await doFetch(`${licenseApi()}/v1/customer-portal/license-keys/${endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': userAgent() },
      body: JSON.stringify(payload),
      signal: ctl.signal,
    });
    const text = await res.text();
    let body: any = null;
    try {
      body = text ? parseJson(text) : null;
    } catch {
      body = text;
    }
    return { status: res.status, body };
  } catch (e: any) {
    return { error: ctl.signal.aborted ? 'timed out' : String(e?.message ?? e) };
  } finally {
    clearTimeout(timer);
  }
}

/** Polar errors look like `{ error, detail: "..." }`, or `{ detail: [{ msg }] }` for validation errors. */
function detailOf(body: any): string {
  const d = body && typeof body === 'object' ? body.detail : body;
  if (typeof d === 'string') return d.slice(0, 300);
  if (Array.isArray(d)) return d.map((x) => (x && typeof x === 'object' ? String(x.msg ?? '') : String(x))).filter(Boolean).join('; ').slice(0, 300);
  return '';
}

function toMs(v: unknown): number | null {
  if (typeof v !== 'string' || !v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

function planFor(benefitId: string | undefined): Plan {
  return benefitId && POLAR.benefits.team.includes(benefitId) ? 'team' : 'pro';
}

interface KeyInfo {
  display: string;
  status: LicenseStatus;
  expiresAt: number | null;
  benefitId?: string;
  plan: Plan;
}

/** Read the license-key object Polar returns; null if it is not one, or belongs to another organization. */
function readKey(lk: any, key: string): KeyInfo | null {
  if (!lk || typeof lk !== 'object' || lk.organization_id !== polarOrgId()) return null;
  const benefitId = str(lk.benefit_id);
  return {
    display: str(lk.display_key) ?? maskKey(key),
    status: STATUSES.includes(lk.status) ? lk.status : 'disabled',
    expiresAt: toMs(lk.expires_at),
    benefitId,
    plan: planFor(benefitId),
  };
}

/** Why a key Polar knows about cannot be used, or null if it can. */
function unusable(info: KeyInfo, now: number): Result | null {
  if (info.status !== 'granted') return { ok: false, reason: 'revoked', detail: info.status };
  if (info.expiresAt !== null && now >= info.expiresAt) return { ok: false, reason: 'revoked', detail: 'expired' };
  return null;
}

const unreachable = (r: { error: string }): Result => ({ ok: false, reason: 'network', detail: r.error });
const serverError = (status: number, body: any): Result => ({ ok: false, reason: 'server', detail: detailOf(body) || `HTTP ${status}` });
const wrongOrg: Result = { ok: false, reason: 'invalid', detail: 'key belongs to another organization' };

function defaultLabel(): string {
  let host = 'computer';
  try {
    host = os.hostname() || host;
  } catch {
    /* ignore */
  }
  return `${host} (${process.platform})`;
}

/**
 * Activate `key` on this machine and store it. Re-entering the key that is already active here
 * re-checks that activation instead of using up another one.
 */
export async function activateLicense(key: string, opts: NetOptions & { label?: string } = {}): Promise<Result> {
  try {
    if (!licensingConfigured()) return { ok: false, reason: 'not_configured' };
    const k = typeof key === 'string' ? key.trim() : '';
    if (!k) return { ok: false, reason: 'invalid', detail: 'empty key' };
    if (k.length > 256 || /\s/.test(k)) return { ok: false, reason: 'invalid', detail: 'not a license key' };
    const now = opts.now ?? Date.now();

    const prev = loadLicense();
    if (prev && prev.key === k && prev.activationId) {
      const r = await validateLicense(prev, opts);
      // Only a vanished activation (removed in Polar's portal, say) is worth activating afresh.
      if (r.ok || r.reason !== 'invalid') return r;
    }

    const label = (opts.label ?? defaultLabel()).slice(0, 200);
    const org = polarOrgId();
    const res = await post('activate', { key: k, organization_id: org, label, meta: { platform: process.platform } }, opts);
    if ('error' in res) return unreachable(res);

    if (res.status === 200 || res.status === 201) {
      const info = readKey(res.body?.license_key, k);
      if (!info) return wrongOrg;
      const bad = unusable(info, now);
      if (bad) return bad;
      const activationId = str(res.body?.id);
      return store({ key: k, ...info, ...(activationId ? { activationId } : {}), label, activatedAt: now, checkedAt: now });
    }
    if (res.status === 403) {
      const detail = detailOf(res.body);
      // Keys without an activation limit cannot be activated; they are only ever validated.
      if (/support/i.test(detail) && /activation/i.test(detail)) return await validateOnly(k, label, now, opts);
      if (/limit/i.test(detail)) return { ok: false, reason: 'limit', detail };
      return { ok: false, reason: 'revoked', detail: /expire/i.test(detail) ? 'expired' : detail || undefined };
    }
    if (res.status === 404 || res.status === 422) return { ok: false, reason: 'invalid', detail: detailOf(res.body) || undefined };
    return serverError(res.status, res.body);
  } catch (e: any) {
    return { ok: false, reason: 'server', detail: String(e?.message ?? e) };
  }
}

/** Accept a key that has no activation limit after validating it (no activation id is stored). */
async function validateOnly(key: string, label: string, now: number, opts: NetOptions): Promise<Result> {
  const res = await post('validate', { key, organization_id: polarOrgId() }, opts);
  if ('error' in res) return unreachable(res);
  if (res.status === 200) {
    const info = readKey(res.body, key);
    if (!info) return wrongOrg;
    return unusable(info, now) ?? store({ key, ...info, label, activatedAt: now, checkedAt: now });
  }
  if (res.status === 403) {
    const detail = detailOf(res.body);
    return { ok: false, reason: 'revoked', detail: /expire/i.test(detail) ? 'expired' : detail || undefined };
  }
  if (res.status === 404 || res.status === 422) return { ok: false, reason: 'invalid', detail: detailOf(res.body) || undefined };
  return serverError(res.status, res.body);
}

function store(l: License): Result {
  saveLicense(l);
  return { ok: true, license: l };
}

/**
 * Ask Polar whether a stored key (and this machine's activation) is still good, and save what it says.
 * A key Polar no longer accepts stays on disk with its new status, so the UI can say why Pro ended;
 * network and server errors leave the file untouched (the offline grace period keeps running).
 */
export async function validateLicense(lic: License, opts: NetOptions = {}): Promise<Result> {
  try {
    if (!licensingConfigured()) return { ok: false, reason: 'not_configured' };
    const now = opts.now ?? Date.now();
    const payload: Record<string, string> = { key: lic.key, organization_id: polarOrgId() };
    if (lic.activationId) payload.activation_id = lic.activationId;
    const res = await post('validate', payload, opts);
    if ('error' in res) return unreachable(res);

    if (res.status === 200) {
      const info = readKey(res.body, lic.key);
      if (!info) {
        saveLicense({ ...lic, status: 'revoked', checkedAt: now });
        return wrongOrg;
      }
      const next: License = { ...lic, ...info, checkedAt: now };
      if (!info.benefitId) delete next.benefitId;
      saveLicense(next);
      return unusable(info, now) ?? { ok: true, license: next };
    }
    if (res.status === 403) {
      // "no longer active" or "has expired": Polar says no without sending the key's new state.
      const detail = detailOf(res.body);
      if (/expire/i.test(detail)) {
        saveLicense({ ...lic, expiresAt: lic.expiresAt !== null && lic.expiresAt <= now ? lic.expiresAt : now, checkedAt: now });
        return { ok: false, reason: 'revoked', detail: 'expired' };
      }
      saveLicense({ ...lic, status: 'revoked', checkedAt: now });
      return { ok: false, reason: 'revoked', detail: detail || undefined };
    }
    if (res.status === 404) {
      // The key, or this machine's activation, is gone.
      saveLicense({ ...lic, status: 'revoked', checkedAt: now });
      return { ok: false, reason: 'invalid', detail: detailOf(res.body) || undefined };
    }
    if (res.status === 422) return { ok: false, reason: 'invalid', detail: detailOf(res.body) || undefined };
    return serverError(res.status, res.body);
  } catch (e: any) {
    return { ok: false, reason: 'server', detail: String(e?.message ?? e) };
  }
}

/** Free this machine's activation slot and forget the key locally. */
export async function deactivateLicense(lic: License, opts: NetOptions = {}): Promise<{ ok: boolean; detail?: string }> {
  try {
    if (!lic.activationId) {
      // Nothing was registered with Polar for this machine.
      clearLicense();
      return { ok: true };
    }
    if (!licensingConfigured()) return { ok: false, detail: 'not_configured' };
    const res = await post('deactivate', { key: lic.key, organization_id: polarOrgId(), activation_id: lic.activationId }, opts);
    if ('error' in res) return { ok: false, detail: res.error };
    if ((res.status >= 200 && res.status < 300) || res.status === 404) {
      clearLicense();
      return { ok: true };
    }
    return { ok: false, detail: detailOf(res.body) || `HTTP ${res.status}` };
  } catch (e: any) {
    return { ok: false, detail: String(e?.message ?? e) };
  }
}
