import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, renderHook, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ride, RideDetail, RouteDetail, RouteSummary } from '../src/api';
import { ToastProvider } from '../src/components/Toast';
import { rideEntries, routeEntries, tabEntries, DEFAULT_FILTERS } from '../src/mobile/entries';
import { snapDetent } from '../src/mobile/sheet';
import { resolveUiOverride, useUiMode } from '../src/uiMode';

vi.mock('../src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/api')>()),
  getRoutes: vi.fn(),
  getRoute: vi.fn(),
  getRides: vi.fn(),
  getRide: vi.fn(),
  getRideLine: vi.fn(),
  getRidesNearPoint: vi.fn(),
  updateRide: vi.fn(),
  deleteRide: vi.fn(),
  moveRideToRoute: vi.fn(),
  renameRoute: vi.fn(),
  mergeRoutes: vi.fn(),
  createSection: vi.fn(),
  updateSection: vi.fn(),
  deleteSection: vi.fn(),
  startSync: vi.fn(),
  importRides: vi.fn(),
  acceptSuggestion: vi.fn(),
  rejectSuggestion: vi.fn(),
  unlinkPlannedRoute: vi.fn(),
  refreshPlannedRoutes: vi.fn(),
}));
// Leaflet needs a real browser; the map is covered by the manual checks.
vi.mock('../src/mobile/MobileMap', () => ({ default: () => null }));

const api = await import('../src/api');
const { default: MobileApp } = await import('../src/mobile/MobileApp');

const MUTATIONS = [
  'updateRide',
  'deleteRide',
  'moveRideToRoute',
  'renameRoute',
  'mergeRoutes',
  'createSection',
  'updateSection',
  'deleteSection',
  'startSync',
  'importRides',
  'acceptSuggestion',
  'rejectSuggestion',
  'unlinkPlannedRoute',
  'refreshPlannedRoutes',
] as const;

const summary = (over: Partial<RouteSummary>): RouteSummary => ({
  id: 'r1',
  name: '5SG Waldrunde',
  name_source: 'user',
  reference_ride_id: 'ride-1',
  ride_count: 2,
  first_ridden: '2024-04-01',
  last_ridden: '2025-06-01T08:00:00.000Z',
  avg_distance_km: 64.2,
  avg_elevation_gain_m: 420,
  bike_types: 'gravel',
  length_m: 64000,
  planned_route_name: null,
  ...over,
});

const ride = (over: Partial<Ride>): Ride => ({
  id: 'ride-1',
  title: 'Waldrunde #1',
  date: '2025-06-01',
  start_time: '2025-06-01T08:00:00.000Z',
  bike_type: 'gravel',
  bike_type_source: 'auto',
  distance_km: 64.2,
  elevation_gain_m: 420,
  duration_s: 9000,
  moving_time_s: 8400,
  notes: null,
  source: 'garmin',
  activity_type: 'gravel_cycling',
  garmin_activity_id: 1,
  hammerhead_activity_id: null,
  route_id: 'r1',
  route_name: '5SG Waldrunde',
  route_similarity: 1,
  route_direction: 'forward',
  route_assignment: 'auto',
  created_at: '2025-06-01',
  ...over,
});

const routes = [
  summary({ id: 'r3', name: '3SR Hügel', last_ridden: '2025-07-01' }),
  summary({}),
  summary({ id: 'r2', name: 'Seerunde', ride_count: 1, reference_ride_id: 'ride-9' }),
  summary({ id: 'r4', name: '6S Single', ride_count: 1, reference_ride_id: 'ride-4' }),
];

describe('ui mode', () => {
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('is desktop without matchMedia (tests, old browsers)', () => {
    const { result } = renderHook(() => useUiMode());
    expect(result.current).toBe('desktop');
  });

  it('follows the phone media query', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((q: string) => ({
        matches: q.includes('pointer: coarse'),
        media: q,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }))
    );
    const { result } = renderHook(() => useUiMode());
    expect(result.current).toBe('mobile');
  });

  it('remembers a ?ui= override until ?ui=auto', () => {
    expect(resolveUiOverride('?ui=mobile')).toBe('mobile');
    expect(resolveUiOverride('')).toBe('mobile');
    expect(resolveUiOverride('?ui=desktop')).toBe('desktop');
    expect(resolveUiOverride('?ui=auto')).toBeNull();
    expect(resolveUiOverride('')).toBeNull();
  });
});

