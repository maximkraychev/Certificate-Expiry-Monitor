import cron from 'node-cron';

/** Every day at 08:00 Sofia time (spec). */
export const SCHEDULE = '0 8 * * *';
export const SCHEDULE_TIME_ZONE = 'Europe/Sofia';

export interface Scheduler {
  /** Runs the job now, unless a run is already in progress. Resolves false when it was skipped. Never rejects. */
  runNow(): Promise<boolean>;
  /** Stops the cron task and waits for a run in progress to finish. */
  stop(): Promise<void>;
}

/**
 * Schedules `run` daily. A run that starts while the previous one is still going is skipped, and errors are
 * logged instead of escaping into the cron library.
 */
export function startScheduler(
  run: () => Promise<unknown>,
  log: Pick<Console, 'log' | 'warn' | 'error'> = console,
): Scheduler {
  let current: Promise<void> | undefined;

  const runNow = async () => {
    if (current) {
      log.warn('Notification job skipped: the previous run is still in progress');
      return false;
    }
    current = (async () => {
      try {
        await run();
      } catch (err) {
        log.error('Notification job failed:', err);
      } finally {
        current = undefined;
      }
    })();
    await current;
    return true;
  };

  const task = cron.schedule(SCHEDULE, () => runNow(), { timezone: SCHEDULE_TIME_ZONE, name: 'notification-job' });
  log.log(`Scheduler started: "${SCHEDULE}" (${SCHEDULE_TIME_ZONE}), next run ${task.getNextRun()?.toISOString()}`);

  return {
    runNow,
    async stop() {
      await task.stop();
      await current;
    },
  };
}
