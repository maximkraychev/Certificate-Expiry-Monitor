export type Status = 'OK' | 'WARNING' | 'CRITICAL' | 'EXPIRED' | 'ERROR';

/** The statuses that come from certificate dates. ERROR (connect/parse failure) has no place in the severity order. */
export type DateStatus = Exclude<Status, 'ERROR'>;

/** The values `targets.last_notified_status` can hold besides NULL (decision 6 never stores OK or ERROR). */
export type NotifiedStatus = Exclude<DateStatus, 'OK'>;

export const STATUSES: readonly Status[] = ['OK', 'WARNING', 'CRITICAL', 'EXPIRED', 'ERROR'];

/** At or below this many days left, a certificate is WARNING. */
export const WARNING_DAYS = 30;
/** At or below this many days left, a certificate is CRITICAL (day 0 included, decision 1). */
export const CRITICAL_DAYS = 7;

export const MS_PER_DAY = 86_400_000;

/** Severity order: OK < WARNING < CRITICAL < EXPIRED. */
export const SEVERITY: Readonly<Record<DateStatus, number>> = {
  OK: 0,
  WARNING: 1,
  CRITICAL: 2,
  EXPIRED: 3,
};

/** Whole days until `validTo`, rounded down (decision 1). Negative once the certificate has expired. */
export function calculateDaysLeft(validTo: Date, now: Date): number {
  const diff = validTo.getTime() - now.getTime();
  if (!Number.isFinite(diff)) {
    throw new RangeError('calculateDaysLeft: validTo and now must be valid dates');
  }
  return Math.floor(diff / MS_PER_DAY);
}

export function calculateStatus(daysLeft: number): DateStatus {
  if (!Number.isFinite(daysLeft)) {
    throw new RangeError(`calculateStatus: daysLeft must be a finite number, got ${daysLeft}`);
  }
  if (daysLeft < 0) return 'EXPIRED';
  if (daysLeft <= CRITICAL_DAYS) return 'CRITICAL';
  if (daysLeft <= WARNING_DAYS) return 'WARNING';
  return 'OK';
}
