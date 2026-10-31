import cron from 'node-cron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SCHEDULE, SCHEDULE_TIME_ZONE, startScheduler } from '../../src/scheduler';

const task = vi.hoisted(() => ({ stop: vi.fn(), getNextRun: vi.fn(() => null) }));
vi.mock('node-cron', () => ({ default: { schedule: vi.fn(() => task) } }));

const schedule = vi.mocked(cron.schedule);
const silentLog = () => ({ log: vi.fn(), warn: vi.fn(), error: vi.fn() });

/** A run that stays in progress until `resolve()` is called. */
function deferredRun() {
  let resolve!: () => void;
  const run = vi.fn(() => new Promise<void>((r) => (resolve = r)));
  return { run, resolve: () => resolve() };
}

/** The callback node-cron was given, as node-cron would call it on a tick. */
function tick(): Promise<unknown> {
  const callback = schedule.mock.lastCall![1] as () => Promise<unknown>;
  return callback();
}

describe('startScheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers 08:00 daily in Europe/Sofia', () => {
    startScheduler(async () => {}, silentLog());

    expect(SCHEDULE).toBe('0 8 * * *');
    expect(SCHEDULE_TIME_ZONE).toBe('Europe/Sofia');
    expect(schedule).toHaveBeenCalledExactlyOnceWith('0 8 * * *', expect.any(Function), {
      timezone: 'Europe/Sofia',
      name: 'notification-job',
    });
  });

  it('runs the job on each tick', async () => {
    const run = vi.fn(async () => {});
    startScheduler(run, silentLog());

    await tick();
    await tick();

    expect(run).toHaveBeenCalledTimes(2);
  });

  it('skips a tick while the previous run is still going', async () => {
    const { run, resolve } = deferredRun();
    const log = silentLog();
    startScheduler(run, log);

    const first = tick();
    await tick();
    expect(run).toHaveBeenCalledOnce();
    expect(log.warn).toHaveBeenCalledOnce();

    resolve();
    await first;
    const third = tick();
    expect(run).toHaveBeenCalledTimes(2);
    resolve();
    await third;
  });

  it('runNow reports whether it ran, and shares the guard with the cron tick', async () => {
    const { run, resolve } = deferredRun();
    const scheduler = startScheduler(run, silentLog());

    const first = scheduler.runNow();
    expect(await scheduler.runNow()).toBe(false);
    await tick();
    expect(run).toHaveBeenCalledOnce();

    resolve();
    expect(await first).toBe(true);
  });

  it('catches and logs a failed run, and runs again next time', async () => {
    const error = new Error('database is locked');
    const run = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(undefined);
    const log = silentLog();
    startScheduler(run, log);

    await expect(tick()).resolves.toBe(true);
    expect(log.error).toHaveBeenCalledWith('Notification job failed:', error);

    await tick();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('stop stops the cron task and waits for the run in progress', async () => {
    const { run, resolve } = deferredRun();
    const scheduler = startScheduler(run, silentLog());
    void tick();

    let stopped = false;
    const stopping = scheduler.stop().then(() => (stopped = true));
    await Promise.resolve();
    expect(task.stop).toHaveBeenCalledOnce();
    expect(stopped).toBe(false);

    resolve();
    await stopping;
    expect(stopped).toBe(true);
  });
});
