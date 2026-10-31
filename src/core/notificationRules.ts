import { SEVERITY, type NotifiedStatus, type Status } from './status';

export interface NotificationDecision {
  /** Include the target in this run's digest. */
  trigger: boolean;
  /** What `last_notified_status` should become. When `trigger` is true, write it only after a send succeeds (decision 7). */
  newLastNotified: NotifiedStatus | null;
}

/** Decision 6. A NULL `lastNotified` counts as OK. */
export function evaluate(lastNotified: NotifiedStatus | null, current: Status): NotificationDecision {
  if (current === 'OK') {
    return { trigger: false, newLastNotified: null };
  }
  if (current === 'ERROR') {
    return { trigger: true, newLastNotified: lastNotified };
  }

  const last = SEVERITY[lastNotified ?? 'OK'];
  if (SEVERITY[current] > last) {
    return { trigger: true, newLastNotified: current };
  }
  if (SEVERITY[current] === last) {
    return { trigger: false, newLastNotified: lastNotified };
  }
  // Better than last but not OK, e.g. renewed with a short lifetime: lower it so a later escalation alerts again.
  return { trigger: false, newLastNotified: current };
}