describe('mobile lists', () => {
  it('orders the deck like the lists: favourites by stars, single rides open as rides', () => {
    const entries = tabEntries('favorites', routes, [], DEFAULT_FILTERS);
    expect(entries.map((e) => e.key)).toEqual(['r4', 'r1', 'r3']);
    expect(entries[0]).toMatchObject({ kind: 'single', rideId: 'ride-4' });
    expect(entries[1]).toMatchObject({ kind: 'route' });
  });

  it('searches routes by planned name and rides by route name', () => {
    const planned = [...routes, summary({ id: 'p', name: 'X', planned_route_name: 'Lange Tour' })];
    expect(
      routeEntries(planned, { ...DEFAULT_FILTERS, search: 'lange' }).map((e) => e.key)
    ).toEqual(['p']);
    const rides = [
      ride({ id: 'a', start_time: '2025-01-01T08:00:00Z', route_name: 'Seerunde' }),
      ride({ id: 'b', start_time: '2025-03-01T08:00:00Z' }),
      ride({ id: 'c', start_time: '2025-02-01T08:00:00Z' }),
    ];
    expect(rideEntries(rides, DEFAULT_FILTERS).map((e) => e.key)).toEqual(['b', 'c', 'a']);
    expect(rideEntries(rides, { ...DEFAULT_FILTERS, search: 'see' }).map((e) => e.key)).toEqual([
      'a',
    ]);
  });

  it('snaps the sheet to the nearest height, or one step on a flick', () => {
    const h = { peek: 180, half: 450, full: 880 };
    expect(snapDetent(h, 300, 0)).toBe('peek');
    expect(snapDetent(h, 340, 0)).toBe('half');
    expect(snapDetent(h, 200, -1)).toBe('half');
    expect(snapDetent(h, 500, 1)).toBe('half');
    expect(snapDetent(h, 860, 0)).toBe('full');
  });
});

describe('MobileApp', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, '');
    vi.mocked(api.getRoutes).mockResolvedValue(routes);
    vi.mocked(api.getRides).mockResolvedValue([
      ride({}),
      ride({ id: 'ride-2', title: 'Abendrunde' }),
    ]);
    vi.mocked(api.getRideLine).mockResolvedValue([]);
    const detail: RouteDetail = {
      ...summary({ planned_route_name: 'Waldrunde lang' }),
      reference_track: [],
      rides: [ride({}), ride({ id: 'ride-2', title: 'Waldrunde #2', date: '2024-05-01' })],
    };
    vi.mocked(api.getRoute).mockResolvedValue(detail);
    const rideDetail: RideDetail = {
      ...ride({ id: 'ride-2', title: 'Waldrunde #2' }),
      track: [
        [41.9, 2.8],
        [41.91, 2.81],
        [41.92, 2.82],
      ],
      elevation: [100, 150, 120],
      devices: [{ manufacturer: 'Hammerhead', product_name: 'Karoo' }],
      sections: [],
    };
    vi.mocked(api.getRide).mockResolvedValue(rideDetail);
  });

  afterEach(() => {
    for (const name of MUTATIONS) expect(api[name]).not.toHaveBeenCalled();
  });

  function setup() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    );
    return render(<MobileApp />, { wrapper });
  }

  it('shows favourites as a deck and drills into route, ride and back', async () => {
    const user = userEvent.setup();
    setup();
    const deck = await screen.findByRole('list', { name: 'Swipe through routes' });
    const cards = within(deck).getAllByRole('listitem');
    expect(cards.map((c) => c.textContent)).toEqual([
      expect.stringContaining('Single'),
      expect.stringContaining('Waldrunde'),
      expect.stringContaining('Hügel'),
    ]);

    // A neighbour comes to the centre first; the centred card opens.
    await user.click(within(cards[1]!).getByRole('button'));
    expect(screen.queryByRole('heading', { name: 'Waldrunde' })).not.toBeInTheDocument();
    await user.click(within(cards[0]!).getByRole('button'));
    // A favourite ridden once opens as its ride.
    expect(await screen.findByRole('heading', { name: 'Waldrunde #2' })).toBeInTheDocument();
    expect(api.getRide).toHaveBeenCalledWith('ride-4');
    expect(screen.getByText('Show route')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Favorites' }));
    expect(await screen.findByRole('list', { name: 'Swipe through routes' })).toBeInTheDocument();
  });

  it('opens a route from the expanded list, then one of its rides', async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByRole('list', { name: 'Swipe through routes' });
    await user.click(screen.getByRole('button', { name: 'Expand panel' }));
    const group = await screen.findByRole('region', { name: '5 stars' });
    await user.click(within(group).getByRole('button'));

    expect(await screen.findByRole('heading', { name: 'Waldrunde' })).toBeInTheDocument();
    expect(screen.getByText('Planned: Waldrunde lang')).toBeInTheDocument();
    const rides = await screen.findByRole('region', { name: 'Rides of this route' });
    await user.click(within(rides).getByText('Waldrunde #2'));

    expect(await screen.findByRole('heading', { name: 'Waldrunde #2' })).toBeInTheDocument();
    expect(screen.getByText('Hammerhead Karoo')).toBeInTheDocument();
    // Opened from its route, so no "Show route" link back to it.
    expect(screen.queryByText('Show route')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Route' }));
    expect(await screen.findByRole('heading', { name: 'Waldrunde' })).toBeInTheDocument();
  });

  it('switches tabs and searches within one', async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByRole('list', { name: 'Swipe through routes' });
    await user.click(screen.getByRole('button', { name: 'Rides' }));
    const deck = await screen.findByRole('list', { name: 'Swipe through routes' });
    expect(await within(deck).findByText('Abendrunde')).toBeInTheDocument();
    expect(api.getRides).toHaveBeenCalledWith(null);

    await user.click(screen.getByRole('button', { name: 'Expand panel' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search rides' }), 'abend');
    await act(async () => {});
    expect(screen.getByText('Abendrunde')).toBeInTheDocument();
    expect(screen.queryByText('Waldrunde #1')).not.toBeInTheDocument();
  });
});
