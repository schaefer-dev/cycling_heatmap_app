import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViewSettings } from '../src/App';
import type { Ride, RouteDetail, RouteSummary, Stats, SyncStatus } from '../src/api';
import { MapStyleControl } from '../src/components/map/MapControls';
import Sidebar from '../src/components/Sidebar';
import FavoritesTab from '../src/components/sidebar/FavoritesTab';
import RidesTab from '../src/components/sidebar/RidesTab';
import RoutesTab from '../src/components/sidebar/RoutesTab';
import { ToastProvider } from '../src/components/Toast';
import { ConfirmProvider } from '../src/components/ui/Confirm';

vi.mock('../src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/api')>()),
  getRides: vi.fn(),
  getRoutes: vi.fn(),
  getRoute: vi.fn(),
  updateRide: vi.fn(),
  deleteRide: vi.fn(),
  mergeRoutes: vi.fn(),
  moveRideToRoute: vi.fn(),
  unlinkPlannedRoute: vi.fn(),
  getStats: vi.fn(),
  getSuggestions: vi.fn(),
  getSyncStatus: vi.fn(),
}));
const api = await import('../src/api');

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ConfirmProvider>{children}</ConfirmProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}

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

const routes = [summary({}), summary({ id: 'r2', name: 'Seerunde', ride_count: 1 })];

