import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense, useCallback, useState } from 'react';
import type { BikeFilter } from './api';
import ImportModal from './components/ImportModal';
import Sidebar from './components/Sidebar';
import { ConfirmProvider } from './components/ui/Confirm';
import { ToastProvider } from './components/Toast';
import MapView from './components/map/MapView';
import { PreviewProvider, usePreviewState } from './preview';
import { useUiMode } from './uiMode';
import { usePersistentState } from './usePersistentState';

/** The phone shell (view-only) is its own chunk; desktop never loads it. */
const MobileApp = lazy(() => import('./mobile/MobileApp.tsx'));

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
});

export type BaseMap = 'dark' | 'light' | 'osm';

export interface ViewSettings {
  baseMap: BaseMap;
  showHeatmap: boolean;
  heatmapIntensity: number;
  heatmapOpacity: number;
  showSections: boolean;
  showAllTracks: boolean;
  trackOpacity: number;
  mapSaturation: number;
}

const DEFAULT_VIEW: ViewSettings = {
  baseMap: 'dark',
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

export type SidebarTab = 'routes' | 'favorites' | 'rides' | 'suggestions';

export default function App() {
  const mode = useUiMode();
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ConfirmProvider>
          {mode === 'mobile' ? (
            <Suspense fallback={<div className="h-dvh bg-canvas" />}>
              <MobileApp />
            </Suspense>
          ) : (
            <DesktopApp />
          )}
        </ConfirmProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}

function DesktopApp() {
  const [view, setView] = usePersistentState<ViewSettings>('view-settings', DEFAULT_VIEW);
  const [bikeFilter, setBikeFilter] = useState<BikeFilter>(null);
  const [selection, setSelection] = useState<Selection>({ routeId: null, rideId: null });
  const [tab, setTab] = usePersistentState<SidebarTab>('sidebar-tab', 'routes');
  const [showImport, setShowImport] = useState(false);
  // Selecting or switching tabs hides the hovered row without a mouseleave, so clear explicitly.
  const { preview, controls: previewControls, clear: clearPreview } = usePreviewState();

  const updateView = useCallback(
    (patch: Partial<ViewSettings>) => setView((v) => ({ ...v, ...patch })),
    [setView]
  );

  /** Selecting a ride from the map or the ride list also shows its route context. */
  const selectRide = useCallback(
    (rideId: string | null, routeId: string | null = null) => {
      clearPreview();
      setSelection((s) => ({ rideId, routeId: rideId === null ? s.routeId : routeId }));
    },
    [clearPreview]
  );

  const selectRoute = useCallback(
    (routeId: string | null) => {
      clearPreview();
      setSelection({ routeId, rideId: null });
    },
    [clearPreview]
  );

  const changeTab = useCallback(
    (t: SidebarTab) => {
      clearPreview();
      setTab(t);
    },
    [clearPreview, setTab]
  );

  /** Opens a route in the Routes tab, optionally keeping one of its rides selected. */
  const showRoute = useCallback(
    (routeId: string, rideId: string | null = null) => {
      clearPreview();
      setTab('routes');
      setSelection({ routeId, rideId });
    },
    [clearPreview, setTab]
  );

  return (
    <div className="flex h-screen min-w-[900px] bg-canvas">
      <PreviewProvider value={previewControls}>
        <Sidebar
          tab={tab}
          onTabChange={changeTab}
          selection={selection}
          onSelectRide={selectRide}
          onSelectRoute={selectRoute}
          onShowRoute={showRoute}
          bikeFilter={bikeFilter}
          onBikeFilterChange={setBikeFilter}
          onImportClick={() => setShowImport(true)}
        />
      </PreviewProvider>
      <main className="relative min-w-0 flex-1">
        <MapView
          selection={selection}
          preview={preview}
          bikeFilter={bikeFilter}
          view={view}
          onViewChange={updateView}
          onSelectRide={selectRide}
          onShowRoute={showRoute}
          onClearSelection={() => setSelection({ routeId: null, rideId: null })}
        />
      </main>
      {showImport && <ImportModal onClose={() => setShowImport(false)} />}
    </div>
  );
}
