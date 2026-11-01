import { describe, it, expect } from 'vitest';
import { installKind, isNewer, latestVersion, updateCommand, REGISTRY_LATEST } from '../src/update.js';

const reply = (body: unknown, ok = true) => async () => ({ ok, json: async () => body });

describe('installKind', () => {
  it('tells binary, npm and clone installs apart', () => {
    expect(installKind('/any/where', true)).toBe('binary');
    expect(installKind('/usr/local/lib/node_modules/cowait', false)).toBe('npm');
    expect(installKind('C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\cowait', false)).toBe('npm');
    expect(installKind('G:\\Cowait', false)).toBe('clone');
    expect(installKind('/home/me/src/cowait', false)).toBe('clone');
    expect(installKind('/home/me/node_modules_backup/cowait', false)).toBe('clone');
  });

  it('is a clone when running these tests from a checkout', () => {
    expect(installKind()).toBe('clone');
  });
});

describe('isNewer', () => {
  it('compares versions the semver way', () => {
    expect(isNewer('0.3.0', '0.2.0')).toBe(true);
    expect(isNewer('0.2.10', '0.2.9')).toBe(true);
    expect(isNewer('1.0.0', '0.99.99')).toBe(true);
    expect(isNewer('0.2.0', '0.2.0')).toBe(false);
    expect(isNewer('0.2.0', '0.3.0')).toBe(false);
    expect(isNewer('v0.3.0', '0.2.0')).toBe(true);
  });

  it('orders pre-releases before their release', () => {
    expect(isNewer('1.0.0', '1.0.0-beta.2')).toBe(true);
    expect(isNewer('1.0.0-beta.2', '1.0.0')).toBe(false);
    expect(isNewer('1.0.0-beta.10', '1.0.0-beta.2')).toBe(true);
    expect(isNewer('1.0.0-beta', '1.0.0-alpha.5')).toBe(true);
    expect(isNewer('1.0.0-alpha.1', '1.0.0-alpha')).toBe(true);
    expect(isNewer('1.0.0-alpha', '1.0.0-1')).toBe(true); // alphanumeric ids sort after numeric ones
    expect(isNewer('1.0.0+build.5', '1.0.0')).toBe(false); // build metadata does not count
  });

  it('says no to anything that is not a version', () => {
    expect(isNewer('latest', '0.2.0')).toBe(false);
    expect(isNewer('0.3', '0.2.0')).toBe(false);
    expect(isNewer('0.3.0', '')).toBe(false);
  });
});

describe('latestVersion', () => {
  it('asks the npm registry and returns the version', async () => {
    let asked = '';
    let signal: AbortSignal | undefined;
    const v = await latestVersion({
      fetch: async (url, init) => {
        asked = url;
        signal = init?.signal;
        return { ok: true, json: async () => ({ name: 'cowait', version: '0.3.1' }) };
      },
    });
    expect(v).toBe('0.3.1');
    expect(asked).toBe(REGISTRY_LATEST);
    expect(asked).toBe('https://registry.npmjs.org/cowait/latest');
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it('returns null instead of throwing', async () => {
    expect(await latestVersion({ fetch: reply({ error: 'Not found' }, false) })).toBeNull();
    expect(await latestVersion({ fetch: reply({ version: 'not-a-version' }) })).toBeNull();
    expect(await latestVersion({ fetch: reply(null) })).toBeNull();
    expect(
      await latestVersion({
        fetch: async () => {
          throw new Error('ENOTFOUND');
        },
      }),
    ).toBeNull();
    expect(await latestVersion({ fetch: async () => ({ ok: true, json: async () => JSON.parse('{oops') }) })).toBeNull();
  });

  it('gives up after the timeout, even if fetch ignores the abort signal', async () => {
    const t0 = Date.now();
    const v = await latestVersion({ fetch: () => new Promise(() => undefined), timeoutMs: 50 });
    expect(v).toBeNull();
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('aborts a real request on timeout', async () => {
    let aborted = false;
    const v = await latestVersion({
      timeoutMs: 30,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            aborted = true;
            reject(new Error('aborted'));
          });
        }),
    });
    expect(v).toBeNull();
    expect(aborted).toBe(true);
  });
});

describe('updateCommand', () => {
  it('gives the exact command for each kind of install', () => {
    expect(updateCommand('npm', 'en')).toBe('npm i -g cowait@latest');
    expect(updateCommand('clone', 'zh', { root: 'G:\\Cowait' })).toBe('git -C "G:\\Cowait" pull --ff-only');
    expect(updateCommand('binary', 'en', { platform: 'win32' })).toBe('irm https://github.com/JaspinXu/Cowait/releases/latest/download/install.ps1 | iex');
    expect(updateCommand('binary', 'en', { platform: 'linux' })).toBe('curl -fsSL https://github.com/JaspinXu/Cowait/releases/latest/download/install.sh | sh');
    expect(updateCommand('binary', 'zh', { platform: 'darwin' })).toBe(updateCommand('binary', 'en', { platform: 'linux' }));
  });
});
