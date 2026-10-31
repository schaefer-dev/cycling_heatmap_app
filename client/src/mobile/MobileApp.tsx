import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bike, Layers, Maximize, Route as RouteIcon, Star } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Selection } from '../App';
import {
  errorMessage,
  getRideLine,
  getRidesNearPoint,
  getRides,
  getRoute,
  getRoutes,
  type BikeFilter,
  type LatLngTuple,
  type Ride,
} from '../api';
import { useToast } from '../components/Toast';
import { cx } from '../components/ui/cx';
import { qk } from '../queryKeys';
import { usePersistentState } from '../usePersistentState';
import { BottomSheet } from './BottomSheet';
import {
  DEFAULT_FILTERS,
  entryPreview,
  tabEntries,
  type Entry,
  type ListFilters,
  type MobileTab,
} from './entries';
import { LayersPanel } from './LayersPanel';
import { EntryList, ListHeader } from './lists';
import MobileMap from './MobileMap';
import { RouteDeck } from './RouteDeck';
import { NearbyScreen, RideScreen, RouteScreen } from './screens';
import type { Detent } from './sheet';
import { useViewport } from './useViewport';
import { DEFAULT_MOBILE_VIEW, type MobileView } from './view';
import './mobile.css';

/** A page pushed over the lists. Each one is also a browser history entry (iOS back swipe). */
type Screen =
  | { kind: 'route'; routeId: string; backLabel: string }
  | { kind: 'ride'; rideId: string; contextRouteId: string | null; backLabel: string }
  | { kind: 'nearby'; point: LatLngTuple; rides: Ride[] };

/** `detents[i]` is the sheet height on level i (0 = the lists), so going back restores it. */
interface Nav {
  stack: Screen[];
  detents: Detent[];
}

const TABS: Array<{ value: MobileTab; label: string; icon: typeof Star }> = [
  { value: 'favorites', label: 'Favorites', icon: Star },
  { value: 'routes', label: 'Routes', icon: RouteIcon },
  { value: 'rides', label: 'Rides', icon: Bike },
];
const TAB_LABEL: Record<MobileTab, string> = {
  favorites: 'Favorites',
  routes: 'Routes',
  rides: 'Rides',
};

const TAB_BAR = 56;
const DECK_PEEK = 176;
const SCREEN_PEEK = 176;
const BUTTON_COLUMN = 112;
const HISTORY_KEY = 'ridestackDepth';

const EMPTY_FILTERS: Record<MobileTab, ListFilters> = {
  favorites: DEFAULT_FILTERS,
  routes: DEFAULT_FILTERS,
  rides: DEFAULT_FILTERS,
};

/**
 * The phone app: view only. A full-screen map with a bottom sheet. Collapsed, the sheet is a deck
 * of cards whose centred card is drawn on the map; expanded, it is a searchable list. Routes and
 * rides open as pages in the sheet, with the map showing them above.
 */
