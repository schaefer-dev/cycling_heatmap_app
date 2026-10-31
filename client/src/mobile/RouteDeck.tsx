import { Star } from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';
import { parseRouteRating } from '../domain';
import { formatDate, formatDuration, formatElevation, formatKm, formatRelative } from '../format';
import { BikeDot, RideCount } from '../components/ui/badges';
import { BikeDots } from '../components/sidebar/RoutesTab';
import { cx } from '../components/ui/cx';
import { Metrics } from '../components/ui/Metrics';
import type { Entry } from './entries';

const GAP = 12;
/** Wait for the deck to settle before reporting, so a fling doesn't fetch every card on the way. */
const SETTLE_MS = 110;

/**
 * The collapsed sheet: one card per entry, snapping to the centre. The centred card is "active";
 * its line is drawn on the map (the touch version of hovering a row on desktop). Tapping the
 * active card opens it; tapping a neighbour brings it to the centre.
 */
export function RouteDeck({
  entries,
  activeKey,
  maxCount,
  onActiveChange,
  onOpen,
}: {
  entries: Entry[];
  activeKey: string | null;
  maxCount: number;
  onActiveChange(key: string): void;
  onOpen(entry: Entry): void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeIndex = Math.max(
    0,
    entries.findIndex((e) => e.key === activeKey)
  );

  const cardStep = () => {
    const first = scroller.current?.querySelector<HTMLElement>('[data-card]');
    return first ? first.offsetWidth + GAP : 1;
  };

  // Start on the active card (e.g. when coming back from a route page).
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = activeIndex * cardStep();
    // Only when the deck mounts or the list itself changes, never while the user swipes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);

  const onScroll = () => {
    if (settle.current) clearTimeout(settle.current);
    settle.current = setTimeout(() => {
      const el = scroller.current;
      if (!el) return;
      const i = Math.min(entries.length - 1, Math.max(0, Math.round(el.scrollLeft / cardStep())));
      const entry = entries[i];
      if (entry && entry.key !== activeKey) onActiveChange(entry.key);
    }, SETTLE_MS);
  };

  const bringToCentre = (i: number) => {
    scroller.current?.scrollTo?.({ left: i * cardStep(), behavior: 'smooth' });
  };

  return (
    <div>
      <p aria-hidden className="tnum -mt-4 h-4 px-4 text-right text-2xs text-faint">
        {entries.length > 1 ? `${activeIndex + 1} of ${entries.length}` : ''}
      </p>
      <div
        ref={scroller}
        data-sheet-drag
        onScroll={onScroll}
        role="list"
        aria-label="Swipe through routes"
        className="deck-scroller flex snap-x snap-mandatory overflow-x-auto pt-1 pb-3"
        style={{ gap: GAP, touchAction: 'pan-x' }}
      >
        {entries.map((entry, i) => {
          const active = i === activeIndex;
          return (
            <div
              key={entry.key}
              role="listitem"
              data-card
              className="deck-card shrink-0 snap-center"
            >
              <button
                type="button"
                aria-current={active ? 'true' : undefined}
                onClick={() => (active ? onOpen(entry) : bringToCentre(i))}
                className={cx(
                  'flex h-[120px] w-full flex-col rounded-lg border px-4 pt-3 pb-3 text-left transition-colors',
                  active ? 'border-signal/70 bg-raised' : 'border-line bg-raised/60'
                )}
              >
                <DeckCard entry={entry} active={active} maxCount={maxCount} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stars({ count, active }: { count: number; active: boolean }) {
  return (
    <span
      className={cx('flex gap-0.5', active ? 'text-heat-3' : 'text-heat-3/45')}
      aria-label={`${count} stars`}
    >
      {Array.from({ length: count }, (_, i) => (
        <Star key={i} aria-hidden className="size-3.5 fill-current" />
      ))}
    </span>
  );
}

function DeckCard({
  entry,
  active,
  maxCount,
}: {
  entry: Entry;
  active: boolean;
  maxCount: number;
}) {
  if (entry.kind === 'ride') {
    const r = entry.ride;
    return (
      <>
        <span className="tnum flex items-center gap-2 text-xs text-muted">
          <BikeDot type={r.bike_type} />
          {formatDate(r.date ?? r.start_time, { weekday: true })}
        </span>
        <span className="mt-1.5 line-clamp-2 text-lg font-semibold text-fg">
          {r.title ?? 'Untitled ride'}
        </span>
        <Metrics
          className="mt-auto text-sm"
          items={[
            formatKm(r.distance_km),
            formatElevation(r.elevation_gain_m),
            formatDuration(r.moving_time_s ?? r.duration_s),
          ]}
        />
      </>
    );
  }
  const route = entry.route;
  const rating = parseRouteRating(route.name);
  const name = (rating ? rating.rest : route.name) || 'Unnamed route';
  return (
    <>
      <span className="flex h-4 items-center gap-2">
        {rating ? (
          <Stars count={rating.stars} active={active} />
        ) : (
          <span className="text-xs text-faint">Unrated</span>
        )}
        {rating?.kind && (
          <span className="text-xs text-muted">{rating.kind === 'gravel' ? 'Gravel' : 'Road'}</span>
        )}
        <span className="ml-auto flex items-center gap-2">
          <BikeDots bikeTypes={route.bike_types} />
          {route.ride_count > 1 && <RideCount count={route.ride_count} max={maxCount} />}
        </span>
      </span>
      <span className="mt-1.5 line-clamp-2 text-lg font-semibold text-fg">{name}</span>
      <Metrics
        className="mt-auto text-sm"
        items={[
          formatKm(route.avg_distance_km, 0),
          formatElevation(route.avg_elevation_gain_m),
          route.ride_count > 1
            ? route.last_ridden && `last ${formatRelative(route.last_ridden)}`
            : route.last_ridden && `once, ${formatRelative(route.last_ridden)}`,
        ]}
      />
    </>
  );
}
