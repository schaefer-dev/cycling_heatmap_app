import { ConflictError } from '../errors.ts';
import { logger } from '../logger.ts';
import { GarminAuthError } from './client.ts';
import type { GarminSync } from './sync.ts';

export interface Scheduler {
  stop(): void;
  nextRunAt(): Date | null;
}

/**
 * Runs an incremental sync every `intervalMin` minutes (±5% jitter), starting shortly after boot.
 * Errors are logged and recorded in sync_runs; the schedule keeps going.
 */
export function startSyncScheduler(
  sync: GarminSync,
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
      await sync.run({ mode: 'incremental' });
    } catch (e) {
      if (e instanceof ConflictError)
        logger.info('Scheduled sync skipped: a sync is already running');
      else if (e instanceof GarminAuthError) logger.error(`Scheduled sync failed: ${e.message}`);
      else logger.error('Scheduled sync failed', e);
    }
    const base = intervalMin * 60_000;
    schedule(base + (Math.random() - 0.5) * 0.1 * base);
  };

  schedule(initialDelayMs);
  logger.info(`Garmin sync scheduled every ${intervalMin} min`);
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      next = null;
    },
    nextRunAt: () => next,
  };
}
