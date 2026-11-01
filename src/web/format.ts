import { CRITICAL_DAYS, WARNING_DAYS, type Status } from '../core/status';
import type { CheckResult } from '../db/repositories/checkResults';
import type { TargetWithLatestCheck } from '../db/repositories/targets';
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

/** Past this many days, the runway stops measuring: every certificate sits at the far end. */
const RUNWAY_MAX_DAYS = 90;
/** Where the runway's days fall, in percent of its width. The zones are sized by urgency, not by length of time. */
const RUNWAY_STOPS: readonly (readonly [days: number, percent: number])[] = [
  [0, 8],
  [CRITICAL_DAYS, 28],
  [WARNING_DAYS, 58],
  [RUNWAY_MAX_DAYS, 100],
];

/** The runway's colored zones and axis labels, built from the same stops as `runwayPosition`. */
export const runwayScale = {
  zones: [
    { status: 'EXPIRED', width: 8 },
    { status: 'CRITICAL', width: 20 },
    { status: 'WARNING', width: 30 },
    { status: 'OK', width: 42 },
  ] satisfies { status: Status; width: number }[],
  ticks: RUNWAY_STOPS.map(([days, position]) => ({
    label: days === RUNWAY_MAX_DAYS ? `${days}+ days` : String(days),
    position,
  })),
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

/** A certificate's place on the runway in percent, or null when its dates are unknown. All expired ones share a spot. */
export function runwayPosition(daysLeft: number | null): number | null {
  if (daysLeft === null) return null;
  if (daysLeft < 0) return RUNWAY_STOPS[0][1] / 2;
  const end = RUNWAY_STOPS.findIndex(([days]) => daysLeft <= days);
  if (end === -1) return 100;
  if (end === 0) return RUNWAY_STOPS[0][1];
  const [fromDays, fromPercent] = RUNWAY_STOPS[end - 1];
  const [toDays, toPercent] = RUNWAY_STOPS[end];
  return fromPercent + ((daysLeft - fromDays) / (toDays - fromDays)) * (toPercent - fromPercent);
}

/** `Expires in 12 days, on 12 Nov 2026.` The sentence at the top of a target's page and in runway tooltips. */
export function describeExpiry(check: Pick<CheckResult, 'daysLeft' | 'validTo'> | null): string {
  if (!check) return 'Waiting for the first check.';
  if (check.daysLeft === null) return 'The last check failed.';
  const phrase = expiryPhrase(check.daysLeft);
  return `${phrase[0].toUpperCase()}${phrase.slice(1)}, on ${formatDate(check.validTo)}.`;
}

/** The dashboard's headline and the line under it. Expects targets in `sortByUrgency` order. */
export function dashboardSummary(targets: TargetWithLatestCheck[]): { headline: string; detail: string | null } {
  const [first, ...others] = targets;
  if (!first) return { headline: 'Add your first host.', detail: null };

  const check = first.latestCheck;
  if (!check) return { headline: 'Waiting for the first check.', detail: null };
  if (check.status === 'OK') {
    return {
      headline: `Nothing expires in the next ${WARNING_DAYS} days.`,
      detail: `Next: ${formatHostPort(first)} on ${formatDate(check.validTo)}.`,
    };
  }

  const name = formatHostPort(first);
  const headline =
    check.status === 'ERROR' || check.daysLeft === null
      ? `${name} can't be checked.`
      : `${name} ${expiryPhrase(check.daysLeft)}.`;
  const more = others.filter((target) => target.latestCheck && target.latestCheck.status !== 'OK').length;
  if (more === 0) return { headline, detail: null };
  return { headline, detail: more === 1 ? '1 more needs attention.' : `${more} more need attention.` };
}

/** Helpers every view can call (installed as `app.locals`). */
export const viewHelpers = {
  describeExpiry,
  formatDateTime,
  formatDate,
  formatHostPort,
  runwayPosition,
  runwayScale,
  statusClass,
  untrustedLabel,
};

function expiryPhrase(daysLeft: number): string {
  if (daysLeft === -1) return 'expired within the last day';
  if (daysLeft < 0) return `expired ${-daysLeft} days ago`;
  if (daysLeft === 0) return 'expires within a day';
  return daysLeft === 1 ? 'expires in 1 day' : `expires in ${daysLeft} days`;
}

function formatWith(format: Intl.DateTimeFormat, iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : format.format(date);
}
