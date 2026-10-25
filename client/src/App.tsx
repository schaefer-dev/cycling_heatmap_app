import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import type { BikeFilter } from './api';
import ImportModal from './components/ImportModal';
import Sidebar from './components/Sidebar';
import { ToastProvider } from './components/Toast';
import MapView from './components/map/MapView';
import { usePersistentState } from './usePersistentState';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
});

export interface ViewSettings {
  showHeatmap: boolean;
  heatmapIntensity: number;
  heatmapOpacity: number;
  showSections: boolean;
  showAllTracks: boolean;
  trackOpacity: number;
  mapSaturation: number;
}

const DEFAULT_VIEW: ViewSettings = {
  showHeatmap: true,
  heatmapIntensity: 50,
  heatmapOpacity: 0.8,
  showSections: true,
  showAllTracks: false,
  trackOpacity: 0.85,
  mapSaturation: 100,
};

/** What is selected: a route (group of rides), a single ride, or a ride within its route. */
export interface Selection {
  routeId: string | null;
  rideId: string | null;
}

export type SidebarTab = 'routes' | 'rides';

export default function App() {
  const [view, setView] = usePersistentState<ViewSettings>('view-settings', DEFAULT_VIEW);
  const [bikeFilter, setBikeFilter] = useState<BikeFilter>(null);
  const [selection, setSelection] = useState<Selection>({ routeId: null, rideId: null });
  const [tab, setTab] = usePersistentState<SidebarTab>('sidebar-tab', 'routes');
  const [showImport, setShowImport] = useState(false);

  const updateView = useCallback(
    (patch: Partial<ViewSettings>) => setView((v) => ({ ...v, ...patch })),
    [setView]
  );

  /** Selecting a ride from the map or the ride list also shows its route context. */
  const selectRide = useCallback((rideId: string | null, routeId: string | null = null) => {
    setSelection((s) => ({ rideId, routeId: rideId === null ? s.routeId : routeId }));
  }, []);

  const selectRoute = useCallback((routeId: string | null) => {
    setSelection({ routeId, rideId: null });
  }, []);

  const showRoute = useCallback(
    (routeId: string) => {
      setTab('routes');
      setSelection({ routeId, rideId: null });
    },
    [setTab]
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <div className="h-screen flex bg-gray-100">
          <Sidebar
            tab={tab}
            onTabChange={setTab}
            selection={selection}
            onSelectRide={selectRide}
            onSelectRoute={selectRoute}
            onShowRoute={showRoute}
            bikeFilter={bikeFilter}
            onBikeFilterChange={setBikeFilter}
            view={view}
            onViewChange={updateView}
            onImportClick={() => setShowImport(true)}
          />
          <div className="flex-1 relative">
            <MapView
              selection={selection}
              bikeFilter={bikeFilter}
              view={view}
              onSelectRide={selectRide}
              onClearSelection={() => setSelection({ routeId: null, rideId: null })}
            />
          </div>
          {showImport && <ImportModal onClose={() => setShowImport(false)} />}
        </div>
      </ToastProvider>
    </QueryClientProvider>
  );
}
