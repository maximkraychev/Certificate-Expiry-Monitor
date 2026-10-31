import type { Status } from '../core/status';
import type { CheckResult } from '../db/repositories/checkResults';
import { formatHostPort } from '../services/targets';

/** Every time is stored in UTC and shown in this zone. */
export const DISPLAY_TIME_ZONE = 'Europe/Sofia';

const dateTimeFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: DISPLAY_TIME_ZONE,
  dateStyle: 'medium',
  timeStyle: 'short',
});
const dateFormat = new Intl.DateTimeFormat('en-GB', { timeZone: DISPLAY_TIME_ZONE, dateStyle: 'medium' });

/** Short labels for the codes Node puts in `authorizationError`. Unknown codes are shown as they are. */
const UNTRUSTED_REASONS: Record<string, string> = {
  DEPTH_ZERO_SELF_SIGNED_CERT: 'self-signed',
  SELF_SIGNED_CERT_IN_CHAIN: 'self-signed root in chain',
  ERR_TLS_CERT_ALTNAME_INVALID: 'wrong host name',
  CERT_HAS_EXPIRED: 'expired',
  CERT_NOT_YET_VALID: 'not yet valid',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'unknown issuer',
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'unknown issuer',
};

/** `31 Oct 2026, 10:00` in Europe/Sofia, or `—` when there is no value. */
export function formatDateTime(iso: string | null): string {
  return formatWith(dateTimeFormat, iso);
}

/** `31 Oct 2026` in Europe/Sofia, or `—` when there is no value. */
export function formatDate(iso: string | null): string {
  return formatWith(dateFormat, iso);
}

/** The CSS class for a status badge, e.g. `status-warning`. */
export function statusClass(status: Status): string {
  return `status-${status.toLowerCase()}`;
}

/** `untrusted (self-signed)` when the chain or host name didn't verify (decision 3), otherwise null. */
export function untrustedLabel(check: Pick<CheckResult, 'authorized' | 'authorizationError'>): string | null {
  if (check.authorized !== false) return null;
  const code = check.authorizationError;
  return code ? `untrusted (${UNTRUSTED_REASONS[code] ?? code})` : 'untrusted';
}

/** Helpers every view can call (installed as `app.locals`). */
export const viewHelpers = { formatDateTime, formatDate, formatHostPort, statusClass, untrustedLabel };

function formatWith(format: Intl.DateTimeFormat, iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : format.format(date);
}