export default function MobileApp() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const viewport = useViewport();
  const [tab, setTab] = usePersistentState<MobileTab>('mobile-tab', 'favorites');
  const [view, setView] = usePersistentState<MobileView>(
    'mobile-view-settings',
    DEFAULT_MOBILE_VIEW
  );
  const [bikeFilter, setBikeFilter] = useState<BikeFilter>(null);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [activeKeys, setActiveKeys] = useState<Record<MobileTab, string | null>>({
    favorites: null,
    routes: null,
    rides: null,
  });
  const [nav, setNav] = useState<Nav>({ stack: [], detents: ['peek'] });
  const [scrub, setScrub] = useState<{ rideId: string; index: number } | null>(null);
  const [layersOpen, setLayersOpen] = useState(false);
  const [fitNonce, setFitNonce] = useState(0);

  const top = nav.stack.at(-1) ?? null;
  const detent = nav.detents.at(-1) ?? 'peek';
  const atLists = top === null;

  const routesQuery = useQuery({
    queryKey: qk.routes(bikeFilter),
    queryFn: () => getRoutes(bikeFilter),
  });
  const ridesQuery = useQuery({
    queryKey: qk.rides(bikeFilter),
    queryFn: () => getRides(bikeFilter),
    enabled: tab === 'rides',
  });
  const routes = routesQuery.data;
  const rides = ridesQuery.data;
  const tabFilters = filters[tab];
  const entries = useMemo(
    () => tabEntries(tab, routes, rides, tabFilters),
    [tab, routes, rides, tabFilters]
  );
  const activeEntry = entries.find((e) => e.key === activeKeys[tab]) ?? entries[0] ?? null;
  const maxCount = useMemo(() => Math.max(1, ...(routes ?? []).map((r) => r.ride_count)), [routes]);
  const listLoading = tab === 'rides' ? ridesQuery.isLoading : routesQuery.isLoading;
  const listError = tab === 'rides' ? ridesQuery.isError : routesQuery.isError;

  // ----- navigation (mirrored in browser history so the iOS back swipe works) -----

  const push = (screen: Screen, nextDetent: Detent = 'half') => {
    setScrub(null);
    setNav((n) => ({ stack: [...n.stack, screen], detents: [...n.detents, nextDetent] }));
    window.history.pushState({ [HISTORY_KEY]: nav.stack.length + 1 }, '');
  };

  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const state = e.state as Record<string, unknown> | null;
      const depth = typeof state?.[HISTORY_KEY] === 'number' ? (state[HISTORY_KEY] as number) : 0;
      setScrub(null);
      setNav((n) =>
        depth >= n.stack.length
          ? n
          : { stack: n.stack.slice(0, depth), detents: n.detents.slice(0, depth + 1) }
      );
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const back = useCallback(() => window.history.back(), []);

  const setDetent = (d: Detent) =>
    setNav((n) => ({ ...n, detents: [...n.detents.slice(0, -1), d] }));

  const openEntry = (entry: Entry) => {
    const backLabel = TAB_LABEL[tab];
    if (entry.kind === 'route') push({ kind: 'route', routeId: entry.route.id, backLabel });
    else
      push({
        kind: 'ride',
        rideId: entry.kind === 'single' ? entry.rideId : entry.ride.id,
        contextRouteId: null,
        backLabel,
      });
  };

  const changeActive = (key: string) => {
    setActiveKeys((k) => ({ ...k, [tab]: key }));
    // Warm the neighbours' lines so the next swipe draws instantly.
    const i = entries.findIndex((e) => e.key === key);
    for (const e of [entries[i - 1], entries[i + 1]]) {
      if (!e) continue;
      const p = entryPreview(e);
      if (p.kind === 'route')
        void queryClient.prefetchQuery({ queryKey: qk.route(p.id), queryFn: () => getRoute(p.id) });
      else
        void queryClient.prefetchQuery({
          queryKey: qk.rideLine(p.id),
          queryFn: () => getRideLine(p.id),
        });
    }
  };

  const onMapTap = async (point: LatLngTuple) => {
    if (layersOpen) return;
    try {
      const found = await getRidesNearPoint(point[0], point[1], bikeFilter);
      if (found.length === 0) toast.show('No rides pass here.', 'info');
      else push({ kind: 'nearby', point, rides: found });
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    }
  };

  // ----- what the map shows -----

  const selection: Selection =
    top?.kind === 'route'
      ? { routeId: top.routeId, rideId: null }
      : top?.kind === 'ride'
        ? { routeId: top.contextRouteId, rideId: top.rideId }
        : { routeId: null, rideId: null };
  const preview = atLists && activeEntry ? entryPreview(activeEntry) : null;

  // ----- layout -----

  const bottom = atLists ? TAB_BAR + viewport.safeBottom : 0;
  const available = viewport.height - bottom;
  const heights: Record<Detent, number> = {
    peek: atLists ? DECK_PEEK : SCREEN_PEEK + viewport.safeBottom,
    half: Math.round(available * 0.5),
    full: Math.max(available - viewport.safeTop - 8, DECK_PEEK),
  };
  const sheetCover = bottom + Math.min(heights[detent], heights.half);
  const buttonsTop = viewport.safeTop + 12;

  let content;
  if (top?.kind === 'route') {
    content = (
      <RouteScreen
        key={`route:${top.routeId}`}
        routeId={top.routeId}
        backLabel={top.backLabel}
        onBack={back}
        onOpenRide={(r) =>
          push({ kind: 'ride', rideId: r.id, contextRouteId: top.routeId, backLabel: 'Route' })
        }
      />
    );
  } else if (top?.kind === 'ride') {
    content = (
      <RideScreen
        key={`ride:${top.rideId}`}
        rideId={top.rideId}
        backLabel={top.backLabel}
        onBack={back}
        onShowRoute={
          top.contextRouteId
            ? null
            : (routeId) => push({ kind: 'route', routeId, backLabel: 'Ride' })
        }
        onScrub={(index) => setScrub(index === null ? null : { rideId: top.rideId, index })}
      />
    );
  } else if (top?.kind === 'nearby') {
    content = (
      <NearbyScreen
        rides={top.rides}
        onBack={back}
        onOpenRide={(r) =>
          push({ kind: 'ride', rideId: r.id, contextRouteId: null, backLabel: 'Rides here' })
        }
      />
    );
  } else if (detent === 'peek') {
    content = listLoading ? (
      <DeckMessage>Loading…</DeckMessage>
    ) : entries.length === 0 ? (
      <DeckMessage>
        {tab === 'favorites' && !tabFilters.search
          ? 'No favorites yet. Swipe up for all routes, or rate routes on desktop.'
          : 'Nothing to show. Swipe up to change the search.'}
      </DeckMessage>
    ) : (
      <RouteDeck
        entries={entries}
        activeKey={activeEntry?.key ?? null}
        maxCount={maxCount}
        onActiveChange={changeActive}
        onOpen={openEntry}
      />
    );
  } else {
    content = (
      <>
        <div data-sheet-drag className="sticky top-0 z-20 touch-none bg-panel">
          <ListHeader
            tab={tab}
            filters={tabFilters}
            onChange={(patch) => setFilters((f) => ({ ...f, [tab]: { ...f[tab], ...patch } }))}
          />
        </div>
        <EntryList
          tab={tab}
          entries={entries}
          routes={routes}
          filters={tabFilters}
          loading={listLoading}
          error={listError}
          maxCount={maxCount}
          onOpen={openEntry}
        />
      </>
    );
  }

  return (
    <div className="mobile-shell fixed inset-0 touch-manipulation overflow-hidden bg-canvas">
      <div className="absolute inset-0">
        <MobileMap
          selection={selection}
          preview={preview}
          bikeFilter={bikeFilter}
          view={view}
          inset={{ top: buttonsTop + BUTTON_COLUMN - 12, bottom: sheetCover }}
          fitNonce={fitNonce}
          tapPoint={top?.kind === 'nearby' ? top.point : null}
          scrubIndex={scrub && scrub.rideId === selection.rideId ? scrub.index : null}
          onTap={onMapTap}
        />
      </div>

      <div className="fixed left-3 z-[900] flex flex-col gap-2" style={{ top: buttonsTop }}>
        <MapButton label="Map settings" onClick={() => setLayersOpen(true)}>
          <Layers aria-hidden className="size-5" />
        </MapButton>
        <MapButton label="Fit to view" onClick={() => setFitNonce((n) => n + 1)}>
          <Maximize aria-hidden className="size-5" />
        </MapButton>
      </div>

      <BottomSheet
        label={atLists ? TAB_LABEL[tab] : 'Details'}
        detent={detent}
        onDetentChange={setDetent}
        heights={heights}
        bottom={bottom}
      >
        {content}
      </BottomSheet>

      {atLists && (
        <nav
          aria-label="Lists"
          className="fixed inset-x-0 bottom-0 z-[1001] flex border-t border-line bg-panel"
          style={{ paddingBottom: viewport.safeBottom, height: TAB_BAR + viewport.safeBottom }}
        >
          {TABS.map(({ value, label, icon: Icon }) => {
            const active = tab === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                onClick={() => setTab(value)}
                className={cx(
                  'flex flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium',
                  active ? 'text-fg' : 'text-faint'
                )}
              >
                <Icon aria-hidden className={cx('size-5', active && 'text-signal')} />
                {label}
              </button>
            );
          })}
        </nav>
      )}

      {layersOpen && (
        <LayersPanel
          top={buttonsTop}
          view={view}
          onViewChange={(patch) => setView((v) => ({ ...v, ...patch }))}
          bikeFilter={bikeFilter}
          onBikeFilterChange={setBikeFilter}
          onClose={() => setLayersOpen(false)}
        />
      )}
    </div>
  );
}

function MapButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick(): void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="inline-flex size-11 items-center justify-center rounded-full border border-line bg-panel/90 text-fg shadow-float backdrop-blur active:bg-active"
    >
      {children}
    </button>
  );
}

function DeckMessage({ children }: { children: ReactNode }) {
  return (
    <p
      data-sheet-drag
      className="flex h-[144px] items-center justify-center px-8 text-center text-sm text-muted"
    >
      {children}
    </p>
  );
}
