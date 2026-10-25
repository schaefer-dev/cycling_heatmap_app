import { useQuery } from '@tanstack/react-query';
import type { Selection, SidebarTab, ViewSettings } from '../App';
import { getStats, getSuggestions, type BikeFilter } from '../api';
import { qk } from '../queryKeys';
import LayerControls from './sidebar/LayerControls';
import RidesTab from './sidebar/RidesTab';
import RoutesTab from './sidebar/RoutesTab';
import SuggestionsTab from './sidebar/SuggestionsTab';
import SyncStatusPanel from './sidebar/SyncStatusPanel';

interface Props {
  tab: SidebarTab;
  onTabChange(tab: SidebarTab): void;
  selection: Selection;
  onSelectRide(rideId: string | null, routeId?: string | null): void;
  onSelectRoute(routeId: string | null): void;
  onShowRoute(routeId: string): void;
  bikeFilter: BikeFilter;
  onBikeFilterChange(filter: BikeFilter): void;
  view: ViewSettings;
  onViewChange(patch: Partial<ViewSettings>): void;
  onImportClick(): void;
}

export default function Sidebar(props: Props) {
  const { data: stats } = useQuery({ queryKey: qk.stats(), queryFn: getStats });
  // Same query the Suggestions tab uses by default, so the badge and the list agree.
  const { data: suggestions } = useQuery({
    queryKey: qk.suggestions(false),
    queryFn: () => getSuggestions(false),
  });
  const badge: Record<SidebarTab, number | undefined> = {
    routes: stats?.routes.total,
    rides: stats?.rides.total,
    suggestions: suggestions?.counts.strong,
  };

  return (
    <div className="w-96 bg-white shadow-lg flex flex-col h-full min-h-0">
      <div className="p-4 border-b space-y-3">
        <div className="flex items-baseline justify-between">
          <h1 className="text-xl font-bold text-gray-800">Cycling Archive</h1>
          {stats && (
            <div className="text-xs text-gray-500">
              {stats.rides.total} rides · {stats.rides.total_distance_km.toLocaleString()} km
            </div>
          )}
        </div>
        <SyncStatusPanel />
        <div className="flex gap-2">
          <button
            onClick={props.onImportClick}
            className="flex-1 bg-blue-500 hover:bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium"
          >
            Import files
          </button>
          <select
            aria-label="Filter by bike type"
            value={props.bikeFilter ?? ''}
            onChange={(e) => props.onBikeFilterChange((e.target.value || null) as BikeFilter)}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
          >
            <option value="">All bikes</option>
            <option value="road">Road</option>
            <option value="gravel">Gravel</option>
            <option value="mtb">MTB</option>
            <option value="unassigned">
              Unassigned
              {stats?.rides.by_type.unassigned ? ` (${stats.rides.by_type.unassigned})` : ''}
            </option>
          </select>
        </div>
        <LayerControls view={props.view} onChange={props.onViewChange} />
      </div>

      <div className="flex border-b text-sm" role="tablist">
        {(['routes', 'rides', 'suggestions'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={props.tab === t}
            onClick={() => props.onTabChange(t)}
            className={`flex-1 py-2 font-medium capitalize ${
              props.tab === t
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t}
            {badge[t] !== undefined && (
              <span className="ml-1 text-xs text-gray-400">{badge[t]}</span>
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        {props.tab === 'routes' ? (
          <RoutesTab
            bikeFilter={props.bikeFilter}
            selection={props.selection}
            onSelectRoute={props.onSelectRoute}
            onSelectRide={props.onSelectRide}
          />
        ) : props.tab === 'suggestions' ? (
          <SuggestionsTab
            selectedRouteId={props.selection.routeId}
            onSelectRoute={props.onSelectRoute}
          />
        ) : (
          <RidesTab
            bikeFilter={props.bikeFilter}
            selectedRideId={props.selection.rideId}
            onSelectRide={(id) => props.onSelectRide(id)}
            onShowRoute={props.onShowRoute}
          />
        )}
      </div>

      {stats && (
        <div className="px-4 py-2 border-t bg-gray-50 grid grid-cols-4 gap-2 text-center text-xs">
          <Stat value={stats.rides.by_type.road} label="Road" className="text-blue-600" />
          <Stat value={stats.rides.by_type.gravel} label="Gravel" className="text-amber-600" />
          <Stat value={stats.rides.by_type.mtb} label="MTB" className="text-green-600" />
          <Stat value={stats.sections.total} label="Sections" className="text-gray-700" />
        </div>
      )}
    </div>
  );
}

function Stat({ value, label, className }: { value: number; label: string; className: string }) {
  return (
    <div>
      <div className={`font-semibold ${className}`}>{value}</div>
      <div className="text-gray-500">{label}</div>
    </div>
  );
}
