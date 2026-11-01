/**
 * Which plan is active, and what it unlocks. While paid plans are not open yet (no Polar
 * organization configured), every Pro feature is unlocked for everyone.
 */
import { currentPlan, loadLicense, needsCheck, validateLicense, type Plan } from './license.js';
import { licensingConfigured } from './product.js';

export type { Plan };

export function activePlan(now = Date.now()): Plan {
  return currentPlan(loadLicense(), now);
}

/** Pro features are open on Pro/Team, and to everyone until paid plans launch. */
export function proUnlocked(plan: Plan): boolean {
  return plan !== 'free' || !licensingConfigured();
}

/** Re-check the license with the server every few days, in the background. Never throws. */
export async function refreshLicense(now = Date.now()): Promise<void> {
  const lic = loadLicense();
  if (!lic || !licensingConfigured() || !needsCheck(lic, now)) return;
  await validateLicense(lic).catch(() => undefined);
}
