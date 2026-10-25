/**
 * Re-derives the bike type of synced rides (Garmin, Hammerhead) the way the syncs do (see
 * resolveBikeType), e.g. after editing data/bike-sensors.json. Bike types the user picked are
 * never touched.
 */
import type { DB } from '../db/connection.ts';
import { stmt } from '../db/stmt.ts';
import type { BikeType } from '../domain.ts';
import { decideGarminType } from '../garmin/activityTypes.ts';
import { resolveBikeType, type BikeSensorConfig } from './bikeSensors.ts';
import * as rides from './repo.ts';

export interface BikeTypeChange {
  rideId: string;
  date: string | null;
  title: string | null;
  from: BikeType | null;
  to: BikeType;
  /** Matched sensor rule, or how the type was decided without one. */
  reason: string;
}

export function reclassifyBikeTypes(
  db: DB,
  config: BikeSensorConfig,
  opts: { apply: boolean }
): { checked: number; changes: BikeTypeChange[] } {
  const candidates = db
    .prepare(
      `SELECT id, title, date, bike_type, activity_type, source FROM rides
       WHERE source IN ('garmin', 'hammerhead') AND bike_type_source IS NOT 'user'
       ORDER BY COALESCE(start_time, date), id`
    )
    .all() as Array<
    Pick<rides.RideRow, 'id' | 'title' | 'date' | 'bike_type' | 'activity_type'> & {
      source: 'garmin' | 'hammerhead';
    }
  >;

  const changes: BikeTypeChange[] = [];
  for (const r of candidates) {
    const decision = decideGarminType(r.activity_type ?? undefined);
    const byActivity = decision.action === 'import' ? decision.bikeType : null;
    const to = resolveBikeType(r.source, rides.loadDevices(db, r.id), byActivity, config);
    if (!to || to.bikeType === r.bike_type) continue;
    changes.push({
      rideId: r.id,
      date: r.date,
      title: r.title,
      from: r.bike_type,
      to: to.bikeType,
      reason: to.reason === 'activity type' ? `activity type ${r.activity_type}` : to.reason,
    });
  }

  if (opts.apply && changes.length > 0) {
    const update = stmt(
      db,
      `UPDATE rides SET bike_type = ?, bike_type_source = 'auto' WHERE id = ?`
    );
    db.transaction(() => {
      for (const c of changes) update.run(c.to, c.rideId);
    })();
  }
  return { checked: candidates.length, changes };
}
