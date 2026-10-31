import { ChevronRight, Search, Star } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Ride, RouteSummary } from '../api';
import { SORT_LABELS, type SortKey } from '../components/sidebar/routeSort';
import type { FavoriteKind } from '../components/sidebar/favorites';
import { BikeDot, RideCount, RouteName } from '../components/ui/badges';
import { BikeDots } from '../components/sidebar/RoutesTab';
import { cx } from '../components/ui/cx';
import { Metrics } from '../components/ui/Metrics';
import { EmptyState, SkeletonRows } from '../components/ui/states';
import {
  formatDate,
  formatDuration,
  formatElevation,
  formatKm,
  formatRelative,
  formatTime,
} from '../format';
import { parseRouteRating } from '../domain';
import { favoriteEntryGroups, type Entry, type ListFilters, type MobileTab } from './entries';

const KINDS: Array<{ value: FavoriteKind; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'gravel', label: 'Gravel' },
  { value: 'road', label: 'Road' },
];

const PLACEHOLDER: Record<MobileTab, string> = {
  favorites: 'Search favorites',
  routes: 'Search routes',
  rides: 'Search rides',
};

/** Search and the tab's own filter, pinned at the top of the expanded sheet. */
export function ListHeader({
  tab,
  filters,
  onChange,
}: {
  tab: MobileTab;
  filters: ListFilters;
  onChange(patch: Partial<ListFilters>): void;
}) {
  return (
    <div className="space-y-2 border-b border-line px-4 pt-1 pb-3">
      <label className="relative flex">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint"
        />
        <input
          type="search"
          enterKeyHint="search"
          value={filters.search}
          onChange={(e) => onChange({ search: e.target.value })}
          placeholder={PLACEHOLDER[tab]}
          aria-label={PLACEHOLDER[tab]}
          className="h-11 w-full rounded-md border border-line bg-raised pr-3 pl-9 text-fg outline-none placeholder:text-faint focus:border-signal"
        />
      </label>
      {tab === 'favorites' && (
        <div role="group" aria-label="Filter favorites by surface" className="flex gap-2">
          {KINDS.map((k) => (
            <Chip
              key={k.value}
              pressed={filters.favoriteKind === k.value}
              onClick={() => onChange({ favoriteKind: k.value })}
            >
              {k.label}
            </Chip>
          ))}
        </div>
      )}
      {tab === 'routes' && (
        <label className="flex items-center gap-2 text-sm text-muted">
          Sort by
          <select
            value={filters.routeSort}
            onChange={(e) => onChange({ routeSort: e.target.value as SortKey })}
            className="h-9 flex-1 rounded-md border border-line bg-raised px-2 text-fg outline-none focus:border-signal"
          >
            {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
              <option key={k} value={k}>
                {SORT_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

export function Chip({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick(): void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cx(
        'inline-flex h-9 items-center gap-2 rounded-md border px-3.5 text-sm font-medium',
        pressed ? 'border-line-strong bg-active text-fg' : 'border-line text-muted'
      )}
    >
      {children}
    </button>
  );
}

/** The expanded list of the current tab. */
export function EntryList({
  tab,
  entries,
  routes,
  filters,
  loading,
  error,
  maxCount,
  onOpen,
}: {
  tab: MobileTab;
  entries: Entry[];
  routes: readonly RouteSummary[] | undefined;
  filters: ListFilters;
  loading: boolean;
  error: boolean;
  maxCount: number;
  onOpen(entry: Entry): void;
}) {
  if (loading) return <SkeletonRows />;
  if (error)
    return (
      <EmptyState tone="danger">
        Could not load your rides. Check that the server is running.
      </EmptyState>
    );
  if (entries.length === 0)
    return (
      <EmptyList tab={tab} filtered={filters.search !== '' || filters.favoriteKind !== 'all'} />
    );

  if (tab === 'favorites') {
    return (
      <div className="pb-4">
        {favoriteEntryGroups(routes ?? [], filters).map((g) => (
          <section key={g.stars} aria-label={`${g.stars} stars`}>
            <h3 className="sticky top-0 z-10 flex items-center gap-2 bg-panel/95 px-4 pt-3 pb-1.5 text-sm font-medium text-muted backdrop-blur">
              <span className="flex text-heat-3" aria-hidden>
                {Array.from({ length: g.stars }, (_, i) => (
                  <Star key={i} className="size-3.5 fill-current" />
                ))}
              </span>
              {g.stars} stars
              <span className="tnum text-faint">{g.entries.length}</span>
            </h3>
            <ul>
              {g.entries.map((e) => (
                <li key={e.key}>
                  <EntryRow entry={e} maxCount={maxCount} onOpen={onOpen} grouped />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    );
  }
  return (
    <ul className="pb-4">
      {entries.map((e) => (
        <li key={e.key}>
          <EntryRow entry={e} maxCount={maxCount} onOpen={onOpen} />
        </li>
      ))}
    </ul>
  );
}

function EmptyList({ tab, filtered }: { tab: MobileTab; filtered: boolean }) {
  if (filtered)
    return <EmptyState icon={<Search />}>Nothing matches. Try a shorter search.</EmptyState>;
  if (tab === 'favorites')
    return (
      <EmptyState icon={<Star />}>
        No favorites yet. Rate routes on desktop by starting the name with 1S to 6S, for example
        “5SG Forest loop”.
      </EmptyState>
    );
  return <EmptyState>No rides yet. Sync or import rides on desktop.</EmptyState>;
}

function EntryRow({
  entry,
  maxCount,
  onOpen,
  grouped = false,
}: {
  entry: Entry;
  maxCount: number;
  onOpen(entry: Entry): void;
  /** Inside a star group: the heading already shows the rating. */
  grouped?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(entry)}
      className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left active:bg-raised"
    >
      <span className="min-w-0 flex-1">
        {entry.kind === 'ride' ? (
          <RideLine ride={entry.ride} />
        ) : (
          <RouteLine route={entry.route} maxCount={maxCount} grouped={grouped} />
        )}
      </span>
      <ChevronRight aria-hidden className="size-4 shrink-0 text-faint" />
    </button>
  );
}

function RouteLine({
  route,
  maxCount,
  grouped,
}: {
  route: RouteSummary;
  maxCount: number;
  grouped: boolean;
}) {
  const rating = grouped ? parseRouteRating(route.name) : null;
  return (
    <>
      <span className="flex items-center gap-2">
        {rating ? (
          <span className="flex min-w-0 flex-1 items-center gap-2 text-base font-medium text-fg">
            <span className="truncate">{rating.rest || 'Unnamed route'}</span>
            {rating.kind && (
              <span className="shrink-0 text-xs font-normal text-muted">
                {rating.kind === 'gravel' ? 'Gravel' : 'Road'}
              </span>
            )}
          </span>
        ) : (
          <RouteName name={route.name} className="flex-1 text-base font-medium text-fg" />
        )}
        <BikeDots bikeTypes={route.bike_types} />
        {route.ride_count > 1 && <RideCount count={route.ride_count} max={maxCount} />}
      </span>
      <Metrics
        className="mt-1 text-sm"
        items={[
          formatKm(route.avg_distance_km, 0),
          formatElevation(route.avg_elevation_gain_m),
          route.last_ridden &&
            (route.ride_count > 1
              ? `last ${formatRelative(route.last_ridden)}`
              : `once, ${formatRelative(route.last_ridden)}`),
        ]}
      />
    </>
  );
}

/** A ride as a list row (also used on the route page and in "Rides here"). */
export function RideLine({ ride, showRoute = true }: { ride: Ride; showRoute?: boolean }) {
  return (
    <>
      <span className="flex items-center gap-2">
        <BikeDot type={ride.bike_type} />
        <span className="truncate text-base font-medium text-fg">
          {ride.title ?? 'Untitled ride'}
        </span>
      </span>
      <Metrics
        className="mt-1 text-sm"
        items={[
          `${formatDate(ride.date ?? ride.start_time)} ${formatTime(ride.start_time)}`.trim(),
          formatKm(ride.distance_km),
          formatDuration(ride.moving_time_s ?? ride.duration_s),
        ]}
      />
      {showRoute && ride.route_name && (
        <RouteName name={ride.route_name} className="mt-1 text-xs text-faint" />
      )}
    </>
  );
}
