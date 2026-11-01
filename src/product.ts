/**
 * Product constants for the paid plans. Payments and license keys go through Polar (polar.sh),
 * which acts as merchant of record: Pro and Team products carry a "License key" benefit, and
 * Cowait checks keys against Polar's public customer-portal endpoints (no secret in the client).
 *
 * Everything here stays empty until the owner sets up Polar; `licensingConfigured()` is then false
 * and the app simply runs as the free plan.
 */

export const POLAR = {
  api: 'https://api.polar.sh',
  /** Polar organization id (a UUID). */
  orgId: '',
  /** License-key benefit ids per plan. A key whose benefit is in `team` is a Team key; any other is Pro. */
  benefits: { pro: [] as string[], team: [] as string[] },
};

export const POLAR_SANDBOX_API = 'https://sandbox-api.polar.sh';

/** Polar checkout link URLs. */
export const CHECKOUT = { pro: '', team: '' };

/** Display only: the real prices live in Polar. */
export const PRICES = {
  currency: 'US$',
  pro: { monthly: 4, yearly: 36 },
  team: { perSeatMonthly: 8 },
};

export const SITE = 'https://jaspinxu.github.io/Cowait/';

/** Polar API base URL. `COWAIT_LICENSE_API` overrides it (a URL, or `sandbox` for Polar's sandbox). */
export function licenseApi(): string {
  const env = process.env.COWAIT_LICENSE_API?.trim();
  const base = !env ? POLAR.api : env === 'sandbox' ? POLAR_SANDBOX_API : env;
  return base.replace(/\/+$/, '');
}

/** Polar organization id. `COWAIT_POLAR_ORG` overrides it (sandbox orgs have their own id). */
export function polarOrgId(): string {
  return (process.env.COWAIT_POLAR_ORG?.trim() || POLAR.orgId).trim();
}

/** Can license keys be checked at all? False until the owner fills in the Polar organization. */
export function licensingConfigured(): boolean {
  return polarOrgId() !== '' && licenseApi() !== '';
}