describe('Route detail', () => {
  beforeEach(() => {
    vi.mocked(api.getRoutes).mockResolvedValue(routes);
    const detail: RouteDetail = {
      ...summary({ planned_route_name: '5SG Waldrunde lang' }),
      reference_track: [],
      rides: [ride({}), ride({ id: 'ride-2', date: '2024-05-01' })],
    };
    vi.mocked(api.getRoute).mockResolvedValue(detail);
    vi.mocked(api.mergeRoutes).mockResolvedValue(summary({ id: 'r2' }));
    vi.mocked(api.moveRideToRoute).mockResolvedValue({ route_id: 'x' });
    vi.mocked(api.unlinkPlannedRoute).mockResolvedValue({});
  });

  function setup() {
    const onSelectRoute = vi.fn();
    render(
      <RoutesTab
        bikeFilter={null}
        selection={{ routeId: 'r1', rideId: null }}
        onSelectRoute={onSelectRoute}
        onSelectRide={vi.fn()}
      />,
      { wrapper }
    );
    return onSelectRoute;
  }

  it('shows the rating as a badge and goes back to the list', async () => {
    const onSelectRoute = setup();
    const heading = await screen.findByRole('heading', { name: /Waldrunde/ });
    expect(within(heading).getByTitle('5-star route, gravel')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Routes' }));
    expect(onSelectRoute).toHaveBeenCalledWith(null);
  });

  it('merges into a route picked from the list after confirming', async () => {
    const onSelectRoute = setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Merge into…' }));
    const picker = screen.getByRole('dialog', { name: 'Merge into another route' });
    await userEvent.click(within(picker).getByRole('button', { name: /Seerunde/ }));
    const confirm = screen.getByRole('dialog', { name: 'Merge routes?' });
    expect(within(confirm).getByText('Merge all 2 ride(s) into "Seerunde"?')).toBeInTheDocument();
    expect(api.mergeRoutes).not.toHaveBeenCalled();
    await userEvent.click(within(confirm).getByRole('button', { name: 'Merge' }));
    expect(api.mergeRoutes).toHaveBeenCalledWith('r1', 'r2');
    expect(onSelectRoute).toHaveBeenCalledWith('r2');
  });

  it('moves a ride to another route or to its own one from the row menu', async () => {
    setup();
    await screen.findByText('Sun, 1 Jun 2025');
    await userEvent.click(screen.getAllByRole('button', { name: 'Ride actions' })[0]!);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Move to its own route' }));
    expect(api.moveRideToRoute).toHaveBeenCalledWith('ride-1', null);

    await userEvent.click(screen.getAllByRole('button', { name: 'Ride actions' })[1]!);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Move to another route…' }));
    const picker = screen.getByRole('dialog', { name: 'Move ride to another route' });
    await userEvent.click(within(picker).getByRole('button', { name: /Seerunde/ }));
    expect(api.moveRideToRoute).toHaveBeenCalledWith('ride-2', 'r2');
  });

  it('unlinks the planned route label', async () => {
    setup();
    expect(await screen.findByText('Planned: 5SG Waldrunde lang')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Unlink planned' }));
    expect(api.unlinkPlannedRoute).toHaveBeenCalledWith('r1');
  });
});

describe('RidesTab', () => {
  beforeEach(() => {
    vi.mocked(api.getRides).mockResolvedValue([ride({})]);
    vi.mocked(api.getRoutes).mockResolvedValue(routes);
    vi.mocked(api.updateRide).mockResolvedValue(ride({}));
    vi.mocked(api.deleteRide).mockResolvedValue({});
  });

  function setup() {
    const onShowRoute = vi.fn();
    render(
      <RidesTab
        bikeFilter={null}
        selectedRideId={null}
        onSelectRide={vi.fn()}
        onShowRoute={onShowRoute}
      />,
      { wrapper }
    );
    return onShowRoute;
  }

  it('renames a ride from its menu', async () => {
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Ride actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const input = screen.getByLabelText('Ride title');
    await userEvent.clear(input);
    await userEvent.type(input, 'Evening loop{Enter}');
    expect(api.updateRide).toHaveBeenCalledWith('ride-1', { title: 'Evening loop' });
  });

  it('deletes a ride only after confirming', async () => {
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Ride actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete "Waldrunde #1"?' });
    expect(within(dialog).getByText('Its rated sections are deleted too.')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(api.deleteRide).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Ride actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete ride' }));
    expect(api.deleteRide).toHaveBeenCalledWith('ride-1');
  });

  it('changes the bike type and jumps to the route', async () => {
    const onShowRoute = setup();
    await userEvent.selectOptions(await screen.findByLabelText('Bike type'), 'road');
    expect(api.updateRide).toHaveBeenCalledWith('ride-1', { bike_type: 'road' });
    await userEvent.click(screen.getByTitle('Part of route "5SG Waldrunde" (ridden 2×)'));
    expect(onShowRoute).toHaveBeenCalledWith('r1');
  });
});

describe('FavoritesTab', () => {
  beforeEach(() => {
    vi.mocked(api.getRoutes).mockResolvedValue([
      summary({ id: 'r1', name: '5SG Waldrunde', ride_count: 4 }),
      summary({ id: 'r2', name: 'Seerunde', ride_count: 3 }),
      summary({ id: 'r3', name: '6S Gipfel', ride_count: 1, reference_ride_id: 'ride-9' }),
    ]);
  });

  function setup(selection = { routeId: null as string | null, rideId: null as string | null }) {
    const onSelectRoute = vi.fn();
    const onSelectRide = vi.fn();
    render(
      <FavoritesTab
        bikeFilter={null}
        selection={selection}
        onSelectRoute={onSelectRoute}
        onSelectRide={onSelectRide}
      />,
      { wrapper }
    );
    return { onSelectRoute, onSelectRide };
  }

  it('lists only rated routes, grouped by stars', async () => {
    setup();
    const six = await screen.findByRole('region', { name: '6 stars' });
    const five = screen.getByRole('region', { name: '5 stars' });
    expect(within(six).getByText('Gipfel')).toBeInTheDocument();
    expect(within(six).getByText(/ridden once/)).toBeInTheDocument();
    expect(within(five).getByText('Waldrunde')).toBeInTheDocument();
    expect(screen.queryByText('Seerunde')).not.toBeInTheDocument();
  });

  it('opens a repeated route, but selects the ride of a route ridden once', async () => {
    const { onSelectRoute, onSelectRide } = setup();
    await userEvent.click(await screen.findByRole('button', { name: /Waldrunde/ }));
    expect(onSelectRoute).toHaveBeenCalledWith('r1');
    await userEvent.click(screen.getByRole('button', { name: /Gipfel/ }));
    expect(onSelectRide).toHaveBeenCalledWith('ride-9');
    expect(onSelectRoute).toHaveBeenCalledTimes(1);
  });

  it('filters by surface and explains how to add favorites', async () => {
    setup();
    await screen.findByRole('region', { name: '6 stars' });
    await userEvent.click(screen.getByRole('button', { name: 'Road' }));
    expect(screen.getByText('No favorites match the search or filter.')).toBeInTheDocument();
  });
});

describe('MapStyleControl', () => {
  const view: ViewSettings = {
    baseMap: 'dark',
    showHeatmap: true,
    heatmapIntensity: 50,
    heatmapOpacity: 0.8,
    showSections: true,
    showAllTracks: false,
    trackOpacity: 0.85,
    mapSaturation: 100,
  };

  it('switches the base map and toggles layers', async () => {
    const onChange = vi.fn();
    render(<MapStyleControl view={view} onChange={onChange} sectionCount={3} center={null} />);
    await userEvent.click(screen.getByRole('button', { name: 'Map' }));
    expect(screen.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Muted light' }));
    expect(onChange).toHaveBeenCalledWith({ baseMap: 'light' });
    await userEvent.click(screen.getByRole('switch', { name: 'Heatmap' }));
    expect(onChange).toHaveBeenCalledWith({ showHeatmap: false });
    await userEvent.click(screen.getByRole('switch', { name: /All tracks/ }));
    expect(onChange).toHaveBeenCalledWith({ showAllTracks: true });
    expect(screen.getByLabelText('Intensity')).toBeInTheDocument();
    expect(screen.getByLabelText('Map colour')).toBeInTheDocument();
  });
});

describe('Sidebar', () => {
  const stats = (unassigned: number): Stats => ({
    rides: {
      total: 10,
      total_distance_km: 500,
      total_elevation_m: 4000,
      by_type: { road: 5, gravel: 3, mtb: 2 - unassigned, unassigned },
    },
    routes: { total: 4, repeated: 2 },
    sections: { total: 1, by_rating: {} as Stats['sections']['by_rating'] },
  });
  const sync: SyncStatus = {
    garmin: {
      configured: false,
      running: false,
      next_run_at: null,
      last_run: null,
      last_success_at: null,
      recent_runs: [],
      activities: {},
    },
    hammerhead: {
      configured: false,
      running: false,
      next_run_at: null,
      last_run: null,
      last_success_at: null,
      recent_runs: [],
      activities: {},
      connected: false,
      connected_at: null,
    },
  };

  beforeEach(() => {
    vi.mocked(api.getSuggestions).mockResolvedValue({
      planned_routes: { count: 0, rated: 0, synced_at: null, error: null },
      counts: { strong: 0, weak: 0 },
      groups: [],
    });
    vi.mocked(api.getSyncStatus).mockResolvedValue(sync);
    vi.mocked(api.getRoutes).mockResolvedValue(routes);
  });

  function setup() {
    const onBikeFilterChange = vi.fn();
    render(
      <Sidebar
        tab="routes"
        onTabChange={vi.fn()}
        selection={{ routeId: null, rideId: null }}
        onSelectRide={vi.fn()}
        onSelectRoute={vi.fn()}
        onShowRoute={vi.fn()}
        bikeFilter={null}
        onBikeFilterChange={onBikeFilterChange}
        onImportClick={vi.fn()}
      />,
      { wrapper }
    );
    return onBikeFilterChange;
  }

  it('shows a Favorites tab with the number of rated routes', async () => {
    vi.mocked(api.getStats).mockResolvedValue(stats(0));
    setup();
    expect(await screen.findByRole('tab', { name: 'Favorites 1' })).toBeInTheDocument();
  });

  it('filters by bike type with counted chips', async () => {
    vi.mocked(api.getStats).mockResolvedValue(stats(1));
    const onBikeFilterChange = setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Gravel 3' }));
    expect(onBikeFilterChange).toHaveBeenCalledWith('gravel');
    await userEvent.click(screen.getByRole('button', { name: 'Unassigned 1' }));
    expect(onBikeFilterChange).toHaveBeenCalledWith('unassigned');
  });

  it('hides the Unassigned chip when every ride has a bike type', async () => {
    vi.mocked(api.getStats).mockResolvedValue(stats(0));
    setup();
    expect(await screen.findByRole('button', { name: 'Road 5' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Unassigned/ })).not.toBeInTheDocument();
  });

  it('keeps the sync details in the Sources popover', async () => {
    vi.mocked(api.getStats).mockResolvedValue(stats(0));
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Sources' }));
    expect(await screen.findByText(/Garmin sync off/)).toBeInTheDocument();
  });
});
