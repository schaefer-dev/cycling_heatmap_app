import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Map from './components/Map';
import Sidebar from './components/Sidebar';
import ImportModal from './components/ImportModal';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000,
      refetchOnWindowFocus: false
    }
  }
});

function App() {
  const [showImportModal, setShowImportModal] = useState(false);
  const [selectedRide, setSelectedRide] = useState(null);
  const [bikeTypeFilter, setBikeTypeFilter] = useState(null);
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [heatmapIntensity, setHeatmapIntensity] = useState(50);
  const [heatmapOpacity, setHeatmapOpacity] = useState(0.8);
  const [showSections, setShowSections] = useState(true);
  const [showAllTracks, setShowAllTracks] = useState(false);
  const [trackOpacity, setTrackOpacity] = useState(0.85);
  const [mapSaturation, setMapSaturation] = useState(100);

  return (
    <QueryClientProvider client={queryClient}>
      <div className="h-screen flex bg-gray-100">
        {/* Sidebar */}
        <Sidebar
          onImportClick={() => setShowImportModal(true)}
          selectedRide={selectedRide}
          onSelectRide={setSelectedRide}
          bikeTypeFilter={bikeTypeFilter}
          onBikeTypeFilterChange={setBikeTypeFilter}
          showHeatmap={showHeatmap}
          onShowHeatmapChange={setShowHeatmap}
          heatmapIntensity={heatmapIntensity}
          onHeatmapIntensityChange={setHeatmapIntensity}
          heatmapOpacity={heatmapOpacity}
          onHeatmapOpacityChange={setHeatmapOpacity}
          showSections={showSections}
          onShowSectionsChange={setShowSections}
          showAllTracks={showAllTracks}
          onShowAllTracksChange={setShowAllTracks}
          trackOpacity={trackOpacity}
          onTrackOpacityChange={setTrackOpacity}
          mapSaturation={mapSaturation}
          onMapSaturationChange={setMapSaturation}
        />

        {/* Map */}
        <div className="flex-1 relative">
          <Map
            selectedRide={selectedRide}
            bikeTypeFilter={bikeTypeFilter}
            showHeatmap={showHeatmap}
            heatmapIntensity={heatmapIntensity}
            heatmapOpacity={heatmapOpacity}
            showSections={showSections}
            showAllTracks={showAllTracks}
            trackOpacity={trackOpacity}
            mapSaturation={mapSaturation}
            onSelectRide={setSelectedRide}
          />
        </div>

        {/* Import Modal */}
        {showImportModal && (
          <ImportModal onClose={() => setShowImportModal(false)} />
        )}
      </div>
    </QueryClientProvider>
  );
}

export default App;
