import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ProviderSyncStatus,
  Ride,
  RouteDetail,
  RouteSummary,
  Suggestions,
  SyncStatus,
} from '../src/api';
import RoutesTab from '../src/components/sidebar/RoutesTab';
import SuggestionsTab from '../src/components/sidebar/SuggestionsTab';
import SyncStatusPanel from '../src/components/sidebar/SyncStatusPanel';
import { ToastProvider } from '../src/components/Toast';

vi.mock('../src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/api')>()),
  getRoutes: vi.fn(),
  getRoute: vi.fn(),
  renameRoute: vi.fn(),
  mergeRoutes: vi.fn(),
  moveRideToRoute: vi.fn(),
  getSyncStatus: vi.fn(),
  startSync: vi.fn(),
  getSuggestions: vi.fn(),
  acceptSuggestion: vi.fn(),
  rejectSuggestion: vi.fn(),
  refreshPlannedRoutes: vi.fn(),
}));
const api = await import('../src/api');

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}

const summary = (over: Partial<RouteSummary>): RouteSummary => ({
  id: 'r1',
  name: 'Waldrunde',
  name_source: 'title',
  reference_ride_id: 'ride-1',
  ride_count: 3,
  first_ridden: '2023-04-01',
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
  route_similarity: 1,
  route_direction: 'forward',
  route_assignment: 'auto',
  created_at: '2025-06-01',
  ...over,
});

describe('RoutesTab', () => {
  beforeEach(() => {
    vi.mocked(api.getRoutes).mockResolvedValue([
      summary({}),
      summary({
        id: 'r2',
        name: 'Seerunde',
        ride_count: 1,
        last_ridden: '2025-07-01T08:00:00.000Z',
        bike_types: 'road',
      }),
    ]);
    const detail: RouteDetail = {
      ...summary({}),
      reference_track: [],
      rides: [
        ride({}),
        ride({
          id: 'ride-2',
          date: '2024-05-01',
          route_similarity: 0.93,
          route_direction: 'reverse',
        }),
      ],
    };
    vi.mocked(api.getRoute).mockResolvedValue(detail);
    vi.mocked(api.renameRoute).mockResolvedValue(summary({ name: 'Hausrunde' }));
  });

  function setup(onSelectRoute = vi.fn(), routeId: string | null = null) {
    render(
      <RoutesTab
        bikeFilter={null}
        selection={{ routeId, rideId: null }}
        onSelectRoute={onSelectRoute}
        onSelectRide={vi.fn()}
      />,
      { wrapper }
    );
    return onSelectRoute;
  }

  it('lists routes (most recent first) and filters repeated ones', async () => {
    setup();
    const cards = await screen.findAllByRole('button', { expanded: false });
    expect(cards.map((c) => within(c).getByText(/runde/).textContent)).toEqual([
      'Seerunde',
      'Waldrunde',
    ]);
    expect(screen.getByText('3×')).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('Ridden more than once'));
    expect(screen.queryByText('Seerunde')).not.toBeInTheDocument();
  });

  it('selects a route when its card is clicked', async () => {
    const onSelect = setup();
    await userEvent.click(await screen.findByText('Waldrunde'));
    expect(onSelect).toHaveBeenCalledWith('r1');
  });

  it('shows every ride of the selected route with direction and match', async () => {
    setup(vi.fn(), 'r1');
    expect(await screen.findByText('Sun, 1 Jun 2025')).toBeInTheDocument();
    expect(screen.getByText('Wed, 1 May 2024')).toBeInTheDocument();
    expect(screen.getByText('93%')).toHaveClass('text-orange-600');
    expect(screen.getByTitle('Ridden in reverse direction')).toBeInTheDocument();
    expect(screen.getByText('ref')).toBeInTheDocument();
  });

  it('renames a route', async () => {
    setup(vi.fn(), 'r1');
    await userEvent.click(await screen.findByText('Rename'));
    const input = screen.getByLabelText('Route name');
    await userEvent.clear(input);
    await userEvent.type(input, 'Hausrunde{Enter}');
    expect(api.renameRoute).toHaveBeenCalledWith('r1', 'Hausrunde');
  });
});

