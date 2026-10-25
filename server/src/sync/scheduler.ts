import { ConflictError } from '../errors.ts';
import { logger } from '../logger.ts';

export interface Scheduler {
  stop(): void;
  nextRunAt(): Date | null;
}

/** What the scheduler needs from a provider sync (GarminSync, HammerheadSync). */
export interface SyncJob {
  /** Shown in log lines, e.g. "Garmin". */
  name: string;
  run(opts: { mode: 'incremental' }): Promise<unknown>;
  /** Auth problems are logged as one line (no stack): the user has to act, not the code. */
  isAuthError(e: unknown): boolean;
  /** False skips the tick silently (e.g. Hammerhead account not connected yet). */
  isReady?(): boolean;
}

/**
 * Runs an incremental sync every `intervalMin` minutes (±5% jitter), starting shortly after boot.
 * Errors are logged and recorded in sync_runs; the schedule keeps going.
 */
export function startSyncScheduler(
  job: SyncJob,
  intervalMin: number,
  initialDelayMs = 30_000
): Scheduler {
  let timer: NodeJS.Timeout | null = null;
  let next: Date | null = null;
  let stopped = false;

  const schedule = (delayMs: number) => {
    if (stopped) return;
    next = new Date(Date.now() + delayMs);
    timer = setTimeout(tick, delayMs);
    timer.unref();
  };

  const tick = async () => {
    try {
      if (job.isReady?.() ?? true) await job.run({ mode: 'incremental' });
    } catch (e) {
      if (e instanceof ConflictError)
        logger.info(`Scheduled ${job.name} sync skipped: a sync is already running`);
      else if (job.isAuthError(e))
        logger.error(`Scheduled ${job.name} sync failed: ${(e as Error).message}`);
      else logger.error(`Scheduled ${job.name} sync failed`, e);
    }
    const base = intervalMin * 60_000;
    schedule(base + (Math.random() - 0.5) * 0.1 * base);
  };

  schedule(initialDelayMs);
  logger.info(`${job.name} sync scheduled every ${intervalMin} min`);
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      next = null;
    },
    nextRunAt: () => next,
  };
}
