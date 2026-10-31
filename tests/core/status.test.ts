import { describe, expect, it } from 'vitest';
import {
  CRITICAL_DAYS,
  MS_PER_DAY,
  SEVERITY,
  WARNING_DAYS,
  calculateDaysLeft,
  calculateStatus,
} from '../../src/core/status';

const now = new Date('2026-10-31T12:00:00.000Z');
const plus = (ms: number) => new Date(now.getTime() + ms);

describe('calculateStatus', () => {
  it.each([
    [31, 'OK'],
    [30, 'WARNING'],
    [8, 'WARNING'],
    [7, 'CRITICAL'],
    [0, 'CRITICAL'],
    [-1, 'EXPIRED'],
  ] as const)('%i days left is %s', (daysLeft, status) => {
    expect(calculateStatus(daysLeft)).toBe(status);
  });

  it('uses the exported thresholds', () => {
    expect(WARNING_DAYS).toBe(30);
    expect(CRITICAL_DAYS).toBe(7);
  });

  it.each([NaN, Infinity, -Infinity])('throws for %s instead of guessing a status', (daysLeft) => {
    expect(() => calculateStatus(daysLeft)).toThrow(RangeError);
  });
});

describe('calculateDaysLeft', () => {
  it('counts whole days', () => {
    expect(calculateDaysLeft(plus(31 * MS_PER_DAY), now)).toBe(31);
    expect(calculateDaysLeft(now, now)).toBe(0);
  });

  it('rounds down just before a full day and steps up exactly at it', () => {
    expect(calculateDaysLeft(plus(MS_PER_DAY - 1), now)).toBe(0);
    expect(calculateDaysLeft(plus(MS_PER_DAY), now)).toBe(1);
    expect(calculateDaysLeft(plus(MS_PER_DAY + 1), now)).toBe(1);
    expect(calculateDaysLeft(plus(31 * MS_PER_DAY - 1), now)).toBe(30);
  });

  it('goes negative as soon as the certificate has expired', () => {
    expect(calculateDaysLeft(plus(-1), now)).toBe(-1);
    expect(calculateDaysLeft(plus(-MS_PER_DAY), now)).toBe(-1);
    expect(calculateDaysLeft(plus(-MS_PER_DAY - 1), now)).toBe(-2);
  });

  it('feeds calculateStatus so the last millisecond before expiry is CRITICAL and the next is EXPIRED', () => {
    expect(calculateStatus(calculateDaysLeft(plus(1), now))).toBe('CRITICAL');
    expect(calculateStatus(calculateDaysLeft(plus(-1), now))).toBe('EXPIRED');
  });

  it('throws for an invalid date', () => {
    expect(() => calculateDaysLeft(new Date('not a date'), now)).toThrow(RangeError);
  });
});

describe('SEVERITY', () => {
  it('orders OK < WARNING < CRITICAL < EXPIRED', () => {
    expect(SEVERITY.OK).toBeLessThan(SEVERITY.WARNING);
    expect(SEVERITY.WARNING).toBeLessThan(SEVERITY.CRITICAL);
    expect(SEVERITY.CRITICAL).toBeLessThan(SEVERITY.EXPIRED);
  });
});