describe('SyncStatusPanel', () => {
  const provider = (over: Partial<ProviderSyncStatus> = {}): ProviderSyncStatus => ({
    configured: true,
    running: false,
    next_run_at: null,
    last_run: null,
    last_success_at: null,
    recent_runs: [],
    activities: {},
    ...over,
  });
  const status = (
    garmin: Partial<ProviderSyncStatus> = {},
    hammerhead: Partial<SyncStatus['hammerhead']> = {}
  ): SyncStatus => ({
    garmin: provider(garmin),
    hammerhead: { ...provider(), connected: true, connected_at: null, ...hammerhead },
  });
  const errorRun = (error: string) => ({
    id: 1,
    started_at: '',
    finished_at: '',
    mode: 'incremental' as const,
    status: 'error' as const,
    imported: 0,
    linked: 0,
    skipped: 0,
    failed: 0,
    error,
  });

  it('explains how to enable sync when no credentials are set', async () => {
    vi.mocked(api.getSyncStatus).mockResolvedValue(
      status({ configured: false }, { configured: false })
    );
    render(<SyncStatusPanel />, { wrapper });
    expect(await screen.findByText(/Garmin sync off/)).toBeInTheDocument();
    expect(screen.getByText(/Hammerhead sync off/)).toBeInTheDocument();
  });

  it('shows failures (e.g. an expired key) and offers Sync now', async () => {
    vi.mocked(api.getSyncStatus).mockResolvedValue(
      status({ last_run: errorRun('Garmin rejected the API key') }, { configured: false })
    );
    vi.mocked(api.startSync).mockResolvedValue({ started: true });
    render(<SyncStatusPanel />, { wrapper });
    expect(await screen.findByText(/Garmin rejected the API key/)).toBeInTheDocument();
    await userEvent.click(screen.getByText('Sync now'));
    expect(api.startSync).toHaveBeenCalledWith('garmin');
  });

  it('disables Sync now while a sync runs', async () => {
    vi.mocked(api.getSyncStatus).mockResolvedValue(
      status({ running: true }, { configured: false })
    );
    render(<SyncStatusPanel />, { wrapper });
    expect(await screen.findByText(/Syncing with Garmin/)).toBeInTheDocument();
    expect(screen.getByText('Sync now')).toBeDisabled();
  });

  it('offers to connect Hammerhead, and to reconnect when the login expired', async () => {
    vi.mocked(api.getSyncStatus).mockResolvedValue(
      status({ configured: false }, { connected: false })
    );
    const { unmount } = render(<SyncStatusPanel />, { wrapper });
    expect(await screen.findByText('Connect Hammerhead')).toHaveAttribute(
      'href',
      '/api/hammerhead/connect'
    );
    unmount();

    vi.mocked(api.getSyncStatus).mockResolvedValue(
      status(
        { configured: false },
        { last_run: errorRun('Hammerhead rejected the stored login: connect Hammerhead again') }
      )
    );
    render(<SyncStatusPanel />, { wrapper });
    expect(await screen.findByText('Reconnect')).toBeInTheDocument();
  });

  it('syncs Hammerhead on its own button', async () => {
    vi.mocked(api.getSyncStatus).mockResolvedValue(
      status({ configured: false }, { last_success_at: new Date().toISOString() })
    );
    vi.mocked(api.startSync).mockResolvedValue({ started: true });
    render(<SyncStatusPanel />, { wrapper });
    expect(await screen.findByText(/Hammerhead synced/)).toBeInTheDocument();
    await userEvent.click(screen.getByText('Sync now'));
    expect(api.startSync).toHaveBeenCalledWith('hammerhead');
  });
});

describe('SuggestionsTab', () => {
  const suggestions: Suggestions = {
    planned_routes: { count: 463, rated: 123, synced_at: new Date().toISOString(), error: null },
    counts: { strong: 1, weak: 4 },
    groups: [
      {
        route: {
          id: 'r9',
          name: 'Saarbrücken loop via Homburg · 90 km',
          name_source: 'geo',
          ride_count: 2,
          distance_km: 91,
          elevation_gain_m: 700,
          first_ridden: '2023-05-14T08:00:00.000Z',
          last_ridden: '2023-06-01T08:00:00.000Z',
        },
        candidates: [
          {
            planned_route_id: '1.route.a',
            name: '6SG Biotop Beeden shortcut 90k flach',
            distance_km: 90.7,
            gain_m: 435,
            created_at: '2023-05-14T07:00:00.000Z',
            score: 0.98,
            strength: 'strong',
            distance_diff: 0.003,
            lag_days: 0,
            reasons: ['distance +0.3 %', 'ridden the same day it was planned'],
            other_groups: 0,
          },
        ],
      },
    ],
  };

  it('lists suggestions with their reasons and only changes something on Accept', async () => {
    vi.mocked(api.getSuggestions).mockResolvedValue(suggestions);
    vi.mocked(api.acceptSuggestion).mockResolvedValue({ route_id: 'r9', name: '6SG Biotop' });
    const onSelectRoute = vi.fn();
    render(<SuggestionsTab selectedRouteId={null} onSelectRoute={onSelectRoute} />, { wrapper });

    expect(await screen.findByText('6SG Biotop Beeden shortcut 90k flach')).toBeInTheDocument();
    expect(screen.getByText(/ridden the same day it was planned/)).toBeInTheDocument();
    expect(screen.getByText(/123 rated of 463 planned routes/)).toBeInTheDocument();
    expect(api.acceptSuggestion).not.toHaveBeenCalled();

    await userEvent.click(screen.getByText('Saarbrücken loop via Homburg · 90 km'));
    expect(onSelectRoute).toHaveBeenCalledWith('r9');
    expect(api.acceptSuggestion).not.toHaveBeenCalled();

    await userEvent.click(screen.getByText('Accept'));
    expect(api.acceptSuggestion).toHaveBeenCalledWith('r9', suggestions.groups[0]!.candidates[0]);
    expect(api.rejectSuggestion).not.toHaveBeenCalled();
  });

  it('rejects, toggles weaker matches, and points to reconnect on a permission error', async () => {
    vi.mocked(api.getSuggestions).mockResolvedValue({
      ...suggestions,
      planned_routes: {
        ...suggestions.planned_routes,
        error: 'Hammerhead login lacks a permission',
      },
    });
    vi.mocked(api.rejectSuggestion).mockResolvedValue({});
    render(<SuggestionsTab selectedRouteId={null} onSelectRoute={vi.fn()} />, { wrapper });
    expect(await screen.findByText('Reconnect Hammerhead')).toHaveAttribute(
      'href',
      '/api/hammerhead/connect'
    );
    await userEvent.click(screen.getByText('Reject'));
    expect(api.rejectSuggestion).toHaveBeenCalledWith('r9', suggestions.groups[0]!.candidates[0]);
    await userEvent.click(screen.getByLabelText(/Show weaker matches/));
    expect(api.getSuggestions).toHaveBeenLastCalledWith(true);
  });
});
