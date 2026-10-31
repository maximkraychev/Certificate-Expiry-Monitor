import { describe, expect, it } from 'vitest';
import { evaluate } from '../../src/core/notificationRules';
import type { NotifiedStatus, Status } from '../../src/core/status';

describe('evaluate', () => {
  const table: [last: NotifiedStatus | null, current: Status, trigger: boolean, newLast: NotifiedStatus | null][] = [
    // OK resets, never alerts
    [null, 'OK', false, null],
    ['WARNING', 'OK', false, null],
    ['EXPIRED', 'OK', false, null],
    // ERROR alerts every time and leaves the status alone
    [null, 'ERROR', true, null],
    ['CRITICAL', 'ERROR', true, 'CRITICAL'],
    // worse than last: alert and raise
    [null, 'WARNING', true, 'WARNING'],
    [null, 'EXPIRED', true, 'EXPIRED'],
    ['WARNING', 'CRITICAL', true, 'CRITICAL'],
    ['WARNING', 'EXPIRED', true, 'EXPIRED'],
    ['CRITICAL', 'EXPIRED', true, 'EXPIRED'],
    // same as last: nothing
    ['WARNING', 'WARNING', false, 'WARNING'],
    ['CRITICAL', 'CRITICAL', false, 'CRITICAL'],
    ['EXPIRED', 'EXPIRED', false, 'EXPIRED'],
    // better but not OK: lower silently
    ['EXPIRED', 'WARNING', false, 'WARNING'],
    ['CRITICAL', 'WARNING', false, 'WARNING'],
    ['EXPIRED', 'CRITICAL', false, 'CRITICAL'],
  ];

  it.each(table)('last %s, now %s → trigger %s, store %s', (last, current, trigger, newLastNotified) => {
    expect(evaluate(last, current)).toEqual({ trigger, newLastNotified });
  });
});
